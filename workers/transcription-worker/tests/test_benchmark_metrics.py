import unittest

from transcription_worker.benchmark_metrics import evaluate_benchmark


class BenchmarkMetricTests(unittest.TestCase):
    def test_scores_high_risk_evidence_and_operational_metrics_deterministically(self) -> None:
        manifest = {
            "schemaVersion": 1,
            "corpusVersion": "test-v1",
            "cases": [
                {
                    "id": "zh-sales",
                    "scoringUnit": "character",
                    "reference": {
                        "rawText": "發電機 750kW",
                        "displayText": "發電機 750kW",
                        "languageSpans": ["750kW"],
                        "traditionalSpans": ["發電機"],
                        "domainEntities": ["發電機"],
                        "numerics": ["750kW"],
                        "summaryClaims": ["需要發電機"],
                        "actionItems": ["send quote"],
                        "decisions": ["use X-5"],
                    },
                },
                {
                    "id": "english",
                    "scoringUnit": "word",
                    "reference": {
                        "rawText": "needs filter",
                        "displayText": "needs filter",
                        "languageSpans": ["needs filter"],
                        "traditionalSpans": [],
                        "domainEntities": [],
                        "numerics": [],
                        "summaryClaims": [],
                        "actionItems": [],
                        "decisions": [],
                    },
                },
            ],
        }
        results = {
            "schemaVersion": 1,
            "corpusVersion": "test-v1",
            "provider": "candidate",
            "model": "candidate-model",
            "cases": [
                {
                    "id": "zh-sales",
                    "rawText": "發電機 750kW",
                    "displayText": "發電機 750kW",
                    "summaryClaims": ["需要發電機", "客戶已購買"],
                    "actionItems": ["send quote", "call tomorrow"],
                    "decisions": [],
                    "latencyMs": 100,
                    "usage": {"inputTokens": 10, "outputTokens": 4, "totalTokens": 14},
                },
                {
                    "id": "english",
                    "rawText": "needs filters",
                    "displayText": "needs filters",
                    "summaryClaims": [],
                    "actionItems": [],
                    "decisions": [],
                    "latencyMs": 200,
                    "usage": {"inputTokens": 5, "outputTokens": 2, "totalTokens": 7},
                },
            ],
        }

        report = evaluate_benchmark(manifest, results)

        self.assertEqual(report["corpusVersion"], "test-v1")
        self.assertEqual(report["caseCount"], 2)
        self.assertEqual(report["characterErrorRate"], 0.0)
        self.assertEqual(report["wordErrorRate"], 0.5)
        self.assertEqual(report["languagePreservationRate"], 0.5)
        self.assertEqual(report["traditionalNormalizationAccuracy"], 1.0)
        self.assertEqual(report["domainEntityAccuracy"], 1.0)
        self.assertEqual(report["numericAccuracy"], 1.0)
        self.assertEqual(report["unsupportedSummaryClaimCount"], 1)
        self.assertEqual(report["actionItemPrecision"], 0.5)
        self.assertEqual(report["actionItemRecall"], 1.0)
        self.assertEqual(report["decisionRecall"], 0.0)
        self.assertEqual(report["averageLatencyMs"], 150.0)
        self.assertEqual(
            report["usage"],
            {"inputTokens": 15, "outputTokens": 6, "totalTokens": 21},
        )

    def test_rejects_results_from_a_different_corpus_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "corpusVersion"):
            evaluate_benchmark(
                {"schemaVersion": 1, "corpusVersion": "v1", "cases": []},
                {"schemaVersion": 1, "corpusVersion": "v2", "cases": []},
            )


if __name__ == "__main__":
    unittest.main()
