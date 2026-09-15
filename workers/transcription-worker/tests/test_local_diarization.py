import unittest

import numpy as np

from transcription_worker.local_diarization import (
    PyannoteDiarizer,
    assign_speaker_turns,
    split_labels_by_voice,
)


class AssignSpeakerTurnsTests(unittest.TestCase):
    def test_takes_the_most_overlapping_turn_and_falls_back_to_the_nearest(self) -> None:
        turns = [
            {"start_ms": 0, "end_ms": 4_000, "speaker": 1},
            {"start_ms": 3_000, "end_ms": 10_000, "speaker": 0},
            {"start_ms": 20_000, "end_ms": 25_000, "speaker": 2},
        ]
        segments = [
            {"start_ms": 0, "end_ms": 3_500, "text": "a", "speaker_index": 7},
            {"start_ms": 2_500, "end_ms": 9_000, "text": "b"},
            {"start_ms": 12_000, "end_ms": 12_400, "text": "嗯"},
            {"start_ms": 19_000, "end_ms": 19_300, "text": "對"},
        ]
        # No provider label on these, so each keeps its own per-segment vote.

        assigned = assign_speaker_turns(segments, turns)

        self.assertEqual([segment["speaker_index"] for segment in assigned], [1, 0, 0, 2])
        self.assertEqual(assigned[0]["text"], "a")
        self.assertEqual(segments[1], {"start_ms": 2_500, "end_ms": 9_000, "text": "b"})

    def test_a_provider_label_follows_its_own_majority_so_short_replies_keep_their_voice(
        self,
    ) -> None:
        # The provider split one person across two labels (A before the seam, C after)
        # and the whole-file pass sees them as one voice. A half-second reply from the
        # other person sits inside that voice's turn and must NOT be swallowed.
        turns = [
            {"start_ms": 0, "end_ms": 60_000, "speaker": 0},
            {"start_ms": 60_000, "end_ms": 120_000, "speaker": 1},
            {"start_ms": 120_000, "end_ms": 180_000, "speaker": 0},
        ]
        segments = [
            {"start_ms": 0, "end_ms": 30_000, "text": "長篇", "speaker": "Speaker A"},
            {"start_ms": 30_000, "end_ms": 30_500, "text": "好。", "speaker": "Speaker B"},
            {"start_ms": 31_000, "end_ms": 59_000, "text": "繼續", "speaker": "Speaker A"},
            {"start_ms": 61_000, "end_ms": 119_000, "text": "換人", "speaker": "Speaker B"},
            {"start_ms": 121_000, "end_ms": 179_000, "text": "接縫後", "speaker": "Speaker C"},
        ]

        assigned = assign_speaker_turns(segments, turns)

        indexes = [segment["speaker_index"] for segment in assigned]
        # Speaker A and Speaker C merge into one voice; the short reply keeps Speaker B's
        # voice even though it lies inside Speaker A's diarization turn.
        self.assertEqual(indexes[0], indexes[2])
        self.assertEqual(indexes[0], indexes[4])
        self.assertEqual(indexes[1], indexes[3])
        self.assertNotEqual(indexes[0], indexes[1])

    def test_a_provider_label_covering_two_people_stays_merged(self) -> None:
        # Letting a phrase overrule its own label was tried and reverted: it split a
        # wrongly merged label but also swapped a question with its answer elsewhere,
        # and blind readers preferred the majority rule 18:6. Splitting such a label is
        # the operator's per-segment reassignment, not this function's job.
        turns = [
            {"start_ms": 0, "end_ms": 40_000, "speaker": 0},
            {"start_ms": 40_000, "end_ms": 90_000, "speaker": 1},
        ]
        segments = [
            {"start_ms": 0, "end_ms": 30_000, "text": "第一位講很久", "speaker": "Speaker 2"},
            {"start_ms": 50_000, "end_ms": 60_000, "text": "第二位講很久", "speaker": "Speaker 2"},
        ]

        indexes = [
            segment["speaker_index"] for segment in assign_speaker_turns(segments, turns)
        ]

        self.assertEqual(indexes[0], indexes[1])

    def test_segments_without_a_provider_label_use_their_own_overlap(self) -> None:
        turns = [
            {"start_ms": 0, "end_ms": 4_000, "speaker": 1},
            {"start_ms": 4_000, "end_ms": 9_000, "speaker": 0},
        ]
        segments = [
            {"start_ms": 0, "end_ms": 3_000, "text": "a"},
            {"start_ms": 5_000, "end_ms": 8_000, "text": "b"},
        ]

        self.assertEqual(
            [segment["speaker_index"] for segment in assign_speaker_turns(segments, turns)],
            [1, 0],
        )

    def test_keeps_segments_untouched_without_turns(self) -> None:
        segments = [{"start_ms": 0, "end_ms": 1_000, "text": "a", "speaker_index": 3}]
        self.assertEqual(assign_speaker_turns(segments, []), segments)


class SplitLabelsByVoiceTests(unittest.TestCase):
    @staticmethod
    def _voice(seed):
        vector = np.zeros(8, dtype=np.float32)
        vector[seed] = 1.0
        return vector

    def test_splits_a_label_whose_phrases_carry_two_believable_voices(self) -> None:
        a, b = self._voice(0), self._voice(3)
        segments = [
            {"start_ms": 0, "end_ms": 5_000, "text": "1", "speaker": "Speaker 2"},
            {"start_ms": 6_000, "end_ms": 11_000, "text": "2", "speaker": "Speaker 2"},
            {"start_ms": 12_000, "end_ms": 17_000, "text": "3", "speaker": "Speaker 2"},
            {"start_ms": 20_000, "end_ms": 25_000, "text": "4", "speaker": "Speaker 2"},
            {"start_ms": 26_000, "end_ms": 31_000, "text": "5", "speaker": "Speaker 2"},
            {"start_ms": 32_000, "end_ms": 37_000, "text": "6", "speaker": "Speaker 2"},
            # Too short to embed; follows the nearest embedded phrase of its own label.
            {"start_ms": 37_500, "end_ms": 37_800, "text": "嗯。", "speaker": "Speaker 2"},
        ]
        embeddings = {0: a, 1: a, 2: a, 3: b, 4: b, 5: b}

        labels = [
            segment["speaker"] for segment in split_labels_by_voice(segments, embeddings)
        ]

        self.assertEqual(labels[0], labels[1])
        self.assertEqual(labels[0], labels[2])
        self.assertEqual(labels[3], labels[4])
        self.assertNotEqual(labels[0], labels[3])
        self.assertEqual(labels[6], labels[5])

    def test_one_odd_sounding_phrase_never_invents_a_speaker(self) -> None:
        a, b = self._voice(0), self._voice(3)
        segments = [
            {"start_ms": 0, "end_ms": 20_000, "text": "1", "speaker": "Speaker 2"},
            {"start_ms": 21_000, "end_ms": 41_000, "text": "2", "speaker": "Speaker 2"},
            {"start_ms": 42_000, "end_ms": 62_000, "text": "3", "speaker": "Speaker 2"},
            {"start_ms": 63_000, "end_ms": 83_000, "text": "4", "speaker": "Speaker 2"},
            {"start_ms": 84_000, "end_ms": 104_000, "text": "5", "speaker": "Speaker 2"},
        ]

        labels = [
            segment["speaker"]
            for segment in split_labels_by_voice(
                segments, {0: a, 1: a, 2: a, 3: a, 4: b}
            )
        ]

        self.assertEqual(len(set(labels)), 1)

    @staticmethod
    def _recording(first_label_voices):
        """Five-second phrases. ``Speaker 1`` speaks with the given voices, six phrases
        each, and five more one-voice labels give the recording voices to compare against.
        """
        rng = np.random.default_rng(7)
        segments, embeddings = [], {}

        def add(label, axis):
            for _ in range(6):
                vector = np.zeros(32)
                vector[axis] = 1.0
                vector += rng.normal(scale=0.05, size=32)
                index = len(segments)
                segments.append(
                    {
                        "start_ms": index * 6_000,
                        "end_ms": index * 6_000 + 5_000,
                        "text": str(index),
                        "speaker": label,
                    }
                )
                embeddings[index] = (vector / np.linalg.norm(vector)).astype(np.float32)

        for axis in first_label_voices:
            add("Speaker 1", axis)
        for axis in range(2, 7):
            add(f"Speaker {axis}", axis)
        return segments, embeddings

    def test_a_label_holding_two_voices_splits_against_the_rest_of_the_recording(
        self,
    ) -> None:
        segments, embeddings = self._recording([0, 1])

        labels = [s["speaker"] for s in split_labels_by_voice(segments, embeddings)]

        self.assertEqual(len(set(labels[:6])), 1)
        self.assertEqual(len(set(labels[6:12])), 1)
        self.assertNotEqual(labels[0], labels[6])
        self.assertEqual(labels[12:], [s["speaker"] for s in segments[12:]])

    def test_a_label_holding_one_voice_stays_whole_against_the_rest_of_the_recording(
        self,
    ) -> None:
        segments, embeddings = self._recording([0, 0])

        labels = [s["speaker"] for s in split_labels_by_voice(segments, embeddings)]

        self.assertEqual(labels, [s["speaker"] for s in segments])

    def test_labels_stay_untouched_without_embeddings(self) -> None:
        segments = [{"start_ms": 0, "end_ms": 5_000, "text": "1", "speaker": "Speaker 2"}]
        self.assertEqual(split_labels_by_voice(segments, {}), segments)


class ReassignPhrasesByVoiceTests(unittest.TestCase):
    @staticmethod
    def _recording():
        """Three speakers, eight five-second phrases each, each speaker one voice."""
        rng = np.random.default_rng(3)
        segments, embeddings = [], {}
        for speaker in range(3):
            for _ in range(8):
                vector = np.zeros(16)
                vector[speaker] = 1.0
                vector += rng.normal(scale=0.05, size=16)
                index = len(segments)
                segments.append(
                    {
                        "start_ms": index * 6_000,
                        "end_ms": index * 6_000 + 5_000,
                        "text": str(index),
                        "speaker_index": speaker,
                    }
                )
                embeddings[index] = (vector / np.linalg.norm(vector)).astype(np.float32)
        # The diarization heard every phrase as the voice it really is.
        turns = [
            {"start_ms": s["start_ms"], "end_ms": s["end_ms"], "speaker": s["speaker_index"]}
            for s in segments
        ]
        return segments, embeddings, turns

    def test_a_misfiled_line_moves_back_to_the_speaker_it_sounds_like(self) -> None:
        from transcription_worker.local_diarization import reassign_phrases_by_voice

        segments, embeddings, turns = self._recording()
        segments[3] = {**segments[3], "speaker_index": 1}

        result = reassign_phrases_by_voice(segments, embeddings, turns)

        self.assertEqual(result[3]["speaker_index"], 0)
        self.assertEqual(
            [s["speaker_index"] for i, s in enumerate(result) if i != 3],
            [s["speaker_index"] for i, s in enumerate(segments) if i != 3],
        )

    def test_a_line_stays_when_the_diarization_heard_its_own_speaker(self) -> None:
        from transcription_worker.local_diarization import reassign_phrases_by_voice

        segments, embeddings, turns = self._recording()
        segments[3] = {**segments[3], "speaker_index": 1}
        turns[3] = {**turns[3], "speaker": 1}

        result = reassign_phrases_by_voice(segments, embeddings, turns)

        self.assertEqual(result[3]["speaker_index"], 1)

    def test_a_line_without_an_embedding_never_moves(self) -> None:
        from transcription_worker.local_diarization import reassign_phrases_by_voice

        segments, embeddings, turns = self._recording()
        segments[3] = {**segments[3], "speaker_index": 1}
        del embeddings[3]

        result = reassign_phrases_by_voice(segments, embeddings, turns)

        self.assertEqual(result[3]["speaker_index"], 1)

    def test_a_correctly_labelled_recording_is_left_alone(self) -> None:
        from transcription_worker.local_diarization import reassign_phrases_by_voice

        segments, embeddings, turns = self._recording()

        self.assertEqual(reassign_phrases_by_voice(segments, embeddings, turns), segments)


class VoicedGateTests(unittest.TestCase):
    def test_a_phrase_of_padding_around_half_a_second_of_voice_does_not_vote(self) -> None:
        from transcription_worker.local_diarization import (
            SAMPLE_RATE,
            _speech_amplitude,
            _voiced_ms,
        )

        rng = np.random.default_rng(7)
        loud = lambda ms: (0.3 * rng.standard_normal(SAMPLE_RATE * ms // 1000)).astype(np.float32)
        silent = lambda ms: np.zeros(SAMPLE_RATE * ms // 1000, dtype=np.float32)
        recording = np.concatenate([loud(4_000), silent(2_000), loud(4_000)])
        level = _speech_amplitude(recording)

        padded = np.concatenate([loud(500), silent(2_500)])
        spoken = loud(2_000)

        self.assertLess(_voiced_ms(padded, level), 700)
        self.assertGreater(_voiced_ms(spoken, level), 1_500)

    def test_voiced_ms_counts_in_whole_frames_of_the_configured_width(self) -> None:
        from transcription_worker.local_diarization import (
            SAMPLE_RATE,
            VOICE_FRAME_MS,
            _voiced_ms,
        )

        frame = SAMPLE_RATE * VOICE_FRAME_MS // 1000
        loud = (0.3 * np.random.default_rng(1).standard_normal(frame * 5).astype(np.float32))

        # Exactly five frames of voice are counted as five frame-widths of time, which
        # pins both the frame width and the "count frames, not samples" rule.
        self.assertEqual(_voiced_ms(loud, 0.05), 5 * VOICE_FRAME_MS)
        # A span shorter than one frame rounds down to zero, not a partial frame.
        self.assertEqual(_voiced_ms(loud[: frame - 1], 0.05), 0)


class _Turn:
    def __init__(self, start, end):
        self.start, self.end = start, end


class _Annotation:
    def __init__(self, tracks):
        self.tracks = tracks

    def itertracks(self, yield_label=False):
        return [(_Turn(start, end), None, label) for start, end, label in self.tracks]


class _Output:
    def __init__(self, exclusive, plain):
        self.exclusive_speaker_diarization = exclusive
        self.speaker_diarization = plain


class _Pipeline:
    def __init__(self):
        self.calls = []

    def __call__(self, audio):
        self.calls.append((audio["waveform"].shape, audio["sample_rate"]))
        return _Output(
            _Annotation([(1.25, 2.5, "SPEAKER_03"), (2.5, 3.0, "SPEAKER_00")]),
            _Annotation([(0.0, 9.0, "SPEAKER_03")]),
        )


class PyannoteDiarizerTests(unittest.TestCase):
    def test_prefers_exclusive_turns_numbers_speakers_by_appearance_and_reuses_the_pipeline(
        self,
    ) -> None:
        import numpy as np

        built = []

        def factory():
            built.append(_Pipeline())
            return built[-1]

        diarizer = PyannoteDiarizer(
            pipeline_factory=factory,
            audio_loader=lambda path: np.zeros(16_000, dtype=np.float32),
        )

        turns = diarizer.diarize("/tmp/a.wav")
        diarizer.diarize("/tmp/b.wav")

        self.assertEqual(
            turns,
            [
                {"start_ms": 1_250, "end_ms": 2_500, "speaker": 0},
                {"start_ms": 2_500, "end_ms": 3_000, "speaker": 1},
            ],
        )
        self.assertEqual(len(built), 1)
        self.assertEqual(built[0].calls, [((1, 16_000), 16_000)] * 2)
        self.assertEqual(diarizer.label, "speaker-diarization-community-1")


class _OomThenCpuPipeline:
    def __init__(self):
        self.devices = []
        self.calls = 0

    def to(self, device):
        self.devices.append(str(device))
        return self

    def __call__(self, audio):
        import torch

        self.calls += 1
        if self.calls == 1:
            raise torch.OutOfMemoryError("CUDA out of memory")
        return _Output(_Annotation([(0.0, 1.0, "SPEAKER_00")]), None)


class _NvmlThenCpuPipeline(_OomThenCpuPipeline):
    failure_message = "NVML_SUCCESS == DriverAPI::get()->nvmlInit_v2_() CUDACachingAllocator"
    failure_type = RuntimeError
    def __call__(self, audio):
        self.calls += 1
        if self.calls == 1:
            raise self.failure_type(self.failure_message)
        return _Output(_Annotation([(0.0, 1.0, "SPEAKER_00")]), None)

class _BatchSizeThenCpuPipeline(_NvmlThenCpuPipeline):
    failure_message = "batch_size ( 8) is probably too large. Try with a smaller value until memory error disappears."
    failure_type = MemoryError

class PyannoteDiarizerFallbackTests(unittest.TestCase):
    def test_falls_back_to_cpu_and_lets_the_next_recording_try_the_gpu_again(self) -> None:
        import numpy as np

        built = []

        def factory():
            built.append(_OomThenCpuPipeline())
            return built[-1]

        diarizer = PyannoteDiarizer(
            pipeline_factory=factory,
            device="cuda",
            audio_loader=lambda path: np.zeros(16_000, dtype=np.float32),
        )

        turns = diarizer.diarize("/tmp/full-gpu.wav")

        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 1_000, "speaker": 0}])
        self.assertEqual(built[0].devices, ["cpu"])
        # The pipeline is dropped so a later recording rebuilds it on the GPU instead
        # of silently staying on CPU for the life of the worker.
        self.assertIsNone(diarizer._pipeline)

        diarizer.diarize("/tmp/next.wav")
        self.assertEqual(len(built), 2)


    def test_falls_back_to_cpu_for_nvml_runtime_errors(self) -> None:
        import numpy as np

        built = []

        def factory():
            built.append(_NvmlThenCpuPipeline())
            return built[-1]

        diarizer = PyannoteDiarizer(
            pipeline_factory=factory,
            device="cuda",
            audio_loader=lambda path: np.zeros(16_000, dtype=np.float32),
        )

        turns = diarizer.diarize("/tmp/nvml-failure.wav")

        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 1_000, "speaker": 0}])
        self.assertEqual(built[0].devices, ["cpu"])
        self.assertIsNone(diarizer._pipeline)

    def test_falls_back_to_cpu_for_pyannote_memory_errors(self) -> None:
        import numpy as np

        built = []

        def factory():
            built.append(_BatchSizeThenCpuPipeline())
            return built[-1]

        diarizer = PyannoteDiarizer(
            pipeline_factory=factory,
            device="cuda",
            audio_loader=lambda path: np.zeros(16_000, dtype=np.float32),
        )

        turns = diarizer.diarize("/tmp/batch-size-failure.wav")

        self.assertEqual(turns, [{"start_ms": 0, "end_ms": 1_000, "speaker": 0}])
        self.assertEqual(built[0].devices, ["cpu"])
        self.assertIsNone(diarizer._pipeline)

    def test_does_not_retry_a_cpu_memory_error_as_a_gpu_fallback(self) -> None:
        import numpy as np

        built = []

        def factory():
            built.append(_BatchSizeThenCpuPipeline())
            return built[-1]

        diarizer = PyannoteDiarizer(
            pipeline_factory=factory,
            device="cpu",
            audio_loader=lambda path: np.zeros(16_000, dtype=np.float32),
        )

        with self.assertRaises(MemoryError):
            diarizer.diarize("/tmp/cpu-failure.wav")
        self.assertEqual(built[0].calls, 1)

if __name__ == "__main__":
    unittest.main()
