import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from transcription_worker.control_plane_client import ControlPlaneClient


class _TestHandler(BaseHTTPRequestHandler):
    claimed = False
    events = []
    heartbeats = []

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

        if self.path == "/recording-jobs/job_http/leases/heartbeat":
            self.__class__.heartbeats.append(payload)
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


if __name__ == "__main__":
    unittest.main()
