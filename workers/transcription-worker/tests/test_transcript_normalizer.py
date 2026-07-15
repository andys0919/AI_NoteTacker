import unittest

from transcription_worker.transcript_normalizer import TranscriptNormalizer


class _StubConverter:
    def convert(self, text):
        return text.replace("简体中文", "簡體中文").replace("发电机", "發電機")


class _FailingConverter:
    def convert(self, _text):
        raise RuntimeError("converter failed")


class TranscriptNormalizerTests(unittest.TestCase):
    def test_preserves_raw_text_and_converts_only_chinese_display_text(self) -> None:
        normalizer = TranscriptNormalizer(converter=_StubConverter())

        result = normalizer.normalize(
            "简体中文 and English",
            language="zh",
            start_ms=0,
            end_ms=1000,
            timing_source="provider",
        )

        self.assertEqual(result["raw_text"], "简体中文 and English")
        self.assertEqual(result["display_text"], "簡體中文 and English")
        self.assertEqual(result["language"], "zh-Hant")
        self.assertEqual(result["timing_source"], "provider")

    def test_does_not_convert_japanese_or_unknown_cjk_text(self) -> None:
        normalizer = TranscriptNormalizer(converter=_StubConverter())

        japanese = normalizer.normalize("発電機です", language="ja", start_ms=0, end_ms=1)
        unknown = normalizer.normalize("简体中文", language="unknown", start_ms=0, end_ms=1)

        self.assertEqual(japanese["display_text"], "発電機です")
        self.assertEqual(unknown["display_text"], "简体中文")
        self.assertEqual(unknown["language"], "und")

    def test_fails_open_without_mutating_text_when_conversion_fails(self) -> None:
        normalizer = TranscriptNormalizer(converter=_FailingConverter())

        result = normalizer.normalize("简体中文", language="zh", start_ms=0, end_ms=1000)

        self.assertEqual(result["raw_text"], "简体中文")
        self.assertEqual(result["display_text"], "简体中文")
        self.assertEqual(result["review_flags"][0]["reason"], "normalization-failed")

    def test_flags_domain_alias_without_accepting_the_candidate(self) -> None:
        normalizer = TranscriptNormalizer(converter=_StubConverter())

        result = normalizer.normalize(
            "需要黑電淨化器",
            language="zh",
            start_ms=500,
            end_ms=1500,
            glossary=[
                {
                    "term": "黑煙淨化器",
                    "aliases": ["黑電淨化器"],
                }
            ],
        )

        self.assertEqual(result["display_text"], "需要黑電淨化器")
        self.assertEqual(
            result["review_flags"],
            [
                {
                    "reason": "domain-term",
                    "original_text": "黑電淨化器",
                    "candidates": ["黑煙淨化器"],
                    "start_ms": 500,
                    "end_ms": 1500,
                    "evidence": "workflow glossary",
                }
            ],
        )

    def test_adds_traditional_and_tailo_candidates_for_uncertain_hokkien(self) -> None:
        normalizer = TranscriptNormalizer(converter=_StubConverter())

        result = normalizer.normalize(
            "我不知道",
            language="nan",
            start_ms=0,
            end_ms=900,
            glossary=[
                {
                    "term": "我毋知影",
                    "aliases": ["我不知道"],
                    "tailo": "guá m̄ tsai-iánn",
                    "language": "nan",
                }
            ],
        )

        self.assertEqual(result["display_text"], "我不知道")
        self.assertEqual(result["review_flags"][0]["reason"], "taiwanese-uncertain")
        self.assertEqual(
            result["review_flags"][0]["candidates"],
            ["我毋知影", "guá m̄ tsai-iánn"],
        )


if __name__ == "__main__":
    unittest.main()
