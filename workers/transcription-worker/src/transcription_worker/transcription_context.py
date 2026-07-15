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


def resolve_transcription_context(workflow_context: dict | None) -> dict:
    context = dict(workflow_context or {})
    template_id = str(context.get("template_id") or "general")
    supplied_glossary = context.get("glossary")

    if supplied_glossary is not None:
        glossary = supplied_glossary
    elif template_id == "sales":
        glossary = list(SALES_GLOSSARY)
    else:
        glossary = []

    return {**context, "template_id": template_id, "glossary": glossary}


def build_transcription_prompt(base_prompt: str, workflow_context: dict | None) -> str:
    context = resolve_transcription_context(workflow_context)
    glossary_terms = [
        item if isinstance(item, str) else str(item.get("term") or "").strip()
        for item in context["glossary"]
    ]
    glossary_terms = [term for term in glossary_terms if term]
    parts = [base_prompt.strip(), PRESERVE_SPOKEN_LANGUAGE_PROMPT]

    if glossary_terms:
        parts.append(f"可能出現的工作詞彙：{'、'.join(glossary_terms)}。")

    return "\n".join(part for part in parts if part)
