import json
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

from transcription_worker.control_plane_client import ControlPlaneClient


class _StubResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return b"{}"


class _TestHandler(BaseHTTPRequestHandler):
    claimed = False
    events = []
    heartbeats = []
    fallback_reservations = []
    provider_requests = []
    summary_claims = []

    def do_POST(self):
        content_length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(content_length) or b"{}")

        if self.path == "/transcription-workers/claims":
            if self.__class__.claimed:
                self.send_response(204)
                self.end_headers()
                return

            self.__class__.claimed = True
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "id": "job_http",
                        "recordingArtifact": {
                            "storageKey": "recordings/job_http/meeting.webm",
                            "downloadUrl": "https://storage.example.test/recordings/job_http/meeting.webm",
                            "contentType": "video/webm",
                        },
                    }
                ).encode("utf-8")
            )
            return

        if self.path == "/recording-jobs/job_http/events":
            self.__class__.events.append(payload)
            self.send_response(202)
            self.end_headers()
            return

        if self.path == "/summary-workers/claims":
            self.__class__.summary_claims.append(payload)
            self.send_response(204)
            self.end_headers()
            return

        if self.path == "/recording-jobs/job_http/leases/heartbeat":
            self.__class__.heartbeats.append(payload)
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            return

        if self.path == "/recording-jobs/job_http/summary-fallback/reservations":
            self.__class__.fallback_reservations.append(payload)
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"reserved": True}).encode("utf-8"))
            return

        if self.path.startswith("/recording-jobs/job_http/provider-requests/"):
            self.__class__.provider_requests.append((self.path, payload))
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        return


class ControlPlaneClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), _TestHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.thread.join()

    def setUp(self) -> None:
        _TestHandler.claimed = False
        _TestHandler.events = []
        _TestHandler.heartbeats = []
        _TestHandler.fallback_reservations = []
        _TestHandler.provider_requests = []
        _TestHandler.summary_claims = []

    def test_claims_job_and_posts_event(self) -> None:
        client = ControlPlaneClient(self.base_url)

        claimed_job = client.claim_next_job("transcriber-alpha")
        self.assertIsNotNone(claimed_job)

        client.post_job_event(
            "job_http",
            {
                "type": "transcript-artifact-stored",
                "transcriptArtifact": {
                    "storageKey": "transcripts/job_http/transcript.json",
                    "downloadUrl": "https://storage.example.test/transcripts/job_http/transcript.json",
                    "contentType": "application/json",
                    "language": "en",
                    "segments": [{"startMs": 0, "endMs": 900, "text": "hello"}],
                },
            },
        )

        self.assertEqual(len(_TestHandler.events), 1)
        self.assertEqual(_TestHandler.events[0]["type"], "transcript-artifact-stored")

    def test_posts_lease_heartbeat(self) -> None:
        client = ControlPlaneClient(self.base_url)

        client.post_lease_heartbeat("job_http", "transcription", "lease_http")

        self.assertEqual(len(_TestHandler.heartbeats), 1)
        self.assertEqual(
            _TestHandler.heartbeats[0],
            {
                "stage": "transcription",
                "leaseToken": "lease_http",
            },
        )

    def test_reports_codex_usage_with_the_summary_claim(self) -> None:
        client = ControlPlaneClient(self.base_url)
        usage = {
            "status": "available",
            "usedPercent": 12,
            "windowDurationMins": 10_080,
            "resetsAt": 1_786_680_000,
            "checkedAt": "2026-08-07T04:00:00+00:00",
        }

        self.assertIsNone(client.claim_next_summary_job("summary-alpha", usage))
        self.assertEqual(
            _TestHandler.summary_claims,
            [{"workerId": "summary-alpha", "codexUsage": usage}],
        )

    def test_reserves_one_summary_fallback_under_the_summary_lease(self) -> None:
        client = ControlPlaneClient(self.base_url)

        reserved = client.reserve_summary_fallback(
            "job_http", "lease_summary_http"
        )

        self.assertTrue(reserved)
        self.assertEqual(
            _TestHandler.fallback_reservations,
            [{"leaseToken": "lease_summary_http"}],
        )

    def test_posts_provider_request_start_and_finish_payloads(self) -> None:
        client = ControlPlaneClient(self.base_url)

        client.start_provider_request(
            "job_http",
            "request-http-1",
            stage="summary",
            lease_token="lease-summary",
            provider="local-codex",
            model="gpt-5.6-luna",
            operation="summary",
        )
        client.finish_provider_request(
            "job_http",
            "request-http-1",
            lease_token="lease-summary",
            status="succeeded",
            usage={
                "inputTokens": 100,
                "cachedInputTokens": 20,
                "outputTokens": 30,
                "totalTokens": 130,
            },
        )

        self.assertEqual(
            _TestHandler.provider_requests,
            [
                (
                    "/recording-jobs/job_http/provider-requests/request-http-1/start",
                    {
                        "stage": "summary",
                        "leaseToken": "lease-summary",
                        "provider": "local-codex",
                        "model": "gpt-5.6-luna",
                        "operation": "summary",
                    },
                ),
                (
                    "/recording-jobs/job_http/provider-requests/request-http-1/finish",
                    {
                        "leaseToken": "lease-summary",
                        "status": "succeeded",
                        "usage": {
                            "inputTokens": 100,
                            "cachedInputTokens": 20,
                            "outputTokens": 30,
                            "totalTokens": 130,
                        },
                    },
                ),
            ],
        )

    def test_retries_the_exact_provider_audit_payload_once_after_an_uncertain_response(self) -> None:
        client = ControlPlaneClient(self.base_url)
        with patch.object(
            client,
            "_post_json",
            side_effect=[TimeoutError("response lost"), {"ok": True}],
        ) as post_json:
            client.finish_provider_request(
                "job_http",
                "request-http-retry",
                lease_token="lease-summary",
                status="succeeded",
                usage={
                    "inputTokens": 1,
                    "cachedInputTokens": 0,
                    "outputTokens": 1,
                    "totalTokens": 2,
                },
            )

        self.assertEqual(post_json.call_count, 2)
        self.assertEqual(post_json.call_args_list[0], post_json.call_args_list[1])

    def test_does_not_retry_a_provider_audit_http_rejection(self) -> None:
        client = ControlPlaneClient(self.base_url)
        rejection = urllib.error.HTTPError(
            self.base_url,
            409,
            "Conflict",
            hdrs=None,
            fp=None,
        )
        with patch.object(client, "_post_json", side_effect=rejection) as post_json:
            with self.assertRaises(urllib.error.HTTPError):
                client.start_provider_request(
                    "job_http",
                    "request-http-rejected",
                    stage="summary",
                    lease_token="lease-summary",
                    provider="local-codex",
                    model="gpt-5.6-luna",
                )

        self.assertEqual(post_json.call_count, 1)

    def test_applies_configured_timeout_to_get_post_and_heartbeat(self) -> None:
        captured_requests = []

        def capture_timeout(http_request, timeout=None):
            captured_requests.append(
                (
                    http_request.get_method(),
                    timeout,
                    http_request.get_header("X-internal-service-token"),
                )
            )
            return _StubResponse()

        client = ControlPlaneClient(
            self.base_url,
            internal_service_token="internal-secret",
            timeout_seconds=17,
        )

        with patch(
            "transcription_worker.control_plane_client.request.urlopen",
            side_effect=capture_timeout,
        ):
            client.get_job("job_http")
            client.claim_next_job("transcriber-alpha")
            client.post_lease_heartbeat("job_http", "transcription", "lease_http")

        self.assertEqual(
            captured_requests,
            [
                ("GET", 17, "internal-secret"),
                ("POST", 17, "internal-secret"),
                ("POST", 17, "internal-secret"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
