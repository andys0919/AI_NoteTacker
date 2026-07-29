def _normalized_language(language: str) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("zh"):
        return "zh-Hant"
    if normalized in {"nan", "nan-tw"}:
        return "nan"
    if not normalized or normalized == "unknown":
        return "und"
    return language


class TranscriptNormalizer:
    def __init__(self, converter=None) -> None:
        self._converter = converter

    def _get_converter(self):
        if self._converter is not None:
            return self._converter

        from opencc import OpenCC

        self._converter = OpenCC("s2twp")
        return self._converter

    def normalize(
        self,
        text: str,
        *,
        language: str,
        start_ms: int,
        end_ms: int,
        timing_source: str = "estimated",
        language_confidence: float | None = None,
        glossary: list | tuple | None = None,
    ) -> dict:
        raw_text = text
        display_text = text
        flags = []
        accepted_aliases = set()
        glossary = glossary or []
        normalized_language = _normalized_language(language)

        for entry in glossary:
            if not isinstance(entry, dict) or not entry.get("accepted"):
                continue
            term = str(entry.get("term") or "").strip()
            for alias in entry.get("aliases", []):
                alias = str(alias).strip()
                if not term or not alias or alias == term or alias not in raw_text:
                    continue
                display_text = display_text.replace(alias, term)
                accepted_aliases.add(alias)
                flags.append(
                    {
                        "reason": "operator-verified-alias",
                        "original_text": alias,
                        "candidates": [term],
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "evidence": "operator-verified glossary",
                    }
                )

        if normalized_language == "zh-Hant":
            try:
                display_text = self._get_converter().convert(display_text)
            except Exception as error:
                flags.append(
                    {
                        "reason": "normalization-failed",
                        "original_text": text,
                        "candidates": [],
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "evidence": str(error),
                    }
                )

        flags.extend(
            flag
            for flag in self._review_flags(
                raw_text,
                language=normalized_language,
                start_ms=start_ms,
                end_ms=end_ms,
                glossary=glossary,
            )
            if flag["original_text"] not in accepted_aliases
        )
        result = {
            "raw_text": raw_text,
            "display_text": display_text,
            "language": normalized_language,
            "timing_source": timing_source,
            "review_flags": flags,
        }
        if language_confidence is not None:
            result["language_confidence"] = language_confidence
        return result

    def _review_flags(
        self,
        text: str,
        *,
        language: str,
        start_ms: int,
        end_ms: int,
        glossary: list | tuple,
    ) -> list[dict]:
        flags = []
        for entry in glossary:
            if not isinstance(entry, dict) or entry.get("accepted"):
                continue
            term = str(entry.get("term") or "").strip()
            aliases = [str(alias).strip() for alias in entry.get("aliases", []) if str(alias).strip()]
            for alias in aliases:
                if alias not in text or not term or alias == term:
                    continue
                is_taiwanese = language == "nan" or entry.get("language") == "nan"
                candidates = [term]
                tailo = str(entry.get("tailo") or "").strip()
                if is_taiwanese and tailo:
                    candidates.append(tailo)
                flags.append(
                    {
                        "reason": "taiwanese-uncertain" if is_taiwanese else "domain-term",
                        "original_text": alias,
                        "candidates": candidates,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                        "evidence": "workflow glossary",
                    }
                )
        return flags
