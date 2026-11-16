from __future__ import annotations

import re
from dataclasses import dataclass

PROVIDERS = {
    "anthropic": "Anthropic / Claude",
    "openai": "OpenAI / ChatGPT",
    "google": "Google / Gemini",
}

_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    "anthropic": [re.compile(p, re.I) for p in (r"\banthropic\b", r"\bclaude\b")],
    "openai": [re.compile(p, re.I) for p in (
        r"\bopen\s?ai\b", r"\bchat\s?gpt\b", r"\bdall[\s·-]?e\b", r"\bgpt-?image\b",
        r"\bgpt-?[0-9][\w.]*\b", r"\bsora\b")],
    "google": [re.compile(p, re.I) for p in (
        r"\bgemini\b", r"\bimagen\b", r"\bdeepmind\b", r"\bsynthid\b", r"\bnano[\s-]?banana\b",
        r"\bgoogle\s+ai\b", r"\bai\s+studio\b", r"\bgoogle\s+generative\s+ai\b")],
}
_GOOGLE_GENERIC = re.compile(r"\bgoogle\b", re.I)

EVIDENCE_STRENGTH = {
    "c2pa_signer": "strong",
    "c2pa_claim_generator": "strong",
    "c2pa_action_agent": "strong",
    "exif_software": "self_declared",
    "xmp_creator_tool": "self_declared",
    "xmp_history_agent": "self_declared",
    "png_text": "self_declared",
    "text_mention": "weak",
}


@dataclass(frozen=True)
class Match:
    provider: str
    term: str
    ambiguous: bool = False


def match(value: str, kind: str) -> list[Match]:
    if not value:
        return []
    out: list[Match] = []
    for provider, patterns in _PATTERNS.items():
        for pat in patterns:
            m = pat.search(value)
            if m:
                out.append(Match(provider, m.group(0)))
                break
    if not any(m.provider == "google" for m in out) and kind in (
            "c2pa_signer", "c2pa_claim_generator", "c2pa_action_agent"):
        g = _GOOGLE_GENERIC.search(value)
        if g:
            out.append(Match("google", g.group(0), ambiguous=True))
    return out


def scan_text(blob: bytes) -> list[Match]:
    text = blob.decode("latin-1")
    return match(text, "text_mention")
