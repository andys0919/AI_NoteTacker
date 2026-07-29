import json
from pathlib import Path
import tempfile
import unittest

from transcription_worker.qwen_openai_transcriber import QwenOpenAiTranscriber
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
        return text.replace("简体中文", "簡體中文").replace("发电机", "發電機")


class QwenOpenAiTranscriberTests(unittest.TestCase):
    def test_cleans_protocol_markers_and_uses_sixty_second_chunks(self) -> None:
        requests = []

        def urlopen(http_request, timeout):
            requests.append((http_request, timeout))
            return _Response(
                {
                    "text": (
                        "language Chinese<asr_text>简体中文。"
                        "language Chinese<asr_text>发电机。"
                    )
                }
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "meeting.wav"
            source.write_bytes(b"audio")
            transcriber = QwenOpenAiTranscriber(
                endpoint="http://qwen3-asr:8000",
                model="qwen3-asr-1.7b",
                urlopen=urlopen,
                upload_plan_builder=lambda path: [
                    {
                        "path": path,
                        "start_ms": 0,
                        "end_ms": 60_000,
                        "cleanup": False,
                    }
                ],
                normalizer=TranscriptNormalizer(converter=_TraditionalConverter()),
            )

            result = transcriber.transcribe(str(source))

            self.assertEqual(result["language"], "zh")
            self.assertEqual(
                "".join(segment["raw_text"] for segment in result["segments"]),
                "简体中文。发电机。",
            )
            self.assertEqual(
                "".join(segment["display_text"] for segment in result["segments"]),
                "簡體中文。發電機。",
            )
            self.assertNotIn("<asr_text>", str(result))
            self.assertEqual(requests[0][0].full_url, "http://qwen3-asr:8000/v1/audio/transcriptions")
            self.assertNotIn("Api-key", requests[0][0].headers)
            self.assertNotIn(b'name="prompt"', requests[0][0].data)
            self.assertEqual(
                transcriber._build_request_prompt(
                    {
                        "glossary": ["answer-derived term"],
                        "previous_transcript": "previous model output",
                    }
                ),
                "",
            )

            chunk_calls = []
            transcriber.duration_resolver = lambda _path: 125_000
            transcriber._new_temp_audio_path = lambda suffix: str(
                Path(temp_dir) / f"chunk-{len(chunk_calls)}{suffix}"
            )
            transcriber._transcode_for_upload = (
                lambda _source, _target, *, start_ms=0, duration_ms=None: chunk_calls.append(
                    (start_ms, duration_ms)
                )
            )

            plan = transcriber._build_upload_plan(str(source))
            self.assertEqual(chunk_calls, [(0, 60_000), (60_000, 60_000), (120_000, 5_000)])
            self.assertEqual(
                [(part["start_ms"], part["end_ms"]) for part in plan],
                [(0, 60_000), (60_000, 120_000), (120_000, 125_000)],
            )


if __name__ == "__main__":
    unittest.main()
