import base64
from collections import Counter, defaultdict
from concurrent.futures import (
    ThreadPoolExecutor,
    TimeoutError as FutureTimeoutError,
    as_completed,
)
from difflib import SequenceMatcher
import gzip
import io
import json
import mimetypes
import os
import re
import subprocess
import tempfile
from threading import Event, Lock
import time
import uuid
import urllib.error
from urllib import request
import wave

from transcription_worker.transcript_normalizer import TranscriptNormalizer
from transcription_worker.transcription_context import (
    PREVIOUS_TRANSCRIPT_CONTEXT_CHARS,
    build_transcription_prompt,
    resolve_transcription_context,
)

MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_AZURE_MP3_BITRATE = "64k"
DEFAULT_MAX_CHUNK_DURATION_MS = 5 * 60 * 1000
DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS = 5 * 60 * 1000
DEFAULT_DIARIZATION_CHUNK_DURATION_MS = 5 * 60 * 1000
DEFAULT_DIARIZATION_MAX_WORKERS = 3
DEFAULT_DIARIZATION_API_VERSION = "2025-04-01-preview"
DIARIZATION_DEPLOYMENT_RETRY_DELAYS_SECONDS = (2.0,)
DIARIZATION_HTTP_400_RETRY_DELAY_SECONDS = 2.0
DIARIZATION_TRANSPORT_RETRY_DELAYS_SECONDS = (2.0, 10.0, 30.0)
DIARIZATION_REPAIR_DELAY_SECONDS = 15.0
DIARIZATION_WAIT_POLL_SECONDS = 5.0
TRANSCRIPT_QUALITY_RETRY_ATTEMPTS = 2
SPARSE_TRANSCRIPT_MIN_DURATION_MS = 5 * 60 * 1000
SPARSE_TRANSCRIPT_MIN_CHARS = 80
SPARSE_TRANSCRIPT_MIN_CHARS_PER_MINUTE = 5
REPETITIVE_TRANSCRIPT_MIN_DURATION_MS = 20_000
REPETITIVE_TRANSCRIPT_GZIP_RATIO = 4.0
REPETITIVE_TRANSCRIPT_RETRY_CHUNK_DURATION_MS = 30_000
AUDIO_ACTIVITY_MEAN_VOLUME_DB = -45.0
MAX_SPEAKER_REFERENCES = 4
MIN_SPEAKER_REFERENCE_MS = 2_000
TARGET_SPEAKER_REFERENCE_MS = 8_000
MIN_SPEAKER_ALIGNMENT_CHARS = 4
MIN_SPEAKER_ALIGNMENT_COVERAGE = 0.35
MIN_SPEAKER_ALIGNMENT_DOMINANCE = 0.75
MAX_SPEAKER_ALIGNMENT_SEGMENT_MS = 60_000

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


def _speaker_alignment_chars(text: str) -> list[str]:
    return [char.lower() for char in text if char.isalnum()]


class AzureOpenAiDiarizationError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        request_count: int,
        unmetered_request_count: int,
    ) -> None:
        super().__init__(message)
        self.request_count = request_count
        self.unmetered_request_count = unmetered_request_count


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
        retry_sleep=None,
        sparse_retry_chunk_duration_ms: int = DEFAULT_SPARSE_RETRY_CHUNK_DURATION_MS,
        remove_file=None,
        timeout_seconds: int = 300,
        normalizer=None,
        diarization_endpoint: str = "",
        diarization_deployment: str = "",
        diarization_api_key: str = "",
        diarization_api_version: str = DEFAULT_DIARIZATION_API_VERSION,
        diarization_timeout_seconds: int = 300,
        diarization_max_workers: int = DEFAULT_DIARIZATION_MAX_WORKERS,
        max_chunk_duration_ms: int = DEFAULT_MAX_CHUNK_DURATION_MS,
        independent_chunk_max_workers: int = 1,
        provider_label: str = "Azure OpenAI",
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
        self.retry_sleep = retry_sleep or time.sleep
        self.sparse_retry_chunk_duration_ms = sparse_retry_chunk_duration_ms
        self.remove_file = remove_file or os.remove
        self.timeout_seconds = timeout_seconds
        self.normalizer = normalizer or TranscriptNormalizer()
        self.diarization_endpoint = diarization_endpoint.rstrip("/")
        self.diarization_deployment = diarization_deployment
        self.diarization_api_key = diarization_api_key
        self.diarization_api_version = diarization_api_version
        self.diarization_timeout_seconds = diarization_timeout_seconds
        self.diarization_max_workers = max(1, diarization_max_workers)
        self.max_chunk_duration_ms = max(1, max_chunk_duration_ms)
        self.independent_chunk_max_workers = max(1, independent_chunk_max_workers)
        self.provider_label = provider_label
        self.diarization_enabled = bool(
            self.diarization_endpoint
            and self.diarization_deployment
            and self.diarization_api_key
        )

    def transcribe(
        self,
        local_audio_path: str,
        on_progress=None,
        on_punctuation_usage=None,
        on_transcription_usage=None,
        workflow_context=None,
    ) -> dict:
        resolved_context = resolve_transcription_context(workflow_context)
        upload_plan = self.upload_plan_builder(local_audio_path)
        total_ms = upload_plan[-1]["end_ms"] if upload_plan else 0
        collected_segments = []
        detected_language = "unknown"
        successful_audio_ms = 0
        previous_transcript = ""
        diarization_executor = None
        diarization_future = None
        diarization_stop = None
        primary_completed = False
        callback_lock = Lock()

        if self.diarization_enabled:
            diarization_stop = Event()
            diarization_executor = ThreadPoolExecutor(max_workers=1)
            diarization_future = diarization_executor.submit(
                self._run_diarization,
                local_audio_path,
                diarization_stop,
            )

        def report_transcription_usage(update):
            nonlocal successful_audio_ms
            with callback_lock:
                successful_audio_ms += update.get("audio_ms", 0)
                if on_transcription_usage is not None:
                    on_transcription_usage(update)

        def report_punctuation_usage(update):
            if on_punctuation_usage is not None:
                with callback_lock:
                    on_punctuation_usage(update)

        def collect_diarization(*, poll_for_cancellation=True):
            nonlocal diarization_future
            if diarization_future is None:
                return None

            future = diarization_future
            wait_error = None
            while (
                poll_for_cancellation
                and on_progress is not None
                and not future.done()
            ):
                try:
                    on_progress(
                        {
                            "processed_ms": total_ms,
                            "total_ms": total_ms,
                            "percent": 100,
                        }
                    )
                except Exception as error:
                    diarization_stop.set()
                    wait_error = error
                    break
                try:
                    future.result(timeout=DIARIZATION_WAIT_POLL_SECONDS)
                except FutureTimeoutError:
                    continue
                except Exception:
                    break

            try:
                result = future.result()
            except Exception as error:  # speaker evidence must not fail primary text
                result = self._failed_diarization_result(str(error))
            diarization_future = None
            if result["request_count"] > 0:
                report_transcription_usage({"diarization": result})
            if wait_error is not None:
                raise wait_error
            return result

        try:
            try:
                if self.independent_chunk_max_workers == 1 or len(upload_plan) <= 1:
                    for part in upload_plan:
                        part_context = {
                            **resolved_context,
                            "previous_transcript": previous_transcript,
                        }
                        part_result = self._transcribe_part_with_quality_retry(
                            part,
                            on_punctuation_usage=report_punctuation_usage,
                            on_transcription_usage=report_transcription_usage,
                            workflow_context=part_context,
                            request_prompt=self._build_request_prompt(part_context),
                        )

                        if part_result.get("language") and detected_language == "unknown":
                            detected_language = part_result["language"]

                        collected_segments.extend(part_result["segments"])
                        previous_transcript = (
                            f"{previous_transcript} {part_result['text']}".strip()[
                                -PREVIOUS_TRANSCRIPT_CONTEXT_CHARS:
                            ]
                        )

                        if on_progress is not None:
                            processed_ms = part["end_ms"]
                            percent = (
                                100
                                if total_ms <= 0
                                else min(100, max(1, int((processed_ms / total_ms) * 100)))
                            )
                            on_progress(
                                {
                                    "processed_ms": processed_ms,
                                    "total_ms": total_ms,
                                    "percent": percent,
                                }
                            )
                else:
                    part_results = [None] * len(upload_plan)
                    completed_ms = 0
                    part_context = {
                        **resolved_context,
                        "previous_transcript": "",
                    }
                    executor = ThreadPoolExecutor(
                        max_workers=min(
                            self.independent_chunk_max_workers,
                            len(upload_plan),
                        )
                    )
                    try:
                        futures = {
                            executor.submit(
                                self._transcribe_part_with_quality_retry,
                                part,
                                on_punctuation_usage=report_punctuation_usage,
                                on_transcription_usage=report_transcription_usage,
                                workflow_context=part_context,
                                request_prompt=self._build_request_prompt(part_context),
                            ): (index, part)
                            for index, part in enumerate(upload_plan)
                        }
                        for future in as_completed(futures):
                            index, part = futures[future]
                            part_results[index] = future.result()
                            completed_ms += part["end_ms"] - part["start_ms"]
                            if on_progress is not None:
                                processed_ms = min(total_ms, completed_ms)
                                percent = (
                                    100
                                    if total_ms <= 0
                                    else min(
                                        100,
                                        max(1, int((processed_ms / total_ms) * 100)),
                                    )
                                )
                                on_progress(
                                    {
                                        "processed_ms": processed_ms,
                                        "total_ms": total_ms,
                                        "percent": percent,
                                    }
                                )
                    except BaseException:
                        executor.shutdown(wait=True, cancel_futures=True)
                        raise
                    else:
                        executor.shutdown(wait=True)

                    for part_result in part_results:
                        if part_result.get("language") and detected_language == "unknown":
                            detected_language = part_result["language"]
                        collected_segments.extend(part_result["segments"])
            finally:
                for part in upload_plan:
                    if part.get("cleanup"):
                        try:
                            self.remove_file(part["path"])
                        except OSError:
                            pass

            primary_completed = True
            diarization = None
            if diarization_future is not None:
                diarization = collect_diarization()
                collected_segments = self._attach_diarization_speakers(
                    collected_segments,
                    diarization.pop("chunks", []),
                )
                diarization["attributed_segment_count"] = sum(
                    1 for segment in collected_segments if segment.get("speaker")
                )
                diarization["total_segment_count"] = len(collected_segments)

            result = {
                "language": detected_language,
                "segments": collected_segments,
                "usage": {
                    "audio_ms": successful_audio_ms,
                },
            }
            if diarization is not None:
                result["diarization"] = diarization
            return result
        finally:
            if diarization_future is not None:
                if not primary_completed:
                    diarization_stop.set()
                collect_diarization(poll_for_cancellation=False)
            if diarization_executor is not None:
                diarization_executor.shutdown(wait=True, cancel_futures=True)

    def _failed_diarization_result(self, error: str) -> dict:
        return {
            "provider": "azure-openai",
            "model": self.diarization_deployment,
            "status": "failed",
            "audio_ms": 0,
            "request_count": 0,
            "unmetered_request_count": 0,
            "failed_chunk_count": 1,
            "reference_count": 0,
            "error": error,
            "chunks": [],
        }

    def _run_diarization(self, local_audio_path: str, stop_event=None) -> dict:
        plan = self._build_diarization_plan(local_audio_path)
        if not plan:
            return self._failed_diarization_result("audio duration is unavailable")

        def diarize_part(part, references):
            if stop_event is not None and stop_event.is_set():
                return {
                    "status": "failed",
                    **part,
                    "segments": [],
                    "audio_ms": 0,
                    "request_count": 0,
                    "unmetered_request_count": 0,
                    "error": "diarization cancelled after primary stopped",
                }
            return self._diarize_part(
                local_audio_path,
                part,
                references,
                stop_event=stop_event,
            )

        results = [diarize_part(plan[0], references=[])]
        references = []
        if results[0]["status"] == "complete" and not (
            stop_event is not None and stop_event.is_set()
        ):
            references.extend(
                self._build_speaker_references(
                    local_audio_path,
                    results[0]["segments"],
                    existing_references=references,
                )
            )
            results[0]["speaker_map"] = {
                reference["raw_label"]: reference["display_name"]
                for reference in references
            }

        next_plan_index = 1
        if (
            len(references) < MAX_SPEAKER_REFERENCES
            and len(plan) > 1
            and not (stop_event is not None and stop_event.is_set())
        ):
            existing_references = list(references)
            bootstrap_result = diarize_part(
                plan[1],
                references=existing_references,
            )
            results.append(bootstrap_result)
            next_plan_index = 2
            if bootstrap_result["status"] == "complete":
                new_references = self._build_speaker_references(
                    local_audio_path,
                    bootstrap_result["segments"],
                    existing_references=existing_references,
                )
                bootstrap_result["speaker_map"] = {
                    reference["provider_name"]: reference["display_name"]
                    for reference in existing_references
                }
                bootstrap_result["speaker_map"].update(
                    {
                        reference["raw_label"]: reference["display_name"]
                        for reference in new_references
                    }
                )
                references.extend(new_references)

        known_label_map = {
            reference["provider_name"]: reference["display_name"]
            for reference in references
        }
        remaining = plan[next_plan_index:]
        if remaining:
            with ThreadPoolExecutor(
                max_workers=min(self.diarization_max_workers, len(remaining))
            ) as executor:
                futures = {
                    executor.submit(
                        diarize_part,
                        part,
                        references,
                    ): part
                    for part in remaining
                }
                for future in as_completed(futures):
                    result = future.result()
                    result["speaker_map"] = known_label_map
                    results.append(result)

        repair_indexes = [
            index
            for index, result in enumerate(results)
            if result["status"] == "failed"
            and "DeploymentNotFound" in result.get("error", "")
        ]
        if repair_indexes and not (
            stop_event is not None and stop_event.is_set()
        ):
            if self._wait_for_diarization_retry(
                DIARIZATION_REPAIR_DELAY_SECONDS,
                stop_event,
            ):
                repair_indexes = []
            for index in repair_indexes:
                previous = results[index]
                repaired = diarize_part(
                    {
                        "start_ms": previous["start_ms"],
                        "end_ms": previous["end_ms"],
                    },
                    references,
                )
                repaired["request_count"] += previous["request_count"]
                repaired["unmetered_request_count"] += previous[
                    "unmetered_request_count"
                ]
                repaired["speaker_map"] = known_label_map
                results[index] = repaired

        chunks = []
        for result in sorted(results, key=lambda item: item["start_ms"]):
            if result["status"] != "complete":
                continue
            chunk_index = int(result["start_ms"] / DEFAULT_DIARIZATION_CHUNK_DURATION_MS) + 1
            segments = []
            for segment in result["segments"]:
                raw_speaker = str(segment.get("speaker") or "").strip()
                display_speaker = result.get("speaker_map", {}).get(raw_speaker)
                if not display_speaker:
                    display_speaker = (
                        f"Chunk {chunk_index:02d} "
                        f"{self._display_speaker_label(raw_speaker)}"
                    )
                segments.append({**segment, "speaker": display_speaker})
            chunks.append(
                {
                    "start_ms": result["start_ms"],
                    "end_ms": result["end_ms"],
                    "segments": segments,
                }
            )

        failed_chunk_count = sum(
            1 for result in results if result["status"] != "complete"
        )
        status = "complete" if failed_chunk_count == 0 else ("partial" if chunks else "failed")
        return {
            "provider": "azure-openai",
            "model": self.diarization_deployment,
            "status": status,
            "audio_ms": sum(result["audio_ms"] for result in results),
            "request_count": sum(result["request_count"] for result in results),
            "unmetered_request_count": sum(
                result["unmetered_request_count"] for result in results
            ),
            "failed_chunk_count": failed_chunk_count,
            "reference_count": len(references),
            "chunks": chunks,
        }

    def _build_diarization_plan(self, local_audio_path: str) -> list[dict]:
        total_duration_ms = self.duration_resolver(local_audio_path)
        return [
            {
                "start_ms": start_ms,
                "end_ms": min(
                    total_duration_ms,
                    start_ms + DEFAULT_DIARIZATION_CHUNK_DURATION_MS,
                ),
            }
            for start_ms in range(
                0,
                total_duration_ms,
                DEFAULT_DIARIZATION_CHUNK_DURATION_MS,
            )
        ]

    def _diarize_part(
        self,
        local_audio_path: str,
        part: dict,
        references: list[dict],
        *,
        stop_event=None,
    ) -> dict:
        upload_path = self._new_temp_audio_path(".wav")
        usage = None
        try:
            self._transcode_for_diarization(
                local_audio_path,
                upload_path,
                start_ms=part["start_ms"],
                duration_ms=part["end_ms"] - part["start_ms"],
            )
            payload, usage = self._transcribe_diarization_upload(
                upload_path,
                references=references,
                stop_event=stop_event,
            )
            segments = []
            for segment in payload.get("segments", []):
                speaker = str(segment.get("speaker") or "").strip()
                text = str(segment.get("text") or "")
                if not speaker or not text.strip():
                    continue
                segments.append(
                    {
                        "start_ms": part["start_ms"]
                        + int(float(segment.get("start", 0)) * 1000),
                        "end_ms": part["start_ms"]
                        + int(float(segment.get("end", 0)) * 1000),
                        "text": text,
                        "speaker": speaker,
                    }
                )
            return {
                "status": "complete",
                "start_ms": part["start_ms"],
                "end_ms": part["end_ms"],
                "segments": segments,
                "audio_ms": part["end_ms"] - part["start_ms"],
                **usage,
            }
        except AzureOpenAiDiarizationError as error:
            return {
                "status": "failed",
                "start_ms": part["start_ms"],
                "end_ms": part["end_ms"],
                "segments": [],
                "audio_ms": (
                    part["end_ms"] - part["start_ms"]
                    if error.request_count > error.unmetered_request_count
                    else 0
                ),
                "request_count": error.request_count,
                "unmetered_request_count": error.unmetered_request_count,
                "error": str(error),
            }
        except Exception as error:
            return {
                "status": "failed",
                "start_ms": part["start_ms"],
                "end_ms": part["end_ms"],
                "segments": [],
                "audio_ms": (
                    part["end_ms"] - part["start_ms"] if usage is not None else 0
                ),
                "request_count": usage["request_count"] if usage is not None else 0,
                "unmetered_request_count": (
                    usage["unmetered_request_count"] if usage is not None else 0
                ),
                "error": str(error),
            }
        finally:
            try:
                self.remove_file(upload_path)
            except OSError:
                pass

    def _build_speaker_references(
        self,
        local_audio_path: str,
        segments: list[dict],
        *,
        existing_references: list[dict],
    ) -> list[dict]:
        available_count = MAX_SPEAKER_REFERENCES - len(existing_references)
        if available_count <= 0:
            return []

        known_provider_names = {
            reference["provider_name"] for reference in existing_references
        }
        grouped = defaultdict(list)
        for segment in segments:
            duration_ms = segment["end_ms"] - segment["start_ms"]
            if (
                duration_ms > 0
                and segment["speaker"] not in known_provider_names
            ):
                grouped[segment["speaker"]].append(segment)

        ranked = sorted(
            (
                item
                for item in grouped.items()
                if sum(
                    segment["end_ms"] - segment["start_ms"]
                    for segment in item[1]
                )
                >= MIN_SPEAKER_REFERENCE_MS
            ),
            key=lambda item: sum(
                segment["end_ms"] - segment["start_ms"] for segment in item[1]
            ),
            reverse=True,
        )[:available_count]
        references = []
        for index, (raw_label, candidates) in enumerate(ranked):
            data_url = self._build_speaker_reference_data_url(
                local_audio_path,
                candidates,
            )
            if data_url is None:
                continue

            label = chr(ord("A") + len(existing_references) + index)
            references.append(
                {
                    "raw_label": raw_label,
                    "provider_name": f"Speaker_{label}",
                    "display_name": f"Speaker {label}",
                    "data_url": data_url,
                }
            )
        return references

    def _build_speaker_reference_data_url(
        self,
        local_audio_path: str,
        candidates: list[dict],
    ) -> str | None:
        longest = max(
            candidates,
            key=lambda candidate: candidate["end_ms"] - candidate["start_ms"],
        )
        longest_duration_ms = longest["end_ms"] - longest["start_ms"]
        if longest_duration_ms >= MIN_SPEAKER_REFERENCE_MS:
            duration_ms = min(TARGET_SPEAKER_REFERENCE_MS, longest_duration_ms)
            start_ms = longest["start_ms"] + (
                (longest_duration_ms - duration_ms) // 2
            )
            reference_path = self._new_temp_audio_path(".wav")
            try:
                self._transcode_for_diarization(
                    local_audio_path,
                    reference_path,
                    start_ms=start_ms,
                    duration_ms=duration_ms,
                )
                with open(reference_path, "rb") as handle:
                    return (
                        "data:audio/wav;base64,"
                        + base64.b64encode(handle.read()).decode("ascii")
                    )
            except (OSError, RuntimeError):
                return None
            finally:
                try:
                    self.remove_file(reference_path)
                except OSError:
                    pass

        selected = []
        selected_duration_ms = 0
        for segment in sorted(
            candidates,
            key=lambda candidate: candidate["end_ms"] - candidate["start_ms"],
            reverse=True,
        ):
            if selected_duration_ms >= TARGET_SPEAKER_REFERENCE_MS:
                break
            duration_ms = min(
                segment["end_ms"] - segment["start_ms"],
                TARGET_SPEAKER_REFERENCE_MS - selected_duration_ms,
            )
            selected.append((segment, duration_ms))
            selected_duration_ms += duration_ms
        if selected_duration_ms < MIN_SPEAKER_REFERENCE_MS:
            return None

        paths = []
        try:
            frames = []
            wave_format = None
            for segment, duration_ms in sorted(
                selected,
                key=lambda item: item[0]["start_ms"],
            ):
                path = self._new_temp_audio_path(".wav")
                paths.append(path)
                self._transcode_for_diarization(
                    local_audio_path,
                    path,
                    start_ms=segment["start_ms"],
                    duration_ms=duration_ms,
                )
                with wave.open(path, "rb") as clip:
                    current_format = (
                        clip.getnchannels(),
                        clip.getsampwidth(),
                        clip.getframerate(),
                        clip.getcomptype(),
                        clip.getcompname(),
                    )
                    if wave_format is None:
                        wave_format = current_format
                    elif current_format != wave_format:
                        return None
                    frames.append(clip.readframes(clip.getnframes()))

            output = io.BytesIO()
            with wave.open(output, "wb") as reference:
                reference.setnchannels(wave_format[0])
                reference.setsampwidth(wave_format[1])
                reference.setframerate(wave_format[2])
                reference.setcomptype(wave_format[3], wave_format[4])
                for clip_frames in frames:
                    reference.writeframes(clip_frames)
            return (
                "data:audio/wav;base64,"
                + base64.b64encode(output.getvalue()).decode("ascii")
            )
        except (OSError, RuntimeError, wave.Error):
            return None
        finally:
            for path in paths:
                try:
                    self.remove_file(path)
                except OSError:
                    pass

    def _display_speaker_label(self, raw_label: str) -> str:
        cleaned = raw_label.replace("_", " ").strip()
        if cleaned.lower().startswith("speaker "):
            return cleaned
        return f"Speaker {cleaned or 'Unknown'}"

    def _attach_diarization_speakers(
        self,
        primary_segments: list[dict],
        diarization_chunks: list[dict],
    ) -> list[dict]:
        updated = [dict(segment) for segment in primary_segments]
        for chunk in diarization_chunks:
            indexes = [
                index
                for index, segment in enumerate(updated)
                if chunk["start_ms"]
                <= (segment["start_ms"] + segment["end_ms"]) / 2
                < chunk["end_ms"]
            ]
            if not indexes:
                continue
            aligned = self._align_speakers_for_chunk(
                [updated[index] for index in indexes],
                chunk["segments"],
            )
            for index, segment in zip(indexes, aligned, strict=True):
                updated[index] = segment
        return updated

    def _align_speakers_for_chunk(
        self,
        primary_segments: list[dict],
        diarization_segments: list[dict],
    ) -> list[dict]:
        primary_chars = []
        primary_owners = []
        for index, segment in enumerate(primary_segments):
            chars = _speaker_alignment_chars(
                segment.get("display_text") or segment.get("text") or ""
            )
            primary_chars.extend(chars)
            primary_owners.extend([index] * len(chars))

        diarization_chars = []
        diarization_owners = []
        for index, segment in enumerate(diarization_segments):
            chars = _speaker_alignment_chars(segment.get("text") or "")
            diarization_chars.extend(chars)
            diarization_owners.extend([index] * len(chars))

        votes = defaultdict(Counter)
        matched_chars = Counter()
        matcher = SequenceMatcher(
            None,
            primary_chars,
            diarization_chars,
            autojunk=False,
        )
        # ponytail: quadratic alignment is bounded to one five-minute chunk;
        # replace only if measured transcript density makes it slow.
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                primary_index = primary_owners[block.a + offset]
                diarization_index = diarization_owners[block.b + offset]
                speaker = diarization_segments[diarization_index]["speaker"]
                votes[primary_index][speaker] += 1
                matched_chars[primary_index] += 1

        result = [dict(segment) for segment in primary_segments]
        for index, segment in enumerate(result):
            significant_chars = len(
                _speaker_alignment_chars(
                    segment.get("display_text") or segment.get("text") or ""
                )
            )
            if not votes[index] or significant_chars == 0:
                continue
            speaker, speaker_chars = votes[index].most_common(1)[0]
            coverage = matched_chars[index] / significant_chars
            dominance = speaker_chars / matched_chars[index]
            duration_ms = segment["end_ms"] - segment["start_ms"]
            if (
                matched_chars[index] < MIN_SPEAKER_ALIGNMENT_CHARS
                or coverage < MIN_SPEAKER_ALIGNMENT_COVERAGE
                or dominance < MIN_SPEAKER_ALIGNMENT_DOMINANCE
                or duration_ms > MAX_SPEAKER_ALIGNMENT_SEGMENT_MS
            ):
                continue
            segment["speaker"] = speaker
            segment["speaker_source"] = self.diarization_deployment
            segment["speaker_alignment_score"] = round(coverage * dominance, 3)
        return result

    def _transcribe_part_with_quality_retry(
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

        quality_issue = self._transcript_quality_issue(part, part_result["text"])
        if quality_issue is None:
            return part_result

        detected_language = part_result["language"]
        retry_chunk_duration_ms = (
            REPETITIVE_TRANSCRIPT_RETRY_CHUNK_DURATION_MS
            if quality_issue == "repetitive"
            else self.sparse_retry_chunk_duration_ms
        )
        retry_prompt = request_prompt
        if quality_issue == "repetitive":
            retry_prompt = self._build_repetition_retry_prompt(workflow_context)

        for _attempt in range(TRANSCRIPT_QUALITY_RETRY_ATTEMPTS):
            retry_parts = self._build_retry_upload_plan(
                part,
                retry_chunk_duration_ms,
            )
            retry_segments = []

            try:
                for retry_part in retry_parts:
                    retry_payload = self._transcribe_upload(
                        retry_part["path"], request_prompt=retry_prompt
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
                    if (
                        retry_result.get("language")
                        and detected_language == "unknown"
                    ):
                        detected_language = retry_result["language"]
                    retry_segments.extend(retry_result["segments"])
            finally:
                for retry_part in retry_parts:
                    try:
                        self.remove_file(retry_part["path"])
                    except OSError:
                        pass

            retry_text = self._segments_to_text(retry_segments)
            quality_issue = self._transcript_quality_issue(part, retry_text)
            if quality_issue is None:
                return {
                    "language": detected_language,
                    "segments": retry_segments,
                    "text": retry_text,
                }
            if quality_issue == "repetitive":
                retry_chunk_duration_ms = min(
                    retry_chunk_duration_ms,
                    REPETITIVE_TRANSCRIPT_RETRY_CHUNK_DURATION_MS,
                )
                retry_prompt = self._build_repetition_retry_prompt(workflow_context)

        raise RuntimeError(
            f"{self.provider_label} transcription returned suspiciously {quality_issue} text "
            f"for an audio chunk after {TRANSCRIPT_QUALITY_RETRY_ATTEMPTS} "
            f"bounded retries (startMs={part['start_ms']}, "
            f"endMs={part['end_ms']}, chars={self._text_density_chars(retry_text)})"
        )

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
        lexical_changed = False
        polish_usage = None
        if self.punctuator is not None and text.strip():
            if hasattr(self.punctuator, "restore_with_usage"):
                punctuation_result = self.punctuator.restore_with_usage(text)
                text = punctuation_result["text"]
                lexical_changed = punctuation_result.get("lexical_changed", False)
                polish_usage = punctuation_result["usage"]
                if on_punctuation_usage is not None:
                    on_punctuation_usage(polish_usage)
            else:
                text = self.punctuator.restore(text)

        if lexical_changed:
            review_flags = [
                *normalized["review_flags"],
                {
                    "reason": "llm-polished",
                    "original_text": normalized["raw_text"],
                    "candidates": [text],
                    "start_ms": part["start_ms"],
                    "end_ms": part["end_ms"],
                    "evidence": (
                        f"{polish_usage['model']} reasoning="
                        f"{polish_usage['reasoning_effort']}"
                    ),
                },
            ]
            segment = {
                "start_ms": part["start_ms"],
                "end_ms": part["end_ms"],
                "text": text,
                "raw_text": normalized["raw_text"],
                "display_text": text,
                "language": normalized["language"],
                "timing_source": normalized["timing_source"],
                "review_flags": review_flags,
            }
            if "language_confidence" in normalized:
                segment["language_confidence"] = normalized["language_confidence"]
            return {
                "language": language,
                "segments": [segment],
                "text": text,
            }

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

    def _build_retry_upload_plan(
        self,
        part: dict,
        retry_chunk_duration_ms: int,
    ) -> list[dict]:
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

    def _build_repetition_retry_prompt(self, workflow_context) -> str:
        retry_context = {
            **(workflow_context or {}),
            "previous_transcript": "",
        }
        return self._build_request_prompt(retry_context)

    def _build_request_prompt(self, workflow_context) -> str:
        return build_transcription_prompt(self.prompt, workflow_context)

    def _transcript_quality_issue(self, part: dict, text: str) -> str | None:
        if (
            self._part_duration_ms(part) >= REPETITIVE_TRANSCRIPT_MIN_DURATION_MS
            and self._is_text_repetitive(text)
        ):
            return "repetitive"
        if self._is_suspicious_sparse_part(part, text):
            return "sparse"
        return None

    def _is_text_repetitive(self, text: str) -> bool:
        compact_text = "".join(text.split()).encode("utf-8")
        if not compact_text:
            return False
        return (
            len(compact_text) / len(gzip.compress(compact_text))
            > REPETITIVE_TRANSCRIPT_GZIP_RATIO
        )

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
            self._transcription_url(),
            method="POST",
            headers=self._transcription_headers(boundary),
            data=body,
        )

        try:
            with self.urlopen(  # noqa: S310
                http_request,
                timeout=self.timeout_seconds,
            ) as response:
                return self._normalize_transcription_payload(
                    json.loads(response.read().decode("utf-8"))
                )
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="replace").strip()
            message = f"{self.provider_label} transcription failed with status {error.code}"
            if details:
                message = f"{message}: {details}"
            raise RuntimeError(message) from error

    def _transcription_url(self) -> str:
        return (
            f"{self.endpoint}/openai/deployments/{self.deployment}/audio/transcriptions"
            f"?api-version={self.api_version}"
        )

    def _transcription_headers(self, boundary: str) -> dict[str, str]:
        return {
            "api-key": self.api_key,
            "content-type": f"multipart/form-data; boundary={boundary}",
        }

    def _normalize_transcription_payload(self, payload: dict) -> dict:
        return payload

    def _transcribe_diarization_upload(
        self,
        upload_path: str,
        *,
        references: list[dict],
        stop_event=None,
    ) -> tuple[dict, dict]:
        boundary = f"----AINoteTacker{uuid.uuid4().hex}"
        content_type = mimetypes.guess_type(upload_path)[0] or "application/octet-stream"
        file_name = os.path.basename(upload_path)

        with open(upload_path, "rb") as handle:
            audio_bytes = handle.read()

        fields = [
            self._encode_field(boundary, "model", self.diarization_deployment),
            self._encode_field(boundary, "response_format", "diarized_json"),
            self._encode_field(boundary, "chunking_strategy", "auto"),
        ]
        for reference in references:
            fields.append(
                self._encode_field(
                    boundary,
                    "known_speaker_names[]",
                    reference["provider_name"],
                )
            )
            fields.append(
                self._encode_field(
                    boundary,
                    "known_speaker_references[]",
                    reference["data_url"],
                )
            )
        fields.append(
            self._encode_file(boundary, "file", file_name, content_type, audio_bytes)
        )
        fields.append(f"--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(fields)
        url = (
            f"{self.diarization_endpoint}/openai/deployments/"
            f"{self.diarization_deployment}/audio/transcriptions"
            f"?api-version={self.diarization_api_version}"
        )

        attempt = 0
        deployment_not_found_retried = False
        http_400_retried = False
        transport_retry_delays = iter(DIARIZATION_TRANSPORT_RETRY_DELAYS_SECONDS)
        while True:
            if stop_event is not None and stop_event.is_set():
                raise AzureOpenAiDiarizationError(
                    "Azure OpenAI diarization cancelled before provider retry",
                    request_count=attempt,
                    unmetered_request_count=attempt,
                )
            attempt += 1
            http_request = request.Request(
                url,
                method="POST",
                headers={
                    "api-key": self.diarization_api_key,
                    "content-type": f"multipart/form-data; boundary={boundary}",
                },
                data=body,
            )
            try:
                with self.urlopen(  # noqa: S310
                    http_request,
                    timeout=self.diarization_timeout_seconds,
                ) as response:
                    try:
                        payload = json.loads(response.read().decode("utf-8"))
                    except (UnicodeDecodeError, json.JSONDecodeError) as error:
                        raise AzureOpenAiDiarizationError(
                            "Azure OpenAI diarization returned an invalid response",
                            request_count=attempt,
                            unmetered_request_count=attempt - 1,
                        ) from error
                    return payload, {
                        "request_count": attempt,
                        "unmetered_request_count": attempt - 1,
                    }
            except AzureOpenAiDiarizationError:
                raise
            except urllib.error.HTTPError as error:
                details = error.read().decode("utf-8", errors="replace").strip()
                if (
                    error.code == 404
                    and "DeploymentNotFound" in details
                    and not deployment_not_found_retried
                ):
                    deployment_not_found_retried = True
                    if self._wait_for_diarization_retry(
                        DIARIZATION_DEPLOYMENT_RETRY_DELAYS_SECONDS[0],
                        stop_event,
                    ):
                        raise AzureOpenAiDiarizationError(
                            "Azure OpenAI diarization cancelled before provider retry",
                            request_count=attempt,
                            unmetered_request_count=attempt,
                        ) from error
                    continue
                if error.code == 400 and not http_400_retried:
                    http_400_retried = True
                    if self._wait_for_diarization_retry(
                        DIARIZATION_HTTP_400_RETRY_DELAY_SECONDS,
                        stop_event,
                    ):
                        raise AzureOpenAiDiarizationError(
                            "Azure OpenAI diarization cancelled before provider retry",
                            request_count=attempt,
                            unmetered_request_count=attempt,
                        ) from error
                    continue
                message = (
                    "Azure OpenAI diarization failed "
                    f"with status {error.code}"
                )
                if details:
                    message = f"{message}: {details}"
                raise AzureOpenAiDiarizationError(
                    message,
                    request_count=attempt,
                    unmetered_request_count=attempt,
                ) from error
            except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
                try:
                    delay_seconds = next(transport_retry_delays)
                except StopIteration:
                    raise AzureOpenAiDiarizationError(
                        "Azure OpenAI diarization transport failed after "
                        f"{len(DIARIZATION_TRANSPORT_RETRY_DELAYS_SECONDS)} "
                        f"retries: {error}",
                        request_count=attempt,
                        unmetered_request_count=attempt,
                    ) from error
                if self._wait_for_diarization_retry(
                    delay_seconds,
                    stop_event,
                ):
                    raise AzureOpenAiDiarizationError(
                        "Azure OpenAI diarization cancelled before provider retry",
                        request_count=attempt,
                        unmetered_request_count=attempt,
                    ) from error
            except Exception as error:
                raise AzureOpenAiDiarizationError(
                    f"Azure OpenAI diarization request failed: {error}",
                    request_count=attempt,
                    unmetered_request_count=attempt,
                ) from error

    def _wait_for_diarization_retry(self, delay_seconds: float, stop_event) -> bool:
        if stop_event is None:
            self.retry_sleep(delay_seconds)
            return False
        if self.retry_sleep is not time.sleep:
            self.retry_sleep(delay_seconds)
            return stop_event.is_set()
        return stop_event.wait(delay_seconds)

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
            and total_duration_ms <= self.max_chunk_duration_ms
        ):
            return [
                {
                    "path": local_audio_path,
                    "start_ms": 0,
                    "end_ms": total_duration_ms,
                    "cleanup": False,
                }
            ]

        if total_duration_ms <= self.max_chunk_duration_ms:
            compressed_path = self._new_temp_audio_path(".mp3")
            self._transcode_for_upload(local_audio_path, compressed_path)
            if os.path.getsize(compressed_path) <= MAX_AUDIO_UPLOAD_BYTES:
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
        for start_ms in range(0, total_duration_ms, self.max_chunk_duration_ms):
            duration_ms = min(self.max_chunk_duration_ms, total_duration_ms - start_ms)
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

    def _transcode_for_diarization(
        self,
        source_path: str,
        output_path: str,
        *,
        start_ms: int,
        duration_ms: int,
    ) -> None:
        result = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                f"{start_ms / 1000:.3f}",
                "-i",
                source_path,
                "-t",
                f"{duration_ms / 1000:.3f}",
                "-vn",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                output_path,
                "-y",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Failed to prepare Azure diarization audio: "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
