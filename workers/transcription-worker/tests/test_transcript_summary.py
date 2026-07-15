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


if __name__ == "__main__":
    unittest.main()
