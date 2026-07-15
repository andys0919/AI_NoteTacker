import json
import mimetypes
import os
import re
import subprocess
import tempfile
import uuid
import urllib.error
from urllib import request

from transcription_worker.transcript_normalizer import TranscriptNormalizer
from transcription_worker.transcription_context import (
    build_transcription_prompt,
    resolve_transcription_context,
)

MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_AZURE_MP3_BITRATE = "64k"
MAX_AUDIO_DURATION_MS = 1500 * 1000
DEFAULT_MAX_CHUNK_DURATION_MS = 20 * 60 * 1000
DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS = 5 * 60 * 1000
SPARSE_TRANSCRIPT_MIN_DURATION_MS = 10 * 60 * 1000
SPARSE_TRANSCRIPT_MIN_CHARS = 80
SPARSE_TRANSCRIPT_MIN_CHARS_PER_MINUTE = 5
AUDIO_ACTIVITY_MEAN_VOLUME_DB = -45.0

# Characters that close a sentence. gpt-4o-transcribe only supports response_format
# "json"/"text" (no verbose_json), so it returns one undivided text blob per upload.
# We split that blob on these boundaries so the stored transcript reads as one line
# per sentence instead of a single wall of text. ASCII "." is intentionally excluded
# to avoid splitting decimals/abbreviations.
SENTENCE_ENDING_CHARS = frozenset("。！？!?…；;\n")
# Closing marks that belong to the sentence that just ended (e.g. the 」 in 「好。」).
SENTENCE_TRAILING_CHARS = frozenset("」』）)】》〉”’\"'")
_ALIGNMENT_IGNORED = frozenset(
    "，。、？！；：「」『』（）()【】《》…—－　 \t\r\n!?;,.:\"'"
)


def _strip_for_alignment(text: str) -> str:
    return "".join(char for char in text if char not in _ALIGNMENT_IGNORED)


class AzureOpenAiTranscriber:
    def __init__(
        self,
        endpoint: str,
        deployment: str,
        api_key: str,
        api_version: str = "2025-03-01-preview",
        language: str = "",
        prompt: str = "",
        punctuator=None,
        urlopen=None,
        duration_resolver=None,
        upload_plan_builder=None,
        audio_activity_detector=None,
        sparse_retry_chunk_duration_ms: int = DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS,
        remove_file=None,
        timeout_seconds: int = 300,
        normalizer=None,
    ) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.deployment = deployment
        self.api_key = api_key
        self.api_version = api_version
        self.language = language or ""
        self.prompt = prompt or ""
        self.punctuator = punctuator
        self.urlopen = urlopen or request.urlopen
        self.duration_resolver = duration_resolver or self._resolve_duration_ms
        self.upload_plan_builder = upload_plan_builder or self._build_upload_plan
        self.audio_activity_detector = audio_activity_detector or self._has_audio_activity
        self.sparse_retry_chunk_duration_ms = sparse_retry_chunk_duration_ms
        self.remove_file = remove_file or os.remove
        self.timeout_seconds = timeout_seconds
        self.normalizer = normalizer or TranscriptNormalizer()

    def transcribe(
        self,
        local_audio_path: str,
        on_progress=None,
        on_punctuation_usage=None,
        on_transcription_usage=None,
        workflow_context=None,
    ) -> dict:
        resolved_context = resolve_transcription_context(workflow_context)
        request_prompt = build_transcription_prompt(self.prompt, resolved_context)
        upload_plan = self.upload_plan_builder(local_audio_path)
        total_ms = upload_plan[-1]["end_ms"] if upload_plan else 0
        collected_segments = []
        detected_language = "unknown"
        successful_audio_ms = 0

        def report_transcription_usage(update):
            nonlocal successful_audio_ms
            successful_audio_ms += update["audio_ms"]
            if on_transcription_usage is not None:
                on_transcription_usage(update)

        try:
            for part in upload_plan:
                part_result = self._transcribe_part_with_sparse_retry(
                    part,
                    on_punctuation_usage=on_punctuation_usage,
                    on_transcription_usage=report_transcription_usage,
                    workflow_context=resolved_context,
                    request_prompt=request_prompt,
                )

                if part_result.get("language") and detected_language == "unknown":
                    detected_language = part_result["language"]

                collected_segments.extend(part_result["segments"])

                if on_progress is not None:
                    processed_ms = part["end_ms"]
                    percent = 100 if total_ms <= 0 else min(100, max(1, int((processed_ms / total_ms) * 100)))
                    on_progress(
                        {
                            "processed_ms": processed_ms,
                            "total_ms": total_ms,
                            "percent": percent,
                        }
                    )
        finally:
            for part in upload_plan:
                if part.get("cleanup"):
                    try:
                        self.remove_file(part["path"])
                    except OSError:
                        pass

        return {
            "language": detected_language,
            "segments": collected_segments,
            "usage": {
                "audio_ms": successful_audio_ms,
            },
        }

    def _transcribe_part_with_sparse_retry(
        self,
        part: dict,
        on_punctuation_usage=None,
        on_transcription_usage=None,
        workflow_context=None,
        request_prompt="",
    ) -> dict:
        payload = self._transcribe_upload(part["path"], request_prompt=request_prompt)
        if on_transcription_usage is not None:
            on_transcription_usage({"audio_ms": self._part_duration_ms(part)})
        part_result = self._payload_to_transcript_result(
            payload,
            part,
            on_punctuation_usage=on_punctuation_usage,
            workflow_context=workflow_context,
        )

        if not self._is_suspicious_sparse_part(part, part_result["text"]):
            return part_result

        retry_parts = self._build_sparse_retry_upload_plan(part)
        retry_segments = []
        detected_language = part_result["language"]

        try:
            for retry_part in retry_parts:
                retry_payload = self._transcribe_upload(
                    retry_part["path"], request_prompt=request_prompt
                )
                if on_transcription_usage is not None:
                    on_transcription_usage(
                        {"audio_ms": self._part_duration_ms(retry_part)}
                    )
                retry_result = self._payload_to_transcript_result(
                    retry_payload,
                    retry_part,
                    on_punctuation_usage=on_punctuation_usage,
                    workflow_context=workflow_context,
                )
                if retry_result.get("language") and detected_language == "unknown":
                    detected_language = retry_result["language"]
                retry_segments.extend(retry_result["segments"])
        finally:
            for retry_part in retry_parts:
                try:
                    self.remove_file(retry_part["path"])
                except OSError:
                    pass

        retry_text = self._segments_to_text(retry_segments)
        if (
            self._is_text_sparse(retry_text, self._part_duration_ms(part))
            and self.audio_activity_detector(part["path"])
        ):
            raise RuntimeError(
                "Azure OpenAI transcription returned suspiciously sparse text "
                "for an audible audio chunk after retrying smaller chunks "
                f"(startMs={part['start_ms']}, endMs={part['end_ms']}, "
                f"chars={self._text_density_chars(retry_text)})"
            )

        return {
            "language": detected_language,
            "segments": retry_segments,
            "text": retry_text,
        }

    def _payload_to_transcript_result(
        self,
        payload: dict,
        part: dict,
        on_punctuation_usage=None,
        workflow_context=None,
    ) -> dict:
        context = workflow_context or {}
        language = payload.get("language") or "unknown"
        language_confidence = payload.get("language_probability")
        if payload.get("segments"):
            segments = []
            for segment in payload.get("segments", []):
                start_ms = part["start_ms"] + int(float(segment.get("start", 0)) * 1000)
                end_ms = part["start_ms"] + int(float(segment.get("end", 0)) * 1000)
                normalized = self.normalizer.normalize(
                    segment.get("text", ""),
                    language=language,
                    language_confidence=language_confidence,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    timing_source="provider",
                    glossary=context.get("glossary", []),
                )
                segments.append(
                    self._build_evidence_segment(start_ms, end_ms, normalized)
                )
            return {
                "language": language,
                "segments": segments,
                "text": self._segments_to_text(segments),
            }

        raw_text = payload.get("text") or ""
        normalized = self.normalizer.normalize(
            raw_text,
            language=language,
            language_confidence=language_confidence,
            start_ms=part["start_ms"],
            end_ms=part["end_ms"],
            timing_source="estimated",
            glossary=context.get("glossary", []),
        )
        text = normalized["display_text"]
        # gpt-4o-transcribe returns an unpunctuated blob; restore punctuation
        # BEFORE splitting so there are sentence boundaries to split on. The
        # punctuator self-guards (keeps raw text on any failure), so this never
        # breaks the job.
        if self.punctuator is not None and text.strip():
            if hasattr(self.punctuator, "restore_with_usage"):
                punctuation_result = self.punctuator.restore_with_usage(text)
                text = punctuation_result["text"]
                if on_punctuation_usage is not None:
                    on_punctuation_usage(punctuation_result["usage"])
            else:
                text = self.punctuator.restore(text)

        display_segments = self._split_text_into_segments(
            text,
            part["start_ms"],
            part["end_ms"],
        )
        segments = self._attach_blob_evidence(display_segments, normalized)
        return {
            "language": language,
            "segments": segments,
            "text": text,
        }

    def _build_evidence_segment(self, start_ms: int, end_ms: int, normalized: dict) -> dict:
        segment = {
            "start_ms": start_ms,
            "end_ms": end_ms,
            "text": normalized["display_text"],
            **normalized,
        }
        segment.pop("timing_source", None)
        segment["timing_source"] = normalized["timing_source"]
        return segment

    def _attach_blob_evidence(self, display_segments: list[dict], normalized: dict) -> list[dict]:
        if not display_segments:
            return []
        raw_parts = self._split_raw_for_display_segments(
            normalized["raw_text"], display_segments
        )
        if raw_parts is None:
            display_segments = [
                {
                    "start_ms": display_segments[0]["start_ms"],
                    "end_ms": display_segments[-1]["end_ms"],
                    "text": normalized["display_text"],
                }
            ]
            raw_parts = [normalized["raw_text"]]

        evidence_segments = []
        for segment, raw_part in zip(display_segments, raw_parts, strict=True):
            flags = [
                flag
                for flag in normalized["review_flags"]
                if flag["original_text"] in raw_part
                or flag["reason"] == "normalization-failed"
            ]
            evidence = {
                "start_ms": segment["start_ms"],
                "end_ms": segment["end_ms"],
                "text": segment["text"],
                "raw_text": raw_part,
                "display_text": segment["text"],
                "language": normalized["language"],
                "timing_source": normalized["timing_source"],
                "review_flags": flags,
            }
            if "language_confidence" in normalized:
                evidence["language_confidence"] = normalized["language_confidence"]
            evidence_segments.append(evidence)
        return evidence_segments

    def _split_raw_for_display_segments(
        self, raw_text: str, display_segments: list[dict]
    ) -> list[str] | None:
        raw_total = len(_strip_for_alignment(raw_text))
        display_counts = [
            len(_strip_for_alignment(segment["text"])) for segment in display_segments
        ]
        if raw_total != sum(display_counts):
            return None

        parts = []
        raw_start = 0
        cursor = 0
        for target_count in display_counts[:-1]:
            significant_count = 0
            while cursor < len(raw_text) and significant_count < target_count:
                if raw_text[cursor] not in _ALIGNMENT_IGNORED:
                    significant_count += 1
                cursor += 1
            while cursor < len(raw_text) and raw_text[cursor] in _ALIGNMENT_IGNORED:
                cursor += 1
            parts.append(raw_text[raw_start:cursor])
            raw_start = cursor
        parts.append(raw_text[raw_start:])
        return parts if len(parts) == len(display_segments) else None

    def _build_sparse_retry_upload_plan(self, part: dict) -> list[dict]:
        retry_chunk_duration_ms = getattr(
            self,
            "sparse_retry_chunk_duration_ms",
            DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS,
        )
        if retry_chunk_duration_ms <= 0:
            retry_chunk_duration_ms = DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS

        part_duration_ms = self._part_duration_ms(part)
        retry_plan = []

        for offset_ms in range(0, part_duration_ms, retry_chunk_duration_ms):
            duration_ms = min(retry_chunk_duration_ms, part_duration_ms - offset_ms)
            chunk_path = self._new_temp_audio_path(".mp3")
            self._transcode_for_upload(
                part["path"],
                chunk_path,
                start_ms=offset_ms,
                duration_ms=duration_ms,
            )
            retry_plan.append(
                {
                    "path": chunk_path,
                    "start_ms": part["start_ms"] + offset_ms,
                    "end_ms": part["start_ms"] + offset_ms + duration_ms,
                    "cleanup": True,
                }
            )

        return retry_plan

    def _is_suspicious_sparse_part(self, part: dict, text: str) -> bool:
        part_duration_ms = self._part_duration_ms(part)
        if part_duration_ms < SPARSE_TRANSCRIPT_MIN_DURATION_MS:
            return False
        if not self._is_text_sparse(text, part_duration_ms):
            return False

        return bool(self.audio_activity_detector(part["path"]))

    def _is_text_sparse(self, text: str, duration_ms: int) -> bool:
        duration_minutes = max(1, duration_ms / 60_000)
        minimum_chars = max(
            SPARSE_TRANSCRIPT_MIN_CHARS,
            int(duration_minutes * SPARSE_TRANSCRIPT_MIN_CHARS_PER_MINUTE),
        )

        return self._text_density_chars(text) < minimum_chars

    def _text_density_chars(self, text: str) -> int:
        return len("".join(text.split()))

    def _segments_to_text(self, segments: list[dict]) -> str:
        return " ".join(segment.get("text", "") for segment in segments)

    def _part_duration_ms(self, part: dict) -> int:
        return max(0, int(part["end_ms"]) - int(part["start_ms"]))

    def _has_audio_activity(self, audio_path: str) -> bool:
        result = subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-nostats",
                "-i",
                audio_path,
                "-vn",
                "-af",
                "volumedetect",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            return True

        match = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?) dB", result.stderr)
        if not match:
            return True

        return float(match.group(1)) >= AUDIO_ACTIVITY_MEAN_VOLUME_DB

    def _transcribe_upload(self, upload_path: str, request_prompt: str = "") -> dict:
        boundary = f"----AINoteTacker{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(upload_path)[0] or "application/octet-stream"
        file_name = os.path.basename(upload_path)

        with open(upload_path, "rb") as handle:
            audio_bytes = handle.read()

        fields = [
            self._encode_field(boundary, "model", self.deployment),
            self._encode_field(boundary, "response_format", "json"),
        ]
        if self.language:
            fields.append(self._encode_field(boundary, "language", self.language))
        if request_prompt:
            fields.append(self._encode_field(boundary, "prompt", request_prompt))
        fields.append(
            self._encode_file(boundary, "file", file_name, content_type, audio_bytes)
        )
        fields.append(f"--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(fields)

        http_request = request.Request(
            f"{self.endpoint}/openai/deployments/{self.deployment}/audio/transcriptions?api-version={self.api_version}",
            method="POST",
            headers={
                "api-key": self.api_key,
                "content-type": f"multipart/form-data; boundary={boundary}",
            },
            data=body,
        )

        try:
            with self.urlopen(  # noqa: S310
                http_request,
                timeout=self.timeout_seconds,
            ) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace").strip()
            message = f"Azure OpenAI transcription failed with status {error.code}"
            if details:
                message = f"{message}: {details}"
            raise RuntimeError(message) from error

    def _split_text_into_segments(self, text: str, start_ms: int, end_ms: int) -> list[dict]:
        total_chars = len(text)
        if total_chars == 0:
            return []

        span_ms = max(0, end_ms - start_ms)
        segments: list[dict] = []
        sentence_start = 0
        index = 0

        while index < total_chars:
            if text[index] in SENTENCE_ENDING_CHARS:
                cut = index + 1
                while cut < total_chars and text[cut] in SENTENCE_ENDING_CHARS:
                    cut += 1
                while cut < total_chars and text[cut] in SENTENCE_TRAILING_CHARS:
                    cut += 1
                self._append_text_segment(
                    segments, text, sentence_start, cut, total_chars, start_ms, span_ms
                )
                sentence_start = cut
                index = cut
            else:
                index += 1

        if sentence_start < total_chars:
            self._append_text_segment(
                segments, text, sentence_start, total_chars, total_chars, start_ms, span_ms
            )

        return segments

    def _append_text_segment(
        self,
        segments: list[dict],
        text: str,
        char_start: int,
        char_end: int,
        total_chars: int,
        start_ms: int,
        span_ms: int,
    ) -> None:
        cleaned = text[char_start:char_end].strip()
        if not cleaned:
            return

        segment_start = start_ms + int(round(span_ms * char_start / total_chars))
        segment_end = start_ms + int(round(span_ms * char_end / total_chars))
        if segment_end < segment_start:
            segment_end = segment_start

        segments.append(
            {
                "start_ms": segment_start,
                "end_ms": segment_end,
                "text": cleaned,
            }
        )

    def _build_upload_plan(self, local_audio_path: str) -> list[dict]:
        total_duration_ms = self.duration_resolver(local_audio_path)

        if (
            os.path.getsize(local_audio_path) <= MAX_AUDIO_UPLOAD_BYTES
            and total_duration_ms <= MAX_AUDIO_DURATION_MS
        ):
            return [
                {
                    "path": local_audio_path,
                    "start_ms": 0,
                    "end_ms": total_duration_ms,
                    "cleanup": False,
                }
            ]

        compressed_path = self._new_temp_audio_path(".mp3")
        self._transcode_for_upload(local_audio_path, compressed_path)

        if (
            os.path.getsize(compressed_path) <= MAX_AUDIO_UPLOAD_BYTES
            and total_duration_ms <= MAX_AUDIO_DURATION_MS
        ):
            return [
                {
                    "path": compressed_path,
                    "start_ms": 0,
                    "end_ms": total_duration_ms,
                    "cleanup": True,
                }
            ]

        self.remove_file(compressed_path)

        upload_plan = []
        for start_ms in range(0, total_duration_ms, DEFAULT_MAX_CHUNK_DURATION_MS):
            duration_ms = min(DEFAULT_MAX_CHUNK_DURATION_MS, total_duration_ms - start_ms)
            chunk_path = self._new_temp_audio_path(".mp3")
            self._transcode_for_upload(
                local_audio_path,
                chunk_path,
                start_ms=start_ms,
                duration_ms=duration_ms,
            )
            upload_plan.append(
                {
                    "path": chunk_path,
                    "start_ms": start_ms,
                    "end_ms": start_ms + duration_ms,
                    "cleanup": True,
                }
            )

        return upload_plan

    def _encode_field(self, boundary: str, name: str, value: str) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n"
        ).encode("utf-8")

    def _encode_file(
        self,
        boundary: str,
        name: str,
        file_name: str,
        content_type: str,
        body: bytes,
    ) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{file_name}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8") + body + b"\r\n"

    def _resolve_duration_ms(self, local_audio_path: str) -> int:
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                local_audio_path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

        if probe.returncode != 0:
            return 0

        try:
            return max(0, int(float(probe.stdout.strip() or "0") * 1000))
        except ValueError:
            return 0

    def _new_temp_audio_path(self, suffix: str) -> str:
        descriptor, path = tempfile.mkstemp(prefix="azure-transcription-", suffix=suffix)
        os.close(descriptor)
        return path

    def _transcode_for_upload(
        self,
        source_path: str,
        output_path: str,
        start_ms: int | None = None,
        duration_ms: int | None = None,
    ) -> None:
        command = ["ffmpeg", "-v", "error"]

        if start_ms is not None:
          command.extend(["-ss", f"{start_ms / 1000:.3f}"])

        command.extend(["-i", source_path, "-vn"])

        if duration_ms is not None:
          command.extend(["-t", f"{duration_ms / 1000:.3f}"])

        command.extend(
            [
                "-ar",
                "16000",
                "-ac",
                "1",
                "-b:a",
                DEFAULT_AZURE_MP3_BITRATE,
                "-f",
                "mp3",
                output_path,
                "-y",
            ]
        )

        result = subprocess.run(command, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            raise RuntimeError(
                f"Failed to prepare Azure transcription audio: {result.stderr.strip() or result.stdout.strip()}"
            )
