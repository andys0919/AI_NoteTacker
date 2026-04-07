from typing import Callable


class FasterWhisperTranscriber:
    def __init__(
        self,
        model_name: str,
        device: str,
        compute_type: str,
        model_factory: Callable | None = None,
    ) -> None:
        if model_factory is None:
            from faster_whisper import WhisperModel  # type: ignore

            model_factory = WhisperModel

        self._model = model_factory(model_name, device=device, compute_type=compute_type)

    def transcribe(self, local_audio_path: str, on_progress: Callable | None = None) -> dict:
        segments, info = self._model.transcribe(local_audio_path, beam_size=5)
        total_ms = int((getattr(info, "duration", 0) or 0) * 1000)
        materialized_segments = []

        for segment in segments:
            mapped_segment = {
                "start_ms": int(segment.start * 1000),
                "end_ms": int(segment.end * 1000),
                "text": segment.text,
            }
            materialized_segments.append(mapped_segment)

            if on_progress is not None:
                effective_total_ms = total_ms or mapped_segment["end_ms"]
                percent = (
                    100
                    if effective_total_ms <= 0
                    else min(100, max(1, int((mapped_segment["end_ms"] / effective_total_ms) * 100)))
                )
                on_progress(
                    {
                        "processed_ms": mapped_segment["end_ms"],
                        "total_ms": effective_total_ms,
                        "percent": percent,
                    }
                )

        return {
            "language": info.language,
            "segments": materialized_segments,
        }
