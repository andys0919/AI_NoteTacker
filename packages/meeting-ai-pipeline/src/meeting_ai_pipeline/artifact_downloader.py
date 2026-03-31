from pathlib import Path
from tempfile import mkstemp
from urllib import error, request


class S3ArtifactStorage:
    def __init__(
        self,
        bucket_name: str,
        endpoint_url: str | None = None,
        region_name: str | None = None,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        client=None,
    ) -> None:
        self._bucket_name = bucket_name

        if client is None:
            import boto3

            client = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                region_name=region_name,
                aws_access_key_id=access_key_id,
                aws_secret_access_key=secret_access_key,
            )

        self._client = client

    def fetch_bytes(self, artifact: dict) -> bytes:
        storage_key = str(artifact["storageKey"]).lstrip("/")
        bucket_prefix = f"{self._bucket_name}/"

        if storage_key.startswith(bucket_prefix):
            storage_key = storage_key[len(bucket_prefix) :]

        response = self._client.get_object(Bucket=self._bucket_name, Key=storage_key)
        return response["Body"].read()


class RecordingArtifactDownloader:
    def __init__(self, urlopen=request.urlopen, object_storage=None) -> None:
        self._urlopen = urlopen
        self._object_storage = object_storage

    def download(self, artifact: dict) -> str:
        suffix = Path(artifact["storageKey"]).suffix or ".bin"
        file_descriptor, file_path = mkstemp(suffix=suffix, prefix="transcription-worker-")
        Path(file_path).unlink(missing_ok=True)

        try:
            with self._urlopen(artifact["downloadUrl"]) as response:  # noqa: S310
                data = response.read()
        except error.HTTPError as http_error:
            if http_error.code != 403 or self._object_storage is None:
                raise

            data = self._object_storage.fetch_bytes(artifact)

        Path(file_path).write_bytes(data)
        return file_path
