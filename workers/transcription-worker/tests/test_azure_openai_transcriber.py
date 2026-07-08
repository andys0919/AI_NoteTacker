import io
import json
import os
import tempfile
import unittest
import urllib.error

from transcription_worker.azure_openai_transcriber import AzureOpenAiTranscriber


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class AzureOpenAiTranscriberTests(unittest.TestCase):
    def test_posts_multipart_audio_and_maps_verbose_json_segments(self) -> None:
        captured = {}

        def fake_urlopen(http_request):
            captured["url"] = http_request.full_url
            captured["headers"] = dict(http_request.header_items())
            captured["body"] = http_request.data
            payload = {
                "language": "zh",
                "text": "這是測試"
            }
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            api_version="2025-03-01-preview",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1250,
        )

        with open("/tmp/azure-openai-transcriber-test.wav", "wb") as handle:
          handle.write(b"fake-audio")

        result = transcriber.transcribe("/tmp/azure-openai-transcriber-test.wav")

        self.assertEqual(
            captured["url"],
            "https://azure.example.test/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview",
        )
        self.assertEqual(captured["headers"]["Api-key"], "secret")
        self.assertIn(b'name="model"', captured["body"])
        self.assertIn(b"gpt-4o-transcribe", captured["body"])
        self.assertIn(b'name="response_format"', captured["body"])
        self.assertIn(b"json", captured["body"])
        self.assertEqual(result["language"], "zh")
        self.assertEqual(
            result["segments"],
            [{"start_ms": 0, "end_ms": 1250, "text": "這是測試"}],
        )

    def test_sends_language_and_prompt_fields_when_configured(self) -> None:
        captured = {}

        def fake_urlopen(http_request):
            captured["body"] = http_request.data
            return _FakeResponse(json.dumps({"language": "zh", "text": "你好"}).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            api_version="2025-03-01-preview",
            language="zh",
            prompt="請輸出繁體中文並保留標點。",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1000,
        )

        with open("/tmp/azure-openai-transcriber-lang-test.wav", "wb") as handle:
            handle.write(b"fake-audio")

        transcriber.transcribe("/tmp/azure-openai-transcriber-lang-test.wav")

        body = captured["body"]
        self.assertIn(b'name="language"', body)
        self.assertIn("zh".encode("utf-8"), body)
        self.assertIn(b'name="prompt"', body)
        self.assertIn("請輸出繁體中文並保留標點。".encode("utf-8"), body)

    def test_omits_language_and_prompt_fields_when_not_configured(self) -> None:
        captured = {}

        def fake_urlopen(http_request):
            captured["body"] = http_request.data
            return _FakeResponse(json.dumps({"language": "zh", "text": "你好"}).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1000,
        )

        with open("/tmp/azure-openai-transcriber-nolang-test.wav", "wb") as handle:
            handle.write(b"fake-audio")

        transcriber.transcribe("/tmp/azure-openai-transcriber-nolang-test.wav")

        body = captured["body"]
        self.assertNotIn(b'name="language"', body)
        self.assertNotIn(b'name="prompt"', body)

    def test_splits_text_blob_into_sentence_segments_with_interpolated_timestamps(self) -> None:
        def fake_urlopen(_http_request):
            payload = {"language": "zh", "text": "你好。今天天氣很好！"}
            return _FakeResponse(json.dumps(payload).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {"path": path, "start_ms": 0, "end_ms": 1000, "cleanup": False}
            ],
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        result = transcriber.transcribe(source_path)
        os.remove(source_path)

        self.assertEqual(
            result["segments"],
            [
                {"start_ms": 0, "end_ms": 300, "text": "你好。"},
                {"start_ms": 300, "end_ms": 1000, "text": "今天天氣很好！"},
            ],
        )

    def test_restores_punctuation_before_splitting_into_segments(self) -> None:
        class _StubPunctuator:
            def restore(self, text):
                # Simulate the chat punctuator adding sentence boundaries.
                return "你好。今天天氣很好！"

        def fake_urlopen(_http_request):
            return _FakeResponse(
                json.dumps({"language": "zh", "text": "你好今天天氣很好"}).encode("utf-8")
            )

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            punctuator=_StubPunctuator(),
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {"path": path, "start_ms": 0, "end_ms": 1000, "cleanup": False}
            ],
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        result = transcriber.transcribe(source_path)
        os.remove(source_path)

        self.assertEqual(
            result["segments"],
            [
                {"start_ms": 0, "end_ms": 300, "text": "你好。"},
                {"start_ms": 300, "end_ms": 1000, "text": "今天天氣很好！"},
            ],
        )

    def test_combines_chunked_upload_results_with_offsets_and_progress(self) -> None:
        responses = iter(
            [
                {"language": "zh", "text": "第一段"},
                {"language": "zh", "text": "第二段"},
            ]
        )
        progress_updates = []

        def fake_urlopen(_http_request):
            return _FakeResponse(json.dumps(next(responses)).encode("utf-8"))

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as chunk_one:
            chunk_one.write(b"chunk-one")
            chunk_one_path = chunk_one.name
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as chunk_two:
            chunk_two.write(b"chunk-two")
            chunk_two_path = chunk_two.name

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            api_version="2025-03-01-preview",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda _path: [
                {"path": chunk_one_path, "start_ms": 0, "end_ms": 1000, "cleanup": False},
                {"path": chunk_two_path, "start_ms": 1000, "end_ms": 2500, "cleanup": False},
            ],
        )

        result = transcriber.transcribe(
            source_path,
            on_progress=lambda update: progress_updates.append(update),
        )

        os.remove(source_path)
        os.remove(chunk_one_path)
        os.remove(chunk_two_path)

        self.assertEqual(result["language"], "zh")
        self.assertEqual(
            result["segments"],
            [
                {"start_ms": 0, "end_ms": 1000, "text": "第一段"},
                {"start_ms": 1000, "end_ms": 2500, "text": "第二段"},
            ],
        )
        self.assertEqual(progress_updates[0]["processed_ms"], 1000)
        self.assertEqual(progress_updates[0]["percent"], 40)
        self.assertEqual(progress_updates[-1]["processed_ms"], 2500)
        self.assertEqual(progress_updates[-1]["percent"], 100)

    def test_retries_sparse_long_chunk_as_smaller_uploads(self) -> None:
        fallback_texts = [
            "第一小段有足夠多的逐字稿內容用來代表這五分鐘的語音討論,不是空白也不是一句提示。",
            "第二小段同樣回傳完整逐字稿內容,證明長音訊分片被改切之後可以恢復正常辨識。",
            "第三小段保留會議討論內容,避免前二十分鐘只有一句話卻被系統當成成功轉錄。",
            "第四小段也有足夠文字,讓整個二十分鐘區間不會再被一個過短回應覆蓋掉。",
        ]
        responses = iter(
            [
                {"language": "zh", "text": "這一句"},
                *({"language": "zh", "text": text} for text in fallback_texts),
            ]
        )
        requested_files = []
        created_paths = []
        transcode_calls = []
        removed_paths = []

        def fake_urlopen(http_request):
            marker = b'filename="'
            start = http_request.data.index(marker) + len(marker)
            end = http_request.data.index(b'"', start)
            requested_files.append(os.path.basename(http_request.data[start:end].decode("utf-8")))
            return _FakeResponse(json.dumps(next(responses)).encode("utf-8"))

        def fake_new_temp_audio_path(suffix):
            handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            handle.write(b"fallback")
            handle.close()
            created_paths.append(handle.name)
            return handle.name

        def fake_transcode(source_path, output_path, start_ms=None, duration_ms=None):
            transcode_calls.append((source_path, start_ms, duration_ms))
            with open(output_path, "wb") as handle:
                handle.write(b"fallback")

        def fake_remove(path):
            removed_paths.append(path)
            if os.path.exists(path):
                os.remove(path)

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda _path: [
                {"path": source_path, "start_ms": 0, "end_ms": 1_200_000, "cleanup": False}
            ],
            remove_file=fake_remove,
        )
        transcriber.audio_activity_detector = lambda _path: True
        transcriber.sparse_retry_chunk_duration_ms = 300_000
        transcriber._new_temp_audio_path = fake_new_temp_audio_path
        transcriber._transcode_for_upload = fake_transcode

        result = transcriber.transcribe(source_path)

        if os.path.exists(source_path):
            os.remove(source_path)

        self.assertEqual(len(requested_files), 5)
        self.assertEqual(
            transcode_calls,
            [
                (source_path, 0, 300_000),
                (source_path, 300_000, 300_000),
                (source_path, 600_000, 300_000),
                (source_path, 900_000, 300_000),
            ],
        )
        self.assertTrue(all(path in removed_paths for path in created_paths))
        self.assertEqual(
            [segment["text"] for segment in result["segments"]],
            fallback_texts,
        )
        self.assertEqual(result["segments"][0]["start_ms"], 0)
        self.assertEqual(result["segments"][-1]["end_ms"], 1_200_000)

    def test_rejects_audible_long_chunk_when_retry_stays_sparse(self) -> None:
        responses = iter(
            [
                {"language": "zh", "text": "一句"},
                {"language": "zh", "text": ""},
                {"language": "zh", "text": "嗯"},
                {"language": "zh", "text": ""},
                {"language": "zh", "text": "好"},
            ]
        )
        created_paths = []

        def fake_urlopen(_http_request):
            return _FakeResponse(json.dumps(next(responses)).encode("utf-8"))

        def fake_new_temp_audio_path(suffix):
            handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            handle.write(b"fallback")
            handle.close()
            created_paths.append(handle.name)
            return handle.name

        def fake_transcode(_source_path, output_path, start_ms=None, duration_ms=None):
            with open(output_path, "wb") as handle:
                handle.write(b"fallback")

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda _path: [
                {"path": source_path, "start_ms": 0, "end_ms": 1_200_000, "cleanup": False}
            ],
        )
        transcriber.audio_activity_detector = lambda _path: True
        transcriber.sparse_retry_chunk_duration_ms = 300_000
        transcriber._new_temp_audio_path = fake_new_temp_audio_path
        transcriber._transcode_for_upload = fake_transcode

        with self.assertRaisesRegex(RuntimeError, "suspiciously sparse"):
            transcriber.transcribe(source_path)

        if os.path.exists(source_path):
            os.remove(source_path)
        for path in created_paths:
            if os.path.exists(path):
                os.remove(path)

    def test_surfaces_http_error_body_in_the_failure_message(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        def fake_urlopen(_http_request):
            raise urllib.error.HTTPError(
                url="https://azure.example.test",
                code=400,
                msg="Bad Request",
                hdrs=None,
                fp=io.BytesIO(
                    json.dumps(
                        {
                            "error": {
                                "message": "Audio file exceeds the maximum supported size."
                            }
                        }
                    ).encode("utf-8")
                ),
            )

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            api_version="2025-03-01-preview",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {
                    "path": path,
                    "start_ms": 0,
                    "end_ms": 1000,
                    "cleanup": False,
                }
            ],
        )

        with self.assertRaisesRegex(
            RuntimeError,
            "Audio file exceeds the maximum supported size",
        ):
            transcriber.transcribe(source_path)

        os.remove(source_path)

    def test_splits_upload_plan_when_audio_duration_exceeds_model_limit(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        created_paths = []
        transcode_calls = []

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            api_version="2025-03-01-preview",
            duration_resolver=lambda _path: 2_304_756,
        )

        def fake_new_temp_audio_path(suffix):
            handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            handle.write(b"chunk")
            handle.close()
            created_paths.append(handle.name)
            return handle.name

        def fake_transcode(_source_path, output_path, start_ms=None, duration_ms=None):
            transcode_calls.append((start_ms, duration_ms))
            with open(output_path, "wb") as handle:
                handle.write(b"chunk")

        transcriber._new_temp_audio_path = fake_new_temp_audio_path
        transcriber._transcode_for_upload = fake_transcode

        plan = transcriber._build_upload_plan(source_path)

        os.remove(source_path)
        for path in created_paths:
            if os.path.exists(path):
                os.remove(path)

        self.assertEqual(len(plan), 2)
        self.assertEqual(plan[0]["start_ms"], 0)
        self.assertEqual(plan[0]["end_ms"], 1_200_000)
        self.assertEqual(plan[1]["start_ms"], 1_200_000)
        self.assertEqual(plan[1]["end_ms"], 2_304_756)
        self.assertEqual(transcode_calls[0], (None, None))
        self.assertEqual(transcode_calls[1], (0, 1_200_000))
        self.assertEqual(transcode_calls[2], (1_200_000, 1_104_756))


if __name__ == "__main__":
    unittest.main()
