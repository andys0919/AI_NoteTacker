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
    def test_applies_configured_socket_operation_timeout(self) -> None:
        captured = {}

        def fake_urlopen(_http_request, timeout=None):
            captured["timeout"] = timeout
            return _FakeResponse(
                json.dumps({"language": "zh", "text": "逐字稿"}).encode("utf-8")
            )

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            timeout_seconds=120,
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {"path": path, "start_ms": 0, "end_ms": 1000, "cleanup": False}
            ],
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        try:
            transcriber.transcribe(source_path)
        finally:
            os.remove(source_path)

        self.assertEqual(captured["timeout"], 120)

    def test_posts_multipart_audio_and_maps_verbose_json_segments(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
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
            [
                {key: segment[key] for key in ("start_ms", "end_ms", "text")}
                for segment in result["segments"]
            ],
            [{"start_ms": 0, "end_ms": 1250, "text": "這是測試"}],
        )

    def test_sends_language_and_prompt_fields_when_configured(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
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

    def test_adds_sales_workflow_context_without_translating_spoken_languages(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["body"] = http_request.data
            return _FakeResponse(json.dumps({"language": "zh", "text": "測試"}).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            prompt="base prompt",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1000,
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        try:
            transcriber.transcribe(
                source_path,
                workflow_context={
                    "template_id": "sales",
                    "glossary": ["客製術語"],
                },
            )
        finally:
            os.remove(source_path)

        body = captured["body"].decode("utf-8")
        self.assertIn("保留每段實際使用的語言", body)
        self.assertIn("不要翻譯", body)
        self.assertIn("黑煙淨化器", body)
        self.assertIn("發電機", body)
        self.assertIn("客製術語", body)

    def test_sends_only_canonical_terms_from_verified_alias_lines(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["body"] = http_request.data.decode("utf-8")
            return _FakeResponse(
                json.dumps({"language": "zh", "text": "舌片貼條碼"}).encode("utf-8")
            )

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1000,
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        try:
            transcriber.transcribe(
                source_path,
                workflow_context={
                    "template_id": "general",
                    "glossary": [
                        "舌片 = 蛇片 | 社片",
                        "條碼 = 調碼",
                        "move in = Movie in",
                    ],
                },
            )
        finally:
            os.remove(source_path)

        self.assertIn("舌片、條碼、move in", captured["body"])
        self.assertNotIn("蛇片", captured["body"])
        self.assertNotIn("調碼", captured["body"])
        self.assertNotIn("Movie in", captured["body"])

    def test_does_not_inject_sales_glossary_into_general_workflow(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
            captured["body"] = http_request.data
            return _FakeResponse(json.dumps({"language": "en", "text": "hello"}).encode("utf-8"))

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            prompt="base prompt",
            urlopen=fake_urlopen,
            duration_resolver=lambda _path: 1000,
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        try:
            transcriber.transcribe(source_path, workflow_context={"template_id": "general"})
        finally:
            os.remove(source_path)

        body = captured["body"].decode("utf-8")
        self.assertIn("不要翻譯", body)
        self.assertNotIn("黑煙淨化器", body)

    def test_omits_language_but_keeps_multilingual_policy_when_not_configured(self) -> None:
        captured = {}

        def fake_urlopen(http_request, timeout=None):
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
        self.assertIn(b'name="prompt"', body)
        self.assertIn("不要翻譯".encode("utf-8"), body)

    def test_splits_text_blob_into_sentence_segments_with_interpolated_timestamps(self) -> None:
        def fake_urlopen(_http_request, timeout=None):
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
            [
                {key: segment[key] for key in ("start_ms", "end_ms", "text")}
                for segment in result["segments"]
            ],
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

        def fake_urlopen(_http_request, timeout=None):
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
            [
                {key: segment[key] for key in ("start_ms", "end_ms", "text")}
                for segment in result["segments"]
            ],
            [
                {"start_ms": 0, "end_ms": 1000, "text": "第一段"},
                {"start_ms": 1000, "end_ms": 2500, "text": "第二段"},
            ],
        )
        self.assertEqual(progress_updates[0]["processed_ms"], 1000)
        self.assertEqual(progress_updates[0]["percent"], 40)
        self.assertEqual(progress_updates[-1]["processed_ms"], 2500)
        self.assertEqual(progress_updates[-1]["percent"], 100)

    def test_passes_only_the_bounded_previous_transcript_tail_to_the_next_chunk(self) -> None:
        first_text = "prefix-that-must-not-propagate-" + ("中" * 900) + "-tail"
        responses = iter(
            [
                {"language": "zh", "text": first_text},
                {"language": "zh", "text": "第二段"},
            ]
        )
        request_bodies = []

        def fake_urlopen(http_request, timeout=None):
            request_bodies.append(http_request.data.decode("utf-8"))
            return _FakeResponse(json.dumps(next(responses)).encode("utf-8"))

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {"path": path, "start_ms": 0, "end_ms": 1_000, "cleanup": False},
                {"path": path, "start_ms": 1_000, "end_ms": 2_000, "cleanup": False},
            ],
        )

        try:
            transcriber.transcribe(source_path)
        finally:
            os.remove(source_path)

        self.assertNotIn("前一音訊片段", request_bodies[0])
        self.assertIn("前一音訊片段", request_bodies[1])
        self.assertIn(first_text[-800:], request_bodies[1])
        self.assertNotIn("prefix-that-must-not-propagate", request_bodies[1])

    def test_reports_successful_audio_usage_before_a_later_chunk_fails(self) -> None:
        call_count = 0
        reported_usage = []

        def fake_urlopen(_http_request, timeout=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return _FakeResponse(
                    json.dumps({"language": "zh", "text": "第一段"}).encode("utf-8")
                )
            raise RuntimeError("second upload failed")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        transcriber = AzureOpenAiTranscriber(
            endpoint="https://azure.example.test",
            deployment="gpt-4o-transcribe",
            api_key="secret",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda path: [
                {"path": path, "start_ms": 0, "end_ms": 1_000, "cleanup": False},
                {"path": path, "start_ms": 1_000, "end_ms": 2_500, "cleanup": False},
            ],
        )

        try:
            with self.assertRaisesRegex(RuntimeError, "second upload failed"):
                transcriber.transcribe(
                    source_path,
                    on_transcription_usage=reported_usage.append,
                )
        finally:
            os.remove(source_path)

        self.assertEqual(reported_usage, [{"audio_ms": 1_000}])

    def test_retries_sparse_audible_five_minute_chunk_up_to_twice(self) -> None:
        fallback_text = "這是重試後恢復的完整逐字稿內容，足以證明五分鐘音訊不是空白。" * 5
        responses = iter(
            [
                {"language": "zh", "text": "這一句"},
                {"language": "zh", "text": "仍然太短"},
                {"language": "zh", "text": fallback_text},
            ]
        )
        requested_files = []
        created_paths = []
        transcode_calls = []
        removed_paths = []

        def fake_urlopen(http_request, timeout=None):
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
                {"path": source_path, "start_ms": 0, "end_ms": 300_000, "cleanup": False}
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

        self.assertEqual(len(requested_files), 3)
        self.assertEqual(
            transcode_calls,
            [
                (source_path, 0, 300_000),
                (source_path, 0, 300_000),
            ],
        )
        self.assertTrue(all(path in removed_paths for path in created_paths))
        self.assertEqual("".join(segment["text"] for segment in result["segments"]), fallback_text)
        self.assertEqual(result["segments"][0]["start_ms"], 0)
        self.assertEqual(result["segments"][-1]["end_ms"], 300_000)

    def test_recovers_repetitive_http_200_text_in_thirty_second_chunks(self) -> None:
        repeated_text = "蛇片上面的條碼要怎麼弄？" * 80
        retry_texts = [
            "人員按下雙按鈕後，設備把機箱移動到定位。",
            "相機拍攝機殼位置，畫面同步更新目前狀態。",
            "系統讀取條碼資訊，再向製造系統查詢資料。",
            "機械手臂依照設定移動，並確認安全感測器。",
            "操作員檢查物料數量，異常時設備停止運轉。",
            "工程師確認通訊內容，接著執行初始化流程。",
            "介面顯示各產線連線狀態與目前處理步驟。",
            "掃描器模式可以切換，設定完成後保存資料。",
            "會議討論數字檢查規則，避免遺漏中間編號。",
            "最後整理待確認事項，依現有資料繼續開發。",
        ]
        responses = iter(
            [
                {"language": "zh", "text": "前段內容 context-marker"},
                {"language": "zh", "text": repeated_text},
                *(
                    {"language": "zh", "text": retry_text}
                    for retry_text in retry_texts
                ),
            ]
        )
        request_bodies = []
        created_paths = []
        transcode_calls = []
        removed_paths = []

        def fake_urlopen(http_request, timeout=None):
            request_bodies.append(http_request.data)
            return _FakeResponse(json.dumps(next(responses)).encode("utf-8"))

        def fake_new_temp_audio_path(suffix):
            handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
            handle.write(b"retry")
            handle.close()
            created_paths.append(handle.name)
            return handle.name

        def fake_transcode(source_path, output_path, start_ms=None, duration_ms=None):
            transcode_calls.append((source_path, start_ms, duration_ms))
            with open(output_path, "wb") as handle:
                handle.write(b"retry")

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
            prompt="忠實轉錄",
            urlopen=fake_urlopen,
            upload_plan_builder=lambda _path: [
                {
                    "path": source_path,
                    "start_ms": 0,
                    "end_ms": 1_000,
                    "cleanup": False,
                },
                {
                    "path": source_path,
                    "start_ms": 1_000,
                    "end_ms": 301_000,
                    "cleanup": False,
                },
            ],
            remove_file=fake_remove,
        )
        transcriber._new_temp_audio_path = fake_new_temp_audio_path
        transcriber._transcode_for_upload = fake_transcode

        result = transcriber.transcribe(
            source_path,
            workflow_context={"glossary": ["MoveIn"]},
        )

        if os.path.exists(source_path):
            os.remove(source_path)

        self.assertEqual(len(request_bodies), 12)
        self.assertIn(b"context-marker", request_bodies[1])
        self.assertTrue(
            all(b"context-marker" not in body for body in request_bodies[2:])
        )
        self.assertTrue(all(b"MoveIn" in body for body in request_bodies))
        self.assertEqual(
            transcode_calls,
            [
                (source_path, offset_ms, 30_000)
                for offset_ms in range(0, 300_000, 30_000)
            ],
        )
        self.assertTrue(all(path in removed_paths for path in created_paths))
        self.assertNotIn(
            "蛇片上面的條碼要怎麼弄",
            "".join(segment["text"] for segment in result["segments"]),
        )
        self.assertEqual(result["segments"][-1]["end_ms"], 301_000)
        self.assertEqual(result["usage"]["audio_ms"], 601_000)

    def test_rejects_audible_five_minute_chunk_when_retry_stays_sparse(self) -> None:
        responses = iter(
            [
                {"language": "zh", "text": "一句"},
                {"language": "zh", "text": "好"},
                {"language": "zh", "text": "仍然太短"},
            ]
        )
        request_count = 0
        created_paths = []

        def fake_urlopen(_http_request, timeout=None):
            nonlocal request_count
            request_count += 1
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
                {"path": source_path, "start_ms": 0, "end_ms": 300_000, "cleanup": False}
            ],
        )
        transcriber.audio_activity_detector = lambda _path: True
        transcriber.sparse_retry_chunk_duration_ms = 300_000
        transcriber._new_temp_audio_path = fake_new_temp_audio_path
        transcriber._transcode_for_upload = fake_transcode

        with self.assertRaisesRegex(RuntimeError, "after 2 bounded retries"):
            transcriber.transcribe(source_path)

        self.assertEqual(request_count, 3)
        if os.path.exists(source_path):
            os.remove(source_path)
        for path in created_paths:
            if os.path.exists(path):
                os.remove(path)

    def test_surfaces_http_error_body_in_the_failure_message(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as source:
            source.write(b"source")
            source_path = source.name

        def fake_urlopen(_http_request, timeout=None):
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

        self.assertEqual(len(plan), 8)
        self.assertEqual(plan[0]["start_ms"], 0)
        self.assertEqual(plan[0]["end_ms"], 300_000)
        self.assertEqual(plan[-1]["start_ms"], 2_100_000)
        self.assertEqual(plan[-1]["end_ms"], 2_304_756)
        self.assertEqual(transcode_calls[0], (0, 300_000))
        self.assertEqual(transcode_calls[-1], (2_100_000, 204_756))


if __name__ == "__main__":
    unittest.main()
