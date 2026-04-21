from __future__ import annotations

from http.server import BaseHTTPRequestHandler, HTTPServer
import math
import struct
import wave
from io import BytesIO


def build_wav_bytes() -> bytes:
    sample_rate = 16_000
    duration_seconds = 1.0
    frequency_hz = 440.0
    amplitude = 16_000
    frame_count = int(sample_rate * duration_seconds)

    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)

        frames = bytearray()
        for index in range(frame_count):
            value = int(amplitude * math.sin((2 * math.pi * frequency_hz * index) / sample_rate))
            frames.extend(struct.pack("<h", value))
        wav_file.writeframes(bytes(frames))

    return buffer.getvalue()


WAV_BYTES = build_wav_bytes()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(WAV_BYTES)))
        self.end_headers()
        self.wfile.write(WAV_BYTES)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
