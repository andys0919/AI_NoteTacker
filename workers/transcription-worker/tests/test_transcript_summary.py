import unittest

from transcription_worker.transcript_summary import build_summary_prompt


class TranscriptSummaryPromptTests(unittest.TestCase):
    def test_requires_empty_unsupported_sections_and_prohibits_inference(self) -> None:
        prompt = build_summary_prompt(
            {
                "language": "zh-Hant",
                "segments": [
                    {
                        "start_ms": 0,
                        "end_ms": 1000,
                        "text": "客戶提到設備價格。",
                    }
                ],
            },
            summary_profile="sales",
        )

        self.assertIn("Only include an action item when the transcript explicitly assigns", prompt)
        self.assertIn("Use an empty array", prompt)
        self.assertIn("Do not invent generic follow-up work", prompt)
        self.assertIn("Do not repeat the same fact", prompt)
        self.assertIn("Only include a decision when the transcript explicitly reaches", prompt)
        self.assertIn("Keep tentative, contested, or later-to-be-confirmed points out", prompt)
        self.assertIn("Do not treat questions as facts", prompt)

    def test_marks_review_candidates_as_unconfirmed_and_preserves_literals(self) -> None:
        prompt = build_summary_prompt(
            {
                "language": "zh-Hant",
                "segments": [
                    {
                        "start_ms": 0,
                        "end_ms": 1000,
                        "text": "需要黑電淨化器與750kW unit X-5。",
                        "raw_text": "需要黑電淨化器與750kW unit X-5。",
                        "review_flags": [
                            {
                                "reason": "domain-term",
                                "original_text": "黑電淨化器",
                                "candidates": ["黑煙淨化器"],
                            }
                        ],
                    }
                ],
            }
        )

        self.assertIn("UNCONFIRMED", prompt)
        self.assertIn("黑電淨化器", prompt)
        self.assertIn("黑煙淨化器", prompt)
        self.assertIn("Do not resolve or accept a review candidate", prompt)
        self.assertIn("750kW", prompt)
        self.assertIn("X-5", prompt)
        self.assertIn("Preserve foreign-language text", prompt)

    def test_uses_operator_verified_display_alias_without_unconfirmed_flag(self) -> None:
        prompt = build_summary_prompt(
            {
                "language": "zh-Hant",
                "segments": [
                    {
                        "start_ms": 0,
                        "end_ms": 1000,
                        "text": "掃描舌片條碼。",
                        "raw_text": "掃描蛇片條碼。",
                        "display_text": "掃描舌片條碼。",
                        "review_flags": [
                            {
                                "reason": "operator-verified-alias",
                                "original_text": "蛇片",
                                "candidates": ["舌片"],
                            }
                        ],
                    }
                ],
            }
        )

        self.assertIn("掃描舌片條碼", prompt)
        self.assertNotIn("蛇片", prompt)
        self.assertNotIn("UNCONFIRMED review flag", prompt)

    def test_prefixes_only_aligned_anonymous_speaker_evidence(self) -> None:
        prompt = build_summary_prompt(
            {
                "segments": [
                    {"text": "請確認規格。", "speaker": "Speaker A"},
                    {"text": "尚未決定。"},
                ]
            }
        )

        self.assertIn("Speaker A: 請確認規格。\n尚未決定。", prompt)
        self.assertIn("do not infer a person's real identity", prompt)


if __name__ == "__main__":
    unittest.main()
