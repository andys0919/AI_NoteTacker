from pathlib import Path
from tempfile import mkstemp
import os
import subprocess


class FFmpegMediaPreparer:
    def __init__(self, ffmpeg_binary: str = "ffmpeg", command_runner=None, timeout_seconds: float = 1800) -> None:
        self._ffmpeg_binary = ffmpeg_binary
        self._command_runner = command_runner or subprocess.run
        # Safety cap so a corrupt input can never hang the worker forever on ffmpeg.
        self._timeout_seconds = timeout_seconds

    def prepare(self, local_media_path: str, content_type: str) -> dict:
        suffix = Path(local_media_path).suffix.lower()
        normalized_content_type = (content_type or "").lower()

        if suffix == ".wav" or normalized_content_type in {"audio/wav", "audio/x-wav", "audio/wave"}:
            return {"local_audio_path": local_media_path, "prepared": False}

        file_descriptor, output_path = mkstemp(suffix=".wav", prefix="transcription-prepared-")
        os.close(file_descriptor)

        command = [
            self._ffmpeg_binary,
            "-y",
            "-i",
            local_media_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            output_path,
        ]
        try:
            self._command_runner(command, check=True, timeout=self._timeout_seconds)
        except Exception:
            # ffmpeg failed or timed out — remove the empty/partial temp WAV we created
            # so a failed preparation can't leak a file into /tmp.
            try:
                os.remove(output_path)
            except OSError:
                pass
            raise

        return {"local_audio_path": output_path, "prepared": True}
