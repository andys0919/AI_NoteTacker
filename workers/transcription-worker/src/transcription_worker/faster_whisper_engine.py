from collections.abc import Callable


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

    def transcribe(self, local_audio_path: str) -> dict:
        segments, info = self._model.transcribe(local_audio_path, beam_size=5)
        materialized_segments = list(segments)

        return {
            "language": info.language,
            "segments": [
                {
                    "start_ms": int(segment.start * 1000),
                    "end_ms": int(segment.end * 1000),
                    "text": segment.text,
                }
                for segment in materialized_segments
            ],
        }
