import unittest

from transcription_worker.transcript_summary import (
    build_summary_prompt,
    coerce_summary_payload,
    render_summary_markdown,
)


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

        self.assertIn("Only include follow-up work when the transcript explicitly assigns", prompt)
        self.assertIn("Use an empty array", prompt)
        self.assertIn("Do not invent generic follow-up work", prompt)
        self.assertIn("Do not repeat the same fact", prompt)
        self.assertIn("Only include a decision when the transcript explicitly reaches", prompt)
        self.assertIn("Keep tentative, contested, or later-to-be-confirmed points out", prompt)
        self.assertIn("Do not treat questions as facts", prompt)
        self.assertIn('"status": "confirmed" | "mixed" | "open"', prompt)
        self.assertIn("never use a fixed meeting-specific topic list", prompt)
        self.assertIn("beginning, middle, and final third", prompt)
        self.assertIn("Create a main topic only for an independent decision domain", prompt)
        self.assertIn("Keep related functions, screens, exceptions, examples", prompt)
        self.assertIn("order supported subtopics by prerequisites, normal flow", prompt)
        self.assertIn("subject, action, condition, and result", prompt)
        self.assertIn("name that dependency in the dependent topic", prompt)
        self.assertIn("never infer a dependency from proximity alone", prompt)
        self.assertIn("do not target, pad, minimize, or cap their count", prompt)
        self.assertIn("Prefer complete coverage over a shorter answer", prompt)
        self.assertIn("A requirement or design conclusion is not automatically a follow-up", prompt)
        self.assertIn("Group follow-up items that produce the same deliverable", prompt)
        self.assertIn("analysis notes that share the same root cause", prompt)
        self.assertIn("grammatically complete prose", prompt)
        self.assertIn("use only the supported functional description", prompt)
        self.assertIn("unresolved choices, missing inputs, or pending approvals", prompt)
        self.assertIn("every explicit follow-up, decision, risk, and open question", prompt)
        self.assertNotIn("small number of content-derived topics", prompt)
        self.assertNotIn("3 to 8", prompt)
        self.assertIn("Do not emit placeholders", prompt)
        self.assertNotIn("自動化裝配產線", prompt)

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

    def test_ignores_stored_speaker_evidence(self) -> None:
        prompt = build_summary_prompt(
            {
                "segments": [
                    {"text": "Speaker A：請確認規格。", "speaker": "Speaker A"},
                    {"text": "Speaker B:不要保留分類。", "speaker": "Speaker B"},
                    {"text": "尚未決定。"},
                ]
            }
        )

        self.assertIn("[S0001 00:00:00-00:00:00] 請確認規格。", prompt)
        self.assertIn("[S0002 00:00:00-00:00:00] 不要保留分類。", prompt)
        self.assertIn("[S0003 00:00:00-00:00:00] 尚未決定。", prompt)
        self.assertNotIn("Speaker A", prompt)
        self.assertNotIn("Speaker B", prompt)

    def test_derives_legacy_fields_from_the_canonical_hierarchy(self) -> None:
        payload = coerce_summary_payload(
            """
            {
              "title": "產品上線與待確認時程",
              "summary": "會議確認核心上線範圍，部署日期仍待確認。",
              "topics": [{
                "title": "上線範圍",
                "status": "mixed",
                "subtopics": [{
                  "title": "核心功能",
                  "details": ["先完成核心功能。", "部署日期尚未定案。"]
                }],
                "conclusion": "核心範圍已確認，日期待確認。"
              }],
              "follow_up_groups": [{
                "title": "部署準備",
                "items": ["Andy 更新部署清單。"]
              }],
              "decisions": [],
              "risks": [],
              "open_questions": ["部署日期為何？"],
              "analysis_notes": ["日期未定會影響對外安排。"]
            }
            """,
            provider_label="test",
            require_complete_schema=True,
        )

        self.assertEqual(
            payload["topics"][0]["points"],
            [
                "核心功能：先完成核心功能。",
                "核心功能：部署日期尚未定案。",
            ],
        )
        self.assertEqual(payload["key_points"], ["核心範圍已確認，日期待確認。"])
        self.assertEqual(payload["action_items"], ["Andy 更新部署清單。"])

    def test_renders_hierarchy_and_omits_empty_sections(self) -> None:
        markdown = render_summary_markdown(
            {
                "title": "產品上線與待確認時程",
                "summary": "會議確認上線範圍，部署日期仍待確認。",
                "topics": [
                    {
                        "title": "上線範圍",
                        "status": "mixed",
                        "subtopics": [
                            {
                                "title": "核心功能",
                                "details": ["先完成核心功能。", "部署日期尚未定案。"],
                            }
                        ],
                        "points": ["先完成核心功能。", "部署日期尚未定案。"],
                        "conclusion": "核心範圍已確認，日期待確認。",
                    }
                ],
                "follow_up_groups": [
                    {
                        "title": "部署準備",
                        "items": ["Andy 更新部署清單。"],
                    }
                ],
                "analysis_notes": ["日期未定會影響對外安排。"],
                "key_points": ["不應在 topics 存在時重複顯示。"],
                "action_items": ["Andy 更新部署清單。"],
                "decisions": [],
                "risks": [],
                "open_questions": ["部署日期為何？"],
            }
        )

        self.assertIn("# 產品上線與待確認時程", markdown)
        self.assertIn("## 會議紀要", markdown)
        self.assertIn("### 上線範圍", markdown)
        self.assertIn("#### 核心功能", markdown)
        self.assertIn("**狀態：** 部分確認", markdown)
        self.assertIn("## 後續安排", markdown)
        self.assertIn("### 部署準備", markdown)
        self.assertIn("## 待確認問題", markdown)
        self.assertIn("## AI 分析", markdown)
        self.assertNotIn("不應在 topics 存在時重複顯示", markdown)
        self.assertNotIn("None.", markdown)
        self.assertNotIn("## 已確認決議", markdown)


if __name__ == "__main__":
    unittest.main()
