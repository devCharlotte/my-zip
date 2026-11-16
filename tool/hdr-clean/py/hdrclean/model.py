from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from . import exif as exif_mod
from . import providers, xmp

CATEGORIES = {
    "c2pa": "C2PA Content Credentials (manifest store)",
    "software-tags": "EXIF Software / ProcessingSoftware, PNG Software text",
    "xmp-tool": "XMP CreatorTool and History softwareAgent",
    "xmp-provenance-ref": "XMP dcterms:provenance (remote C2PA manifest link)",
    "text-mention": "Free-text field that mentions a provider (description, comment, artist)",
}
REPORT_ONLY = {
    "generative-declaration": "IPTC DigitalSourceType declares generated content; reported, never edited",
    "mention": "Provider text outside identification fields; reported, not editable",
}
DEFAULT_CATEGORIES = ("c2pa",)
NOT_INSPECTED = "[not inspected] "


@dataclass
class Item:
    id: str
    category: str
    label: str
    location: str
    value: str | None = None
    evidence: list[dict] = field(default_factory=list)
    removable: bool = True
    note: str | None = None
    ref: Any = None

    @property
    def providers(self) -> list[str]:
        return sorted({e["provider"] for e in self.evidence})

    def to_dict(self) -> dict:
        return {"id": self.id, "category": self.category, "label": self.label,
                "location": self.location, "value": self.value, "providers": self.providers,
                "evidence": self.evidence, "removable": self.removable, "note": self.note}


def evidence_for(value: str, kind: str, where: str) -> list[dict]:
    return [{"provider": m.provider, "kind": kind, "field": where, "value": value[:200],
             "term": m.term, "ambiguous": m.ambiguous, "strength": providers.EVIDENCE_STRENGTH[kind]}
            for m in providers.match(value, kind)]


_EXIF_TEXT_FIELDS = {0x010E: "ImageDescription", 0x013B: "Artist", 0x9286: "UserComment",
                     0x8298: "Copyright"}


def scan_exif(tiff: exif_mod.Tiff, location: str, prefix: str) -> tuple[list[Item], list[str]]:
    items: list[Item] = []
    notes: list[str] = []
    for f in tiff.fields:
        if f.tag in exif_mod.SOFTWARE_TAGS and f.type == 2:
            value = tiff.ascii(f)
            if not value:
                continue
            items.append(Item(f"{prefix}:{f.name}:{f.ifd}", "software-tags", f"EXIF {f.name}",
                              f"{location} / {f.ifd}", value,
                              evidence_for(value, "exif_software", f"EXIF {f.name}"), ref=f))
        elif f.tag in _EXIF_TEXT_FIELDS and f.type in (2, 7):
            value = tiff.text(f)
            ev = evidence_for(value, "text_mention", f"EXIF {f.name}")
            if ev:
                items.append(Item(f"{prefix}:{f.name}:{f.ifd}", "text-mention", f"EXIF {f.name}",
                                  f"{location} / {f.ifd}", value[:200], ev, ref=f))
        elif f.tag == 0x927C:
            notes.append(f"{NOT_INSPECTED}{location}: EXIF MakerNote ({f.byte_len} bytes) is vendor-private and not analyzed")
    return items, notes


_XMP_TOOL_FIELDS = ((xmp.NS_XMP, "CreatorTool", "xmp_creator_tool"),
                    (xmp.NS_STEVT, "softwareAgent", "xmp_history_agent"))


def scan_xmp(text: str, location: str, prefix: str, *, editable: bool = True) -> tuple[list[Item], list[str]]:
    items: list[Item] = []
    notes: list[str] = []
    parseable = xmp.is_parseable(text)
    if not parseable:
        notes.append(f"{location}: XMP is not well-formed XML; fields reported but not editable")
    can_edit = editable and parseable
    known: list[tuple[int, int]] = []
    for ns, local, kind in _XMP_TOOL_FIELDS:
        for i, f in enumerate(xmp.find_fields(text, ns, local)):
            known.append(f.span)
            items.append(Item(f"{prefix}:{local}:{i}", "xmp-tool", f"XMP {f.qname}", location, f.value,
                              evidence_for(f.value, kind, f"XMP {f.qname}"), removable=can_edit, ref=f))
    for i, f in enumerate(xmp.find_fields(text, xmp.NS_DCTERMS, "provenance")):
        known.append(f.span)
        items.append(Item(f"{prefix}:provenance:{i}", "xmp-provenance-ref", f"XMP {f.qname}", location,
                          f.value, [], removable=can_edit,
                          note="Link to a C2PA manifest; removing it breaks remote provenance lookup",
                          ref=f))
    for i, f in enumerate(xmp.find_fields(text, xmp.NS_IPTC_EXT, "DigitalSourceType")):
        known.append(f.span)
        items.append(Item(f"{prefix}:DigitalSourceType:{i}", "generative-declaration",
                          f"XMP {f.qname}", location, f.value, [], removable=False,
                          note=REPORT_ONLY["generative-declaration"], ref=f))
    rest = list(text)
    for a, b in known:
        rest[a:b] = [" "] * (b - a)
    remainder = "".join(rest)
    for m in providers.match(remainder, "text_mention"):
        pos = re.search(re.escape(m.term), remainder, re.I)
        excerpt = remainder[max(0, pos.start() - 40):pos.end() + 40] if pos else m.term
        items.append(Item(f"{prefix}:mention:{m.provider}", "mention", "XMP text", location,
                          " ".join(excerpt.split()),
                          [{"provider": m.provider, "kind": "text_mention", "field": "XMP",
                            "value": m.term, "term": m.term, "ambiguous": False, "strength": "weak"}],
                          removable=False, note=REPORT_ONLY["mention"]))
    return items, notes


def select(items: list[Item], categories: tuple[str, ...] | list[str], scope: str,
           ids: list[str] | None = None) -> list[Item]:
    if scope not in ("provider", "any"):
        raise ValueError("scope must be 'provider' or 'any'")
    unknown = set(categories) - set(CATEGORIES)
    if unknown:
        raise ValueError(f"Unknown categories: {sorted(unknown)}")
    chosen = []
    for it in items:
        if not it.removable:
            continue
        if ids is not None:
            if it.id in ids:
                chosen.append(it)
            continue
        if it.category in categories and (scope == "any" or it.evidence):
            chosen.append(it)
    return chosen
