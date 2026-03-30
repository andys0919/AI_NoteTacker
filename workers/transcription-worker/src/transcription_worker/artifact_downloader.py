from pathlib import Path
from tempfile import mkstemp
from urllib import request


class RecordingArtifactDownloader:
    def download(self, artifact: dict) -> str:
        suffix = Path(artifact["storageKey"]).suffix or ".bin"
        file_descriptor, file_path = mkstemp(suffix=suffix, prefix="transcription-worker-")
        Path(file_path).unlink(missing_ok=True)

        with request.urlopen(artifact["downloadUrl"]) as response:  # noqa: S310
            data = response.read()

        Path(file_path).write_bytes(data)
        return file_path
