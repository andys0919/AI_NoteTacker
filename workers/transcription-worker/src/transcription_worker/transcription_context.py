PRESERVE_SPOKEN_LANGUAGE_PROMPT = (
    "保留每段實際使用的語言，不要翻譯。中文內容使用正體中文；英文及其他語言保留原文。"
    "中英或其他語言混用時，依照說話內容原樣轉錄。詞彙提示只用於辨識實際說出的詞，不得插入未說出的內容。"
)

SALES_GLOSSARY = (
    {"term": "發電機", "aliases": ()},
    {"term": "消音器", "aliases": ()},
    {"term": "黑煙淨化器", "aliases": ("黑電淨化器", "黑暗淨化器")},
    {"term": "電池充電機", "aliases": ()},
    {"term": "機電工程公司", "aliases": ("今天公司",)},
)
PREVIOUS_TRANSCRIPT_CONTEXT_CHARS = 800


def _normalize_glossary_entry(item) -> dict | None:
    if isinstance(item, dict):
        term = str(item.get("term") or "").strip()
        return {**item, "term": term} if term else None

    line = str(item or "").strip()
    if not line:
        return None
    if "=" not in line:
        return {"term": line, "aliases": ()}

    term, aliases_text = line.split("=", 1)
    term = term.strip()
    aliases = tuple(
        dict.fromkeys(alias.strip() for alias in aliases_text.split("|") if alias.strip())
    )
    if not term or not aliases:
        return {"term": line, "aliases": ()}

    return {"term": term, "aliases": aliases, "accepted": True}


def resolve_transcription_context(workflow_context: dict | None) -> dict:
    context = dict(workflow_context or {})
    template_id = str(context.get("template_id") or "general")
    supplied_glossary = context.get("glossary")

    glossary = list(SALES_GLOSSARY) if template_id == "sales" else []
    if supplied_glossary is not None:
        glossary.extend(supplied_glossary)

    normalized_glossary = [
        entry
        for item in glossary
        if (entry := _normalize_glossary_entry(item)) is not None
    ]

    return {**context, "template_id": template_id, "glossary": normalized_glossary}


def build_transcription_prompt(base_prompt: str, workflow_context: dict | None) -> str:
    context = resolve_transcription_context(workflow_context)
    glossary_terms = [str(item.get("term") or "").strip() for item in context["glossary"]]
    glossary_terms = [term for term in glossary_terms if term]
    parts = [base_prompt.strip(), PRESERVE_SPOKEN_LANGUAGE_PROMPT]

    if glossary_terms:
        parts.append(f"可能出現的工作詞彙：{'、'.join(glossary_terms)}。")

    previous_transcript = str(context.get("previous_transcript") or "").strip()
    if previous_transcript:
        parts.append(
            "前一音訊片段的逐字稿尾端如下，僅供語境連續性參考，不得重複輸出：\n"
            f"{previous_transcript[-PREVIOUS_TRANSCRIPT_CONTEXT_CHARS:]}"
        )

    return "\n".join(part for part in parts if part)
