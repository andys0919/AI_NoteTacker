"""Whole-recording speaker diarization on the worker host, aligned to transcript phrases.

Provider diarization (MAI-Transcribe-2) is scoped to one request of at most 25 minutes,
so a long meeting gets a fresh set of speaker ids per chunk and every seam can turn one
person into a new label (an 80-minute meeting with 4-6 people came back with 10). One
diarization pass over the whole recording yields one global set of labels.

The two systems are good at different things, so each decides only what it is good at.
The provider hears a half-second "好" from a listener while someone else is mid-sentence
and gives it its own phrase; a whole-file pass folds that overlap into the dominant
voice, and blind readers judged its transcripts markedly worse for exactly that reason.
So the provider keeps deciding WHICH PHRASE belongs to which of its labels, and the
whole-file pass only decides WHICH PROVIDER LABELS ARE THE SAME PERSON: every phrase
votes (by duration) for the diarization turn it overlaps most, and the whole provider
label follows its own majority. Phrases with no provider label fall back to their own
per-phrase vote, and to the nearest turn when nothing overlaps.

A provider label sometimes covers two people, which no amount of majority voting can
undo. Letting confident phrases overrule their own label was tried and reverted: it
does split such a label, but on the reference meeting it also swapped a host's question
with the answer to it and made one speaker oscillate between two identities, and blind
readers preferred the plain majority rule 18 votes to 6. The reason is that the
confidence test (phrase length, share covered by one turn) lives on the same axis as the
vote it was meant to police, so it cannot tell signal from noise.

Voice does. Before the vote, each provider label is clustered by speaker embedding, and
a label whose phrases fall into two well-separated, substantial voices is split in two.
On the reference meeting that separated two people the provider had filed under one
label while changing neither the phrase boundaries nor the backchannel attribution:
still 2 of 852 adjacent-phrase relations differing from the provider, still 2 short
replies moved.

Voice also corrects single lines. In a quick exchange the provider files a few lines of
one person under whoever holds the floor, and those lines belong to several different
people, so no label-level split can recover them; the label vote even overrules the turn
that already heard the right person. After the vote each embedded phrase is compared,
AS-normalised, with every final speaker of the same recording, and moves only when another
speaker beats its own by VOICE_REASSIGN_GATE and the turn it overlaps most agrees. This is
not the reverted confidence overrule: that one let turn overlap decide on its own, while
here the voice decides and the turn can only veto, and phrases too short to embed, where
backchannels live, never move.

The embedding is the CNCeleb-trained WeSpeaker ResNet34 baked into the image. On this
product's Mandarin/English meetings it separated voices the diarization model's own
embedding (VoxCeleb-trained, no Mandarin) measurably could not: on a disputed line the
operator adjudicated, WeSpeaker matched the right voice with the same margin as its
confident matches while the pyannote embedding picked the wrong voice under every
scoring variant tried. Phrases also only vote when they carry at least a second of
actual voice: provider timings include pauses, and one measured 3-second phrase held
half a second of speech inside near-digital silence.

The diarization model is pyannote speaker-diarization-community-1 (CC-BY-4.0), served
from the ungated pyannote-community mirror so no Hugging Face token is needed.
"""
import bisect
import os
import subprocess

import numpy as np

DEFAULT_MODEL = "pyannote-community/speaker-diarization-community-1"
DEFAULT_EMBEDDING_MODEL = "/models/speaker-embedding.onnx"
SAMPLE_RATE = 16_000
# Voice splitting. Embeddings of very short phrases are unreliable (the model is trained
# on multi-second chunks), so only longer phrases get a vote on how a label divides.
VOICE_MIN_PHRASE_MS = 1_500
# Provider phrase timings include pauses: a real 3-second line was measured to hold only
# 0.57 s of voice between 2.5 s of near-digital silence. A phrase votes only when it
# carries at least this much actual voice, counted in frames within 35 dB of the
# recording's own speech level.
VOICE_MIN_VOICED_MS = 1_000
VOICE_FRAME_MS = 20
VOICE_SILENCE_DROP_DB = 35.0
# Cosine distance between average-linked clusters. Each embedding model has its own
# scale, so the threshold belongs to the model. Both values sit mid-plateau on the
# reference meeting: WeSpeaker satisfied every known truth from 0.35 to 0.55 with the
# guard metrics unchanged, the pyannote fallback from 0.65 to 0.80.
VOICE_DISTANCE_THRESHOLD = 0.45
VOICE_DISTANCE_THRESHOLD_FALLBACK = 0.70
# A second voice has to be worth believing before a label is split. The smallest true
# split found in the reference meeting was 3 phrases over 11 seconds; single long
# outliers below this are one person sounding different, not a second person.
VOICE_MIN_PHRASES = 3
VOICE_MIN_SPEECH_MS = 10_000
# Two-voice test. On a shared meeting channel raw cosine is compressed (two different
# people measured 0.88), so a fixed distance cannot tell a second voice from one voice on
# a bad day. Each phrase is instead scored against its most similar phrases from the rest
# of the recording (AS-norm), the label is cut in two spectrally, and the cut stands only
# when the halves are this many z-units more alike inside than across. On the reference
# meetings 2.3 to 2.8 split every fused pair of named speakers and no single speaker, and
# a gate picked on either meeting alone held on the other; 2.5 is mid-plateau. It needs
# other voices to normalise against, so below VOICE_MIN_COHORT the distance threshold
# above still decides.
VOICE_SEPARATION_GATE = 2.5
VOICE_COHORT_TOP_K = 100
VOICE_MIN_COHORT = 20
VOICE_AFFINITY_TEMPERATURE = 1.5
# Line-level correction. An embedded phrase moves to another final speaker only when that
# speaker scores this many AS-normalised z-units above its own speaker, whose centroid is
# rebuilt without the phrase, and the diarization turn the phrase overlaps most belongs to
# that same speaker, so two independent models have to agree. With 10% of confirmed
# phrases moved to a wrong speaker on three meetings, 1.5 recovered 70%, sent 4% to a
# third wrong speaker, and moved 0.12% of the phrases nobody disputed; the turn check cost
# one point of recovery and took those collateral moves from 0.49% down to 0.12%. Both
# lines an operator checked by ear moved to the right person. A speaker needs
# VOICE_REASSIGN_MIN_PHRASES embedded phrases to give or receive a line, since a handful
# of phrases makes no stable voice.
VOICE_REASSIGN_GATE = 1.5
VOICE_REASSIGN_MIN_PHRASES = 5


def _turn_votes(segments: list[dict], turns: list[dict]) -> list[int]:
    """The speaker of the turn each segment overlaps most, or of the nearest turn."""
    ordered = sorted(turns, key=lambda turn: (turn["start_ms"], turn["end_ms"]))
    starts = [turn["start_ms"] for turn in ordered]
    longest_ms = max(turn["end_ms"] - turn["start_ms"] for turn in ordered)

    per_segment: list[int] = []
    for segment in segments:
        start_ms, end_ms = segment["start_ms"], segment["end_ms"]
        # Turns are sorted by start, so only those starting before the segment ends
        # and no longer than the longest turn before its start can overlap it.
        first = bisect.bisect_left(starts, start_ms - longest_ms)
        last = bisect.bisect_right(starts, end_ms)
        overlap: dict[int, int] = {}
        for turn in ordered[first:last]:
            shared = min(end_ms, turn["end_ms"]) - max(start_ms, turn["start_ms"])
            if shared > 0:
                overlap[turn["speaker"]] = overlap.get(turn["speaker"], 0) + shared
        if overlap:
            speaker = max(overlap.items(), key=lambda item: (item[1], -item[0]))[0]
        else:
            speaker = min(
                ordered,
                key=lambda turn: (
                    max(turn["start_ms"] - end_ms, start_ms - turn["end_ms"], 0),
                    turn["start_ms"],
                    turn["end_ms"],
                    turn["speaker"],
                ),
            )["speaker"]
        per_segment.append(int(speaker))
    return per_segment


def assign_speaker_turns(
    segments: list[dict], turns: list[dict], group_key: str = "speaker"
) -> list[dict]:
    """Give every segment a ``speaker_index`` derived from the whole-recording turns.

    ``turns`` are ``{"start_ms", "end_ms", "speaker"}`` from the diarizer. Each segment
    first votes for the turn it overlaps most (nearest turn when nothing overlaps), then
    every segment sharing a provider label under ``group_key`` adopts that label's
    duration-weighted majority vote, which is what merges labels the provider split
    across its request boundaries. Segments stay untouched when there are no turns.
    """
    if not turns:
        return list(segments)
    per_segment = _turn_votes(segments, turns)

    votes: dict[object, dict[int, int]] = {}
    for segment, speaker in zip(segments, per_segment):
        label = segment.get(group_key)
        if label is None:
            continue
        counts = votes.setdefault(label, {})
        counts[speaker] = counts.get(speaker, 0) + max(0, segment["end_ms"] - segment["start_ms"])
    majority = {
        label: max(counts.items(), key=lambda item: (item[1], -item[0]))[0]
        for label, counts in votes.items()
    }
    return [
        {**segment, "speaker_index": majority.get(segment.get(group_key), speaker)}
        for segment, speaker in zip(segments, per_segment)
    ]


def _two_voice_cut(voices: np.ndarray, cohort: np.ndarray, gate: float) -> np.ndarray | None:
    """Cut one label's phrases in two, or return None when the halves are one voice."""
    from sklearn.cluster import KMeans

    voices = voices.astype(np.float64)
    nearest = np.sort(voices @ cohort.astype(np.float64).T, axis=1)[:, -VOICE_COHORT_TOP_K:]
    mean = nearest.mean(axis=1)
    spread = np.maximum(nearest.std(axis=1), 1e-6)
    similarity = voices @ voices.T
    z = 0.5 * (
        (similarity - mean[:, None]) / spread[:, None]
        + (similarity - mean[None, :]) / spread[None, :]
    )
    # The clip only keeps exp() finite on synthetic near-identical vectors; real meetings
    # stay far below it.
    affinity = np.exp(np.minimum(z, 50.0) / VOICE_AFFINITY_TEMPERATURE)
    np.fill_diagonal(affinity, 0.0)
    scale = 1.0 / np.sqrt(np.maximum(affinity.sum(axis=1), 1e-9))
    laplacian = np.eye(len(voices)) - affinity * scale[:, None] * scale[None, :]
    _, vectors = np.linalg.eigh(0.5 * (laplacian + laplacian.T))
    coordinates = vectors[:, :2]
    coordinates = coordinates / np.maximum(
        np.linalg.norm(coordinates, axis=1, keepdims=True), 1e-9
    )
    halves = KMeans(n_clusters=2, random_state=0, n_init=10).fit_predict(coordinates)
    first, second = halves == 0, halves == 1
    if first.sum() < 2 or second.sum() < 2:
        return None

    def inside(members):
        block = z[np.ix_(members, members)]
        return block[~np.eye(len(block), dtype=bool)].mean()

    if 0.5 * (inside(first) + inside(second)) - z[np.ix_(first, second)].mean() < gate:
        return None
    return halves


def split_labels_by_voice(
    segments: list[dict],
    embeddings: dict[int, np.ndarray],
    group_key: str = "speaker",
    distance_threshold: float = VOICE_DISTANCE_THRESHOLD,
    separation_gate: float | None = VOICE_SEPARATION_GATE,
) -> list[dict]:
    """Suffix a provider label when its phrases carry two clearly different voices.

    ``embeddings`` maps a segment index to a unit-norm speaker embedding; only phrases
    long enough to embed reliably need an entry. A label divides only when at least two
    of its clusters are substantial, so one odd-sounding phrase cannot invent a speaker.
    Phrases with no embedding follow the nearest embedded phrase of the same label.
    With ``separation_gate`` set and enough other voices to compare against, the two-voice
    cut decides; otherwise the fixed cosine ``distance_threshold`` does.
    """
    from sklearn.cluster import AgglomerativeClustering

    embedded: dict[object, list[int]] = {}
    for index, segment in enumerate(segments):
        label = segment.get(group_key)
        if label is not None and index in embeddings:
            embedded.setdefault(label, []).append(index)

    cluster_of: dict[int, int] = {}
    for label, indexes in embedded.items():
        if len(indexes) < VOICE_MIN_PHRASES:
            continue
        voices = np.stack([embeddings[index] for index in indexes])
        members = set(indexes)
        cohort = [other for other in embeddings if other not in members]
        if separation_gate is not None and len(cohort) >= VOICE_MIN_COHORT:
            halves = _two_voice_cut(
                voices, np.stack([embeddings[other] for other in cohort]), separation_gate
            )
            assignments = np.zeros(len(indexes), dtype=int) if halves is None else halves
        else:
            assignments = AgglomerativeClustering(
                n_clusters=None,
                metric="cosine",
                linkage="average",
                distance_threshold=distance_threshold,
            ).fit_predict(voices)
        phrases: dict[int, int] = {}
        speech_ms: dict[int, int] = {}
        for index, cluster in zip(indexes, assignments):
            phrases[cluster] = phrases.get(cluster, 0) + 1
            speech_ms[cluster] = speech_ms.get(cluster, 0) + (
                segments[index]["end_ms"] - segments[index]["start_ms"]
            )
        believable = {
            cluster
            for cluster in phrases
            if phrases[cluster] >= VOICE_MIN_PHRASES
            and speech_ms[cluster] >= VOICE_MIN_SPEECH_MS
        }
        if len(believable) < 2:
            continue
        # Anything too small to believe joins the label's dominant voice.
        dominant = max(believable, key=lambda cluster: speech_ms[cluster])
        for index, cluster in zip(indexes, assignments):
            cluster_of[index] = cluster if cluster in believable else dominant

    if not cluster_of:
        return list(segments)

    result = []
    for index, segment in enumerate(segments):
        label = segment.get(group_key)
        candidates = embedded.get(label) or []
        if index in cluster_of:
            cluster = cluster_of[index]
        elif candidates and any(other in cluster_of for other in candidates):
            nearest = min(
                (other for other in candidates if other in cluster_of),
                key=lambda other: abs(segments[other]["start_ms"] - segment["start_ms"]),
            )
            cluster = cluster_of[nearest]
        else:
            result.append(segment)
            continue
        result.append({**segment, group_key: f"{label}/{cluster}"})
    return result


def reassign_phrases_by_voice(
    segments: list[dict],
    embeddings: dict[int, np.ndarray],
    turns: list[dict],
    group_key: str = "speaker_index",
    gate: float = VOICE_REASSIGN_GATE,
) -> list[dict]:
    """Move single embedded phrases to the speaker of this recording they sound like.

    A phrase moves only when another speaker beats its own speaker, rebuilt without the
    phrase, by ``gate`` AS-normalised z-units, and the turn the phrase overlaps most
    belongs to that speaker. Phrases without an embedding never move.
    """
    if not turns:
        return list(segments)
    indexes = sorted(
        index
        for index in embeddings
        if index < len(segments) and segments[index].get(group_key) is not None
    )
    if not indexes:
        return list(segments)
    matrix = np.stack([embeddings[index] for index in indexes]).astype(np.float64)
    matrix /= np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9
    owners = np.array([segments[index][group_key] for index in indexes], dtype=object)
    counts: dict[object, int] = {}
    for owner in owners:
        counts[owner] = counts.get(owner, 0) + 1
    voices = [owner for owner, count in counts.items() if count >= VOICE_REASSIGN_MIN_PHRASES]
    if len(voices) < 2:
        return list(segments)

    sums = {voice: matrix[owners == voice].sum(axis=0) for voice in voices}
    centroids = {voice: sums[voice] / np.linalg.norm(sums[voice]) for voice in voices}
    norms = {}
    for voice in voices:
        impostor = matrix[owners != voice] @ centroids[voice]
        norms[voice] = (impostor.mean(), impostor.std() + 1e-9)

    heard = _turn_votes(segments, turns)
    result = list(segments)
    for position, index in enumerate(indexes):
        own = owners[position]
        if own not in centroids or counts[own] <= VOICE_REASSIGN_MIN_PHRASES:
            continue
        vector = matrix[position]
        scores = {}
        for voice in voices:
            centroid = centroids[voice]
            if voice == own:
                centroid = sums[voice] - vector
                centroid = centroid / np.linalg.norm(centroid)
            scores[voice] = (vector @ centroid - norms[voice][0]) / norms[voice][1]
        best = max((voice for voice in voices if voice != own), key=scores.__getitem__)
        if scores[best] - scores[own] >= gate and heard[index] == best:
            result[index] = {**segments[index], group_key: best}
    return result


def _frame_rms(samples: np.ndarray) -> np.ndarray:
    frame = SAMPLE_RATE * VOICE_FRAME_MS // 1000
    count = len(samples) // frame
    if count == 0:
        return np.zeros(0, dtype=np.float32)
    frames = samples[: count * frame].reshape(count, frame).astype(np.float32)
    return np.sqrt(np.mean(frames * frames, axis=1) + 1e-12)


def _speech_amplitude(samples: np.ndarray) -> float:
    """The recording's own speech level: the 95th percentile frame RMS.

    Anchoring on the recording itself makes the voiced test hold for quiet and loud
    rooms alike; measured speech peaks sat ~55 dB above the silence between words.
    """
    rms = _frame_rms(samples)
    return float(np.percentile(rms, 95)) if len(rms) else 0.0


def _voiced_ms(span: np.ndarray, speech_amplitude: float) -> int:
    """How much of this span actually carries voice, in milliseconds."""
    if speech_amplitude <= 0:
        return 0
    threshold = speech_amplitude * (10 ** (-VOICE_SILENCE_DROP_DB / 20))
    return int(np.count_nonzero(_frame_rms(span) >= threshold)) * VOICE_FRAME_MS


def load_audio(local_audio_path: str) -> np.ndarray:
    """Decode any container/rate to 16 kHz mono float32.

    A WAV passthrough upload can still be stereo 44.1 kHz, so never trust the extension.
    """
    decoded = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", local_audio_path, "-vn",
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-",
        ],
        capture_output=True,
        check=False,
    )
    if decoded.returncode != 0:
        raise RuntimeError(
            f"Failed to decode audio for diarization: {decoded.stderr.decode(errors='replace').strip()}"
        )
    return np.frombuffer(decoded.stdout, dtype=np.int16).astype(np.float32) / 32768.0


class PyannoteDiarizer:
    """Offline diarization of one recording with a pyannote pipeline."""

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        device: str = "auto",
        batch_size: int = 8,
        embedding_model: str = DEFAULT_EMBEDDING_MODEL,
        num_threads: int | None = None,
        pipeline_factory=None,
        embedder_factory=None,
        audio_loader=load_audio,
    ) -> None:
        self.model = model
        self.device = device
        self.embedding_model = embedding_model or DEFAULT_EMBEDDING_MODEL
        self.num_threads = num_threads or min(8, os.cpu_count() or 1)
        # The default batch of 32 needs ~2.5 GB of GPU memory; the shared card also
        # serves other workloads, so keep the footprint small and let the CPU take over
        # when even that does not fit.
        self.batch_size = batch_size
        self._pipeline_factory = pipeline_factory or self._build_pipeline
        self._embedder_factory = embedder_factory or self._build_embedder
        self._audio_loader = audio_loader
        self._pipeline_device = None
        self._pipeline = None
        self._embedder = None
        self._distance_threshold = VOICE_DISTANCE_THRESHOLD
        self._separation_gate = VOICE_SEPARATION_GATE
        self._reassign_gate = VOICE_REASSIGN_GATE

    @property
    def label(self) -> str:
        return self.model.rsplit("/", 1)[-1]

    def _build_pipeline(self):
        import torch  # imported lazily: the summary image and tests carry no torch
        from pyannote.audio import Pipeline

        pipeline = Pipeline.from_pretrained(self.model)
        if pipeline is None:
            raise RuntimeError(f"Speaker diarization model {self.model!r} is unavailable")
        pipeline.segmentation_batch_size = self.batch_size
        pipeline.embedding_batch_size = self.batch_size
        device = self.device
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self._pipeline_device = device
        return pipeline.to(torch.device(device))

    def _build_embedder(self):
        # First choice: the CNCeleb-trained WeSpeaker model. On the reference meetings
        # it separated two voices the pyannote embedding could not tell apart, because
        # this audio is Mandarin/English mixed and the pyannote embedding never saw
        # Mandarin training data. ONNX on the CPU, ~70 ms per phrase, no token.
        if os.path.exists(self.embedding_model):
            import sherpa_onnx

            extractor = sherpa_onnx.SpeakerEmbeddingExtractor(
                sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=self.embedding_model, num_threads=self.num_threads
                )
            )

            def embed(voice_samples: np.ndarray) -> np.ndarray:
                stream = extractor.create_stream()
                stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=voice_samples)
                stream.input_finished()
                return np.asarray(extractor.compute(stream))

            return embed

        # Fallback: the embedding submodel shipped inside the diarization repo, so a
        # deployment without the ONNX file still splits, just with the weaker model.
        from pyannote.audio.pipelines.speaker_verification import PretrainedSpeakerEmbedding

        import torch

        pretrained = PretrainedSpeakerEmbedding(
            {"checkpoint": self.model, "subfolder": "embedding"}
        )
        # Only widen the threshold once the fallback model is really in hand, so a
        # failed build cannot leave the diarizer on the wrong scale for the next try.
        self._distance_threshold = VOICE_DISTANCE_THRESHOLD_FALLBACK
        # The separation gate was calibrated on the WeSpeaker embedding only; with this
        # model the fixed distance threshold keeps deciding, as it did before the gate.
        self._separation_gate = None
        self._reassign_gate = None
        print(
            f"speaker embedding model {self.embedding_model} not found, using the "
            f"diarization model's own embedding instead",
            flush=True,
        )
        return lambda voice_samples: np.asarray(
            pretrained(torch.from_numpy(voice_samples).reshape(1, 1, -1))
        )[0]

    def _embed_phrases(self, samples: np.ndarray, segments: list[dict]) -> dict[int, np.ndarray]:
        """Unit-norm embeddings for the phrases that really carry enough voice."""
        if self._embedder is None:
            try:
                self._embedder = self._embedder_factory()
            except Exception as error:  # noqa: BLE001
                # Whole-file labels still apply without embeddings; a provider label
                # covering two people just stays merged. Do not latch this off: a
                # transient build failure should not disable splitting for every later
                # job in this worker's life, and a successful build is cached anyway.
                print(
                    f"speaker embeddings unavailable this job, labels will not be "
                    f"split by voice: {error}",
                    flush=True,
                )
                return {}
        speech_amplitude = _speech_amplitude(samples)
        embeddings: dict[int, np.ndarray] = {}
        for index, segment in enumerate(segments):
            if segment["end_ms"] - segment["start_ms"] < VOICE_MIN_PHRASE_MS:
                continue
            first = max(0, int(segment["start_ms"] * SAMPLE_RATE / 1000))
            last = min(len(samples), int(segment["end_ms"] * SAMPLE_RATE / 1000))
            span = samples[first:last]
            if len(span) < VOICE_MIN_PHRASE_MS * SAMPLE_RATE // 1000:
                continue
            # Quality gate: a phrase timed at three seconds can hold half a second of
            # actual voice padded with silence (measured on a real line the pipeline
            # got wrong). Such an embedding is noise; the phrase follows its label
            # instead of voting on how the label divides.
            if _voiced_ms(span, speech_amplitude) < VOICE_MIN_VOICED_MS:
                continue
            vector = self._embedder(span)
            norm = float(np.linalg.norm(vector))
            if norm > 0 and np.isfinite(norm):
                embeddings[index] = vector / norm
        return embeddings

    def label_segments(self, local_audio_path: str, segments: list[dict]) -> list[dict]:
        """Give every provider segment a whole-recording ``speaker_index``.

        One decode of the audio serves both passes: the diarization that decides which
        provider labels are the same person, and the embeddings that decide whether a
        provider label is really two people. Returns the segments unchanged when the
        diarizer produced nothing.
        """
        samples = self._audio_loader(local_audio_path)
        turns = self._diarize_samples(samples)
        if not turns:
            return list(segments)
        embeddings = self._embed_phrases(samples, segments)
        grouped = split_labels_by_voice(
            segments,
            embeddings,
            distance_threshold=self._distance_threshold,
            separation_gate=self._separation_gate,
        )
        labelled = assign_speaker_turns(grouped, turns)
        if self._reassign_gate is None:
            return labelled
        return reassign_phrases_by_voice(
            labelled, embeddings, turns, gate=self._reassign_gate
        )

    def diarize(self, local_audio_path: str) -> list[dict]:
        """Speaker turns for the whole recording as ``{"start_ms", "end_ms", "speaker"}``."""
        return self._diarize_samples(self._audio_loader(local_audio_path))

    def _diarize_samples(self, samples: np.ndarray) -> list[dict]:
        """Exclusive turns (one speaker per instant), which are made for reconciling
        with ASR timestamps; overlapping speech goes to the dominant voice.
        """
        import torch

        audio = {"waveform": torch.from_numpy(samples).unsqueeze(0), "sample_rate": SAMPLE_RATE}
        try:
            if self._pipeline is None:
                self._pipeline = self._pipeline_factory()
            if self._pipeline_device is None:
                self._pipeline_device = (
                    "cuda"
                    if self.device == "cuda"
                    or (self.device == "auto" and torch.cuda.is_available())
                    else "cpu"
                )
            output = self._pipeline(audio)
        except (torch.OutOfMemoryError, MemoryError, RuntimeError) as error:
            message = str(error).lower()
            if self._pipeline_device != "cuda" or (
                not isinstance(error, torch.OutOfMemoryError)
                and not any(
                    marker in message
                    for marker in (
                        "nvml",
                        "cachingallocator",
                        "out of memory",
                        "memory error",
                        "batch_size",
                    )
                )
            ):
                raise
            print(
                f"speaker diarization GPU unavailable ({error}), falling back to CPU "
                "for this recording",
                flush=True,
            )
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception as cleanup_error:  # noqa: BLE001
                print(
                    f"speaker diarization GPU cleanup failed before CPU fallback: "
                    f"{cleanup_error}",
                    flush=True,
                )
            original_device = self.device
            self.device = "cpu"
            try:
                if self._pipeline is None:
                    self._pipeline = self._pipeline_factory()
                else:
                    self._pipeline = self._pipeline.to(torch.device("cpu"))
                self._pipeline_device = "cpu"
                output = self._pipeline(audio)
            finally:
                self.device = original_device
                self._pipeline = None
                self._pipeline_device = None
        finally:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception as cleanup_error:  # noqa: BLE001
                print(
                    f"speaker diarization GPU cleanup failed: {cleanup_error}",
                    flush=True,
                )
        annotation = getattr(output, "exclusive_speaker_diarization", None)
        if annotation is None:
            annotation = getattr(output, "speaker_diarization", output)
        labels: dict[str, int] = {}
        return [
            {
                "start_ms": int(round(turn.start * 1000)),
                "end_ms": int(round(turn.end * 1000)),
                "speaker": labels.setdefault(label, len(labels)),
            }
            for turn, _track, label in annotation.itertracks(yield_label=True)
        ]
