import io
import unittest
from urllib.error import HTTPError

from transcription_worker.artifact_downloader import (
    RecordingArtifactDownloader,
    S3ArtifactStorage,
)


class _FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class _FakeObjectStorage:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.artifacts = []

    def fetch_bytes(self, artifact: dict) -> bytes:
        self.artifacts.append(artifact)
        return self.payload


class _FakeS3Client:
    def __init__(self) -> None:
        self.calls = []

    def get_object(self, *, Bucket: str, Key: str) -> dict:
        self.calls.append({"Bucket": Bucket, "Key": Key})
        return {"Body": io.BytesIO(b"downloaded-from-s3")}


class RecordingArtifactDownloaderTests(unittest.TestCase):
    def test_downloads_from_download_url_when_http_access_succeeds(self) -> None:
        downloader = RecordingArtifactDownloader(
            urlopen=lambda _url: _FakeResponse(b"webm-bytes"),
        )

        downloaded_path = downloader.download(
            {
                "storageKey": "recordings/job_direct/meeting.webm",
                "downloadUrl": "http://storage.example.test/recordings/job_direct/meeting.webm",
                "contentType": "video/webm",
            }
        )

        self.assertTrue(downloaded_path.endswith(".webm"))

    def test_falls_back_to_object_storage_when_download_url_returns_403(self) -> None:
        object_storage = _FakeObjectStorage(b"downloaded-from-storage")

        downloader = RecordingArtifactDownloader(
            urlopen=lambda _url: (_ for _ in ()).throw(
                HTTPError(
                    url="http://minio:9000/meeting-artifacts/recordings/job_403/meeting.webm",
                    code=403,
                    msg="Forbidden",
                    hdrs=None,
                    fp=io.BytesIO(b"AccessDenied"),
                )
            ),
            object_storage=object_storage,
        )

        downloaded_path = downloader.download(
            {
                "storageKey": "meeting-artifacts/recordings/job_403/meeting.webm",
                "downloadUrl": "http://minio:9000/meeting-artifacts/recordings/job_403/meeting.webm",
                "contentType": "video/webm",
            }
        )

        self.assertTrue(downloaded_path.endswith(".webm"))
        self.assertEqual(
            object_storage.artifacts,
            [
                {
                    "storageKey": "meeting-artifacts/recordings/job_403/meeting.webm",
                    "downloadUrl": "http://minio:9000/meeting-artifacts/recordings/job_403/meeting.webm",
                    "contentType": "video/webm",
                }
            ],
        )


class S3ArtifactStorageTests(unittest.TestCase):
    def test_strips_bucket_prefix_from_storage_key_before_fetching(self) -> None:
        client = _FakeS3Client()
        storage = S3ArtifactStorage(bucket_name="meeting-artifacts", client=client)

        payload = storage.fetch_bytes(
            {
                "storageKey": "meeting-artifacts/meeting-bot/meeting-bot-user/job_403.webm",
                "downloadUrl": "http://minio:9000/meeting-artifacts/meeting-bot/meeting-bot-user/job_403.webm",
                "contentType": "video/webm",
            }
        )

        self.assertEqual(payload, b"downloaded-from-s3")
        self.assertEqual(
            client.calls,
            [
                {
                    "Bucket": "meeting-artifacts",
                    "Key": "meeting-bot/meeting-bot-user/job_403.webm",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
