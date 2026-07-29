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
    def __init__(self, payload):
        self.payload = payload

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
                            "locale": "zh",
                            "offsetMilliseconds": 0,
                            "durationMilliseconds": 30_000,
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
                    {
                        "path": path,
                        "start_ms": 0,
                        "end_ms": 30_000,
                        "cleanup": False,
                    }
                ],
                normalizer=TranscriptNormalizer(converter=_TraditionalConverter()),
            )

            result = transcriber.transcribe(str(source))

            self.assertEqual(len(requests), 2)
            self.assertEqual(sleeps, [2.0])
            self.assertEqual(
                requests[0][0].full_url,
                "https://speech.example.test/speechtotext/transcriptions:transcribe"
                "?api-version=2025-10-15",
            )
            request_body = requests[0][0].data
            self.assertIn(b'"model":"mai-transcribe-1.5"', request_body)
            self.assertIn(b'"transcribeStyle":"verbatim"', request_body)
            self.assertNotIn(b"phraseList", request_body)
            self.assertNotIn(b"locales", request_body)
            self.assertNotIn(b'name="prompt"', request_body)
            self.assertIn(b'name="audio"', request_body)
            self.assertEqual(result["language"], "zh")
            self.assertEqual(result["segments"][0]["raw_text"], "掃描舌片条码。")
            self.assertEqual(result["segments"][0]["display_text"], "掃描舌片條碼。")

    def test_splits_uploads_at_thirty_seconds(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            calls = []
            transcriber = MaiTranscriber(
                endpoint="https://speech.example.test",
                api_key="secret",
                duration_resolver=lambda _path: 65_000,
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

            self.assertEqual(calls, [(0, 30_000), (30_000, 30_000), (60_000, 5_000)])
            self.assertEqual(
                [(part["start_ms"], part["end_ms"]) for part in plan],
                [(0, 30_000), (30_000, 60_000), (60_000, 65_000)],
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


if __name__ == "__main__":
    unittest.main()
