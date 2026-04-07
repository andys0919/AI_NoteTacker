from pathlib import Path
from tempfile import mkstemp
import os
import subprocess


class FFmpegMediaPreparer:
    def __init__(self, ffmpeg_binary: str = "ffmpeg", command_runner=None) -> None:
        self._ffmpeg_binary = ffmpeg_binary
        self._command_runner = command_runner or subprocess.run

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
        self._command_runner(command, check=True)

        return {"local_audio_path": output_path, "prepared": True}
