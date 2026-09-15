import io
import json
from pathlib import Path
import tempfile
from threading import Barrier, Lock
import time
import unittest
import urllib.error

from transcription_worker.mai_transcriber import MaiTranscriber
from transcription_worker.transcript_normalizer import TranscriptNormalizer


class _Response:
    def __init__(self, payload, headers=None):
        self.payload = payload
        self.status = 200
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class _TraditionalConverter:
    def convert(self, text):
        return text.replace("条码", "條碼")


class MaiTranscriberTests(unittest.TestCase):
    def test_uses_verbatim_oracle_free_definition_and_retries_one_http_400(self) -> None:
        requests = []
        sleeps = []
        audit_updates = []

        def urlopen(http_request, timeout):
            requests.append((http_request, timeout))
            if len(requests) == 1:
                raise urllib.error.HTTPError(
                    http_request.full_url,
                    400,
                    "Bad Request",
                    None,
                    io.BytesIO(b'{"error":{"message":"temporary decoder failure"}}'),
                )
            return _Response(
                {
                    "combinedPhrases": [{"text": "掃描舌片条码。"}],
                    "phrases": [
                        {
                            "text": "掃描舌片条码。",
                            "locale": "zh-CN",
                            "offsetMilliseconds": 0,
                            "durationMilliseconds": 30_000,
                        }
                    ],
                },
                headers={"x-ms-request-id": "mai-request-2"},
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                retry_sleep=sleeps.append,
                upload_plan_builder=lambda path: [
                    {
                        "path": path,
                        "start_ms": 0,
                        "end_ms": 30_000,
                        "cleanup": False,
                    }
                ],
                normalizer=TranscriptNormalizer(converter=_TraditionalConverter()),
            )

            result = transcriber.transcribe(
                str(source), on_provider_request=audit_updates.append
            )

            self.assertEqual(len(requests), 2)
            self.assertEqual(sleeps, [2.0])
            self.assertEqual(
                requests[0][0].full_url,
                "https://speech.example.test/speechtotext/transcriptions:transcribe"
                "?api-version=2025-10-15",
            )
            request_body = requests[0][0].data
            self.assertIn(b'"model":"MAI-Transcribe-2"', request_body)
            self.assertIn(b'"transcribeStyle":"verbatim"', request_body)
            self.assertIn(b'"timestamps":"word"', request_body)
            self.assertIn(b'"diarization":{"enabled":true}', request_body)
            # maxSpeakers is rejected by MAI; an empty job glossary sends no phraseList.
            self.assertNotIn(b"maxSpeakers", request_body)
            self.assertNotIn(b"phraseList", request_body)
            self.assertNotIn(b"locales", request_body)
            self.assertNotIn(b'name="prompt"', request_body)
            self.assertIn(b'name="audio"', request_body)
            self.assertEqual(result["language"], "zh-Hant")
            self.assertEqual(result["segments"][0]["raw_text"], "掃描舌片条码。")
            self.assertEqual(result["segments"][0]["display_text"], "掃描舌片條碼。")
            self.assertEqual(result["segments"][0]["language"], "zh-Hant")
            self.assertEqual(
                result["usage"],
                {
                    "audio_ms": 30_000,
                    "billed_audio_ms": 30_000,
                    "provider_request_count": 2,
                    "unmetered_request_count": 1,
                },
            )
            self.assertEqual(
                [update["action"] for update in audit_updates],
                ["start", "finish", "start", "finish"],
            )
            self.assertEqual(
                [update.get("status") for update in audit_updates if update["action"] == "finish"],
                ["failed", "succeeded"],
            )
            self.assertNotEqual(audit_updates[0]["requestId"], audit_updates[2]["requestId"])
            self.assertEqual(audit_updates[3]["providerRequestId"], "mai-request-2")
            self.assertEqual(
                audit_updates[3]["usage"],
                {"audioMs": 30_000, "billedAudioMs": 30_000},
            )

    def test_rounds_each_successful_upload_to_a_whole_billed_second(self) -> None:
        parts = [
            {
                "path": f"chunk-{index}.wav",
                "start_ms": start_ms,
                "end_ms": end_ms,
                "cleanup": False,
            }
            for index, (start_ms, end_ms) in enumerate(
                ((0, 30_000), (30_000, 60_000), (60_000, 90_000), (90_000, 109_760))
            )
        ]
        transcriber = MaiTranscriber(
            endpoint="https://speech.example.test",
            api_key="secret",
            upload_plan_builder=lambda _path: parts,
        )
        transcriber.independent_chunk_max_workers = 1
        transcriber._transcribe_upload = lambda *_args, **_kwargs: {
            "text": "完成。",
            "language": "zh-Hant",
            "_transcription_usage": {
                "provider_request_count": 1,
                "unmetered_request_count": 0,
            },
        }

        result = transcriber.transcribe("meeting.wav")

        self.assertEqual(result["usage"]["audio_ms"], 109_760)
        self.assertEqual(result["usage"]["billed_audio_ms"], 110_000)
        self.assertEqual(result["usage"]["provider_request_count"], 4)
        self.assertEqual(result["usage"]["unmetered_request_count"], 0)

    def test_splits_long_uploads_into_overlapping_lossless_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            calls = []
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                # 55 minutes: longer than one 25-minute diarization window.
                duration_resolver=lambda _path: 3_300_000,
            )
            suffixes = []

            def new_temp_audio_path(suffix):
                suffixes.append(suffix)
                return str(Path(temp_dir) / f"chunk-{len(calls)}{suffix}")

            transcriber._new_temp_audio_path = new_temp_audio_path
            transcriber._transcode_for_upload = (
                lambda _source, _target, *, start_ms=0, duration_ms=None: calls.append(
                    (start_ms, duration_ms)
                )
            )

            plan = transcriber._build_upload_plan(str(source))

            # 25-minute chunks advancing by 22 minutes leave a 3-minute shared window
            # so request-scoped speaker ids can be linked across each seam.
            self.assertEqual(
                calls,
                [(0, 1_500_000), (1_320_000, 1_500_000), (2_640_000, 660_000)],
            )
            self.assertEqual(
                [(part["start_ms"], part["end_ms"]) for part in plan],
                [(0, 1_500_000), (1_320_000, 2_820_000), (2_640_000, 3_300_000)],
            )
            self.assertEqual(set(suffixes), {".wav"})

    def test_overlapping_plan_stops_once_the_end_is_covered(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            calls = []
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                # Just past one chunk: a second stride would re-upload covered audio.
                duration_resolver=lambda _path: 1_510_000,
            )
            transcriber._new_temp_audio_path = lambda suffix: str(
                Path(temp_dir) / f"chunk-{len(calls)}{suffix}"
            )
            transcriber._transcode_for_upload = (
                lambda _source, _target, *, start_ms=0, duration_ms=None: calls.append(
                    (start_ms, duration_ms)
                )
            )

            plan = transcriber._build_upload_plan(str(source))

            self.assertEqual(
                [(part["start_ms"], part["end_ms"]) for part in plan],
                [(0, 1_500_000), (1_320_000, 1_510_000)],
            )

    def test_retries_transient_transport_failures_with_bounded_backoff(self) -> None:
        requests = []
        sleeps = []

        def urlopen(http_request, timeout):
            requests.append((http_request, timeout))
            if len(requests) < 4:
                raise urllib.error.URLError(OSError(-2, "Name or service not known"))
            return _Response(
                {
                    "combinedPhrases": [{"text": "掃描條碼。"}],
                    "phrases": [{"text": "掃描條碼。", "locale": "zh"}],
                }
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                retry_sleep=sleeps.append,
            )

            result = transcriber._transcribe_upload(str(source))

        self.assertEqual(result["text"], "掃描條碼。")
        self.assertEqual(len(requests), 4)
        self.assertEqual(sleeps, [2.0, 10.0, 30.0])

    def test_processes_independent_chunks_concurrently_and_keeps_time_order(self) -> None:
        barrier = Barrier(3, timeout=1)
        parts = [
            {
                "path": f"chunk-{index}.wav",
                "start_ms": index * 30_000,
                "end_ms": (index + 1) * 30_000,
                "cleanup": False,
            }
            for index in range(3)
        ]
        transcriber = MaiTranscriber(
            endpoint="https://speech.example.test",
            api_key="secret",
            upload_plan_builder=lambda _path: parts,
        )

        def transcribe_part(part, **_kwargs):
            barrier.wait()
            return {
                "language": "zh",
                "segments": [
                    {
                        "start_ms": part["start_ms"],
                        "end_ms": part["end_ms"],
                        "text": str(part["start_ms"]),
                    }
                ],
                "text": str(part["start_ms"]),
            }

        transcriber._transcribe_part_with_quality_retry = transcribe_part
        result = transcriber.transcribe("meeting.wav")

        self.assertEqual(
            [segment["start_ms"] for segment in result["segments"]],
            [0, 30_000, 60_000],
        )

    def test_stops_queued_chunks_after_the_first_concurrent_failure(self) -> None:
        first_wave = Barrier(3, timeout=1)
        started = []
        started_lock = Lock()
        parts = [
            {
                "path": f"chunk-{index}.wav",
                "start_ms": index * 30_000,
                "end_ms": (index + 1) * 30_000,
                "cleanup": False,
            }
            for index in range(6)
        ]
        transcriber = MaiTranscriber(
            endpoint="https://speech.example.test",
            api_key="secret",
            upload_plan_builder=lambda _path: parts,
        )

        def transcribe_part(part, **_kwargs):
            index = part["start_ms"] // 30_000
            with started_lock:
                started.append(index)
            if index < 3:
                first_wave.wait()
            if index == 0:
                raise RuntimeError("provider failed")
            time.sleep(0.1)
            return {
                "language": "zh",
                "segments": [],
                "text": "",
            }

        transcriber._transcribe_part_with_quality_retry = transcribe_part

        with self.assertRaisesRegex(RuntimeError, "provider failed"):
            transcriber.transcribe("meeting.wav")

        self.assertLess(len(started), len(parts))

    def test_keeps_provider_speaker_and_timings_from_phrases(self) -> None:
        def urlopen(_http_request, timeout):
            return _Response(
                {
                    "durationMilliseconds": 20_000,
                    "combinedPhrases": [{"text": "掃描条码。 好的。"}],
                    "phrases": [
                        {
                            "speaker": 1,
                            "offsetMilliseconds": 2_000,
                            "durationMilliseconds": 3_000,
                            "text": "掃描条码。",
                            "locale": "zh",
                        },
                        {
                            "speaker": 0,
                            "offsetMilliseconds": 6_000,
                            "durationMilliseconds": 1_500,
                            "text": "好的。",
                            "locale": "zh",
                        },
                    ],
                }
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                upload_plan_builder=lambda path: [
                    {"path": path, "start_ms": 0, "end_ms": 20_000, "cleanup": False}
                ],
                normalizer=TranscriptNormalizer(converter=_TraditionalConverter()),
            )

            segments = transcriber.transcribe(str(source))["segments"]

        self.assertEqual([segment["start_ms"] for segment in segments], [2_000, 6_000])
        self.assertEqual([segment["end_ms"] for segment in segments], [5_000, 7_500])
        self.assertEqual(
            [segment["timing_source"] for segment in segments], ["provider", "provider"]
        )
        # Provider ids were 1 then 0; the reader numbers voices by first appearance.
        self.assertEqual(
            [segment["speaker"] for segment in segments], ["Speaker 1", "Speaker 2"]
        )
        self.assertEqual(segments[0]["speaker_source"], "provider-diarization")
        self.assertEqual(segments[0]["raw_text"], "掃描条码。")
        self.assertEqual(segments[0]["display_text"], "掃描條碼。")

    def test_uses_word_timestamps_when_phrase_timing_is_empty(self) -> None:
        # Observed on a 25-minute chunk: every phrase reported offset 0 / duration 0
        # while its words carried the real times. Those must not collapse to one instant.
        def urlopen(_http_request, timeout):
            return _Response(
                {
                    "durationMilliseconds": 1_500_000,
                    "combinedPhrases": [{"text": "第一句。 第二句。"}],
                    "phrases": [
                        {
                            "speaker": 0,
                            "offsetMilliseconds": 0,
                            "durationMilliseconds": 0,
                            "text": "第一句。",
                            "words": [
                                {"text": "第一", "offsetMilliseconds": 160, "durationMilliseconds": 300},
                                {"text": "句。", "offsetMilliseconds": 500, "durationMilliseconds": 200},
                            ],
                        },
                        {
                            "speaker": 1,
                            "offsetMilliseconds": 0,
                            "durationMilliseconds": 0,
                            "text": "第二句。",
                            "words": [
                                {"text": "第二", "offsetMilliseconds": 1_494_440, "durationMilliseconds": 300},
                                {"text": "句。", "offsetMilliseconds": 1_494_800, "durationMilliseconds": 200},
                            ],
                        },
                    ],
                }
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                upload_plan_builder=lambda path: [
                    {"path": path, "start_ms": 1_320_000, "end_ms": 2_820_000, "cleanup": False}
                ],
                # Two phrases for 25 minutes look sparse; keep the quality gate out of it.
                audio_activity_detector=lambda _path: False,
            )

            segments = transcriber.transcribe(str(source))["segments"]

        # Chunk offset + word offsets, not chunk offset + 0.
        self.assertEqual([s["start_ms"] for s in segments], [1_320_160, 2_814_440])
        self.assertEqual([s["end_ms"] for s in segments], [1_320_700, 2_815_000])
        self.assertEqual([s["speaker"] for s in segments], ["Speaker 1", "Speaker 2"])

    def test_never_drops_a_whole_chunk_while_trimming_overlap(self) -> None:
        # A chunk whose timings are all wrong would be trimmed to nothing; keep it
        # instead, because duplicated lines beat 25 lost minutes.
        parts = [
            {"path": "chunk-0.wav", "start_ms": 0, "end_ms": 30_000, "cleanup": False},
            {"path": "chunk-1.wav", "start_ms": 20_000, "end_ms": 50_000, "cleanup": False},
        ]
        groups = {
            0: [{"start_ms": 0, "end_ms": 10_000}, {"start_ms": 20_000, "end_ms": 30_000}],
            # Everything stacked at the chunk start: the classic broken-timing shape.
            1: [{"start_ms": 20_000, "end_ms": 20_000}, {"start_ms": 20_000, "end_ms": 20_000}],
        }
        transcriber = MaiTranscriber(
            endpoint="https://speech.example.test",
            api_key="secret",
            upload_plan_builder=lambda _path: parts,
        )
        transcriber._transcribe_part_with_quality_retry = lambda part, **_kwargs: {
            "language": "zh",
            "segments": [
                {**segment, "text": f"p{part['start_ms']}-{index}"}
                for index, segment in enumerate(groups[0 if part["start_ms"] == 0 else 1])
            ],
            "text": "",
        }

        texts = [segment["text"] for segment in transcriber.transcribe("meeting.wav")["segments"]]

        self.assertIn("p20000-0", texts)
        self.assertIn("p20000-1", texts)

    def test_links_speaker_ids_across_the_chunk_overlap(self) -> None:
        # Chunk 1 numbers the same two voices differently; the shared window is the
        # only evidence that its speaker 1 is chunk 0's speaker 0.
        groups = {
            0: [
                {"start_ms": 0, "end_ms": 10_000, "speaker_index": 0},
                {"start_ms": 20_000, "end_ms": 30_000, "speaker_index": 1},
            ],
            1: [
                {"start_ms": 20_500, "end_ms": 29_000, "speaker_index": 2},
                {"start_ms": 40_000, "end_ms": 50_000, "speaker_index": 1},
            ],
        }
        parts = [
            {"path": "chunk-0.wav", "start_ms": 0, "end_ms": 30_000, "cleanup": False},
            {"path": "chunk-1.wav", "start_ms": 20_000, "end_ms": 50_000, "cleanup": False},
        ]
        transcriber = MaiTranscriber(
            endpoint="https://speech.example.test",
            api_key="secret",
            upload_plan_builder=lambda _path: parts,
        )
        transcriber._transcribe_part_with_quality_retry = lambda part, **_kwargs: {
            "language": "zh",
            "segments": [
                {**segment, "text": str(segment["start_ms"])}
                for segment in groups[0 if part["start_ms"] == 0 else 1]
            ],
            "text": "",
        }

        segments = transcriber.transcribe("meeting.wav")["segments"]

        # The duplicated 20.5s span is kept once, from the chunk that owns it. Chunk 1's
        # speaker 2 is linked to chunk 0's speaker 1 through that window, while its
        # speaker 1 — silent through the overlap — gets a fresh label instead of
        # silently colliding with chunk 0's unrelated speaker 1.
        self.assertEqual(
            [(segment["start_ms"], segment["speaker"]) for segment in segments],
            [(0, "Speaker 1"), (20_000, "Speaker 2"), (40_000, "Speaker 3")],
        )

    def test_drops_diarization_and_keeps_text_when_only_diarization_fails(self) -> None:
        requests = []
        sleeps = []

        def urlopen(http_request, timeout):
            requests.append(http_request)
            if len(requests) == 1:
                raise urllib.error.HTTPError(
                    http_request.full_url,
                    503,
                    "Service Unavailable",
                    {},
                    io.BytesIO(
                        b'{"error":{"code":"diarization_unavailable",'
                        b'"message":"Speaker diarization service is unavailable"}}'
                    ),
                )
            return _Response(
                {
                    "combinedPhrases": [{"text": "掃描條碼。"}],
                    "phrases": [
                        {
                            "offsetMilliseconds": 0,
                            "durationMilliseconds": 4_000,
                            "text": "掃描條碼。",
                            "locale": "zh",
                        }
                    ],
                }
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                retry_sleep=sleeps.append,
                upload_plan_builder=lambda path: [
                    {"path": path, "start_ms": 0, "end_ms": 4_000, "cleanup": False}
                ],
            )

            result = transcriber.transcribe(str(source))

        self.assertEqual(len(requests), 2)
        self.assertEqual(sleeps, [2.0])
        self.assertIn(b'"diarization"', requests[0].data)
        self.assertNotIn(b'"diarization"', requests[1].data)
        self.assertEqual(result["segments"][0]["display_text"], "掃描條碼。")
        self.assertNotIn("speaker", result["segments"][0])

    def test_sends_accepted_glossary_terms_as_a_phrase_list(self) -> None:
        requests = []

        def urlopen(http_request, timeout):
            requests.append(http_request)
            return _Response({"combinedPhrases": [{"text": "Tray"}], "phrases": []})

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                urlopen=urlopen,
                upload_plan_builder=lambda path: [
                    {"path": path, "start_ms": 0, "end_ms": 4_000, "cleanup": False}
                ],
            )

            transcriber.transcribe(
                str(source),
                workflow_context={
                    "glossary": [
                        {"term": "Tray", "accepted": True},
                        {"term": "未採用詞", "accepted": False},
                    ]
                },
            )

        self.assertIn(b'"phraseList":{"phrases":["Tray"]}', requests[0].data)
        self.assertNotIn("未採用詞".encode("utf-8"), requests[0].data)


if __name__ == "__main__":
    unittest.main()
