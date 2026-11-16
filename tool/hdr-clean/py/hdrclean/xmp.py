from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from .errors import UnsafeOperationError

NS_XMP = "http://ns.adobe.com/xap/1.0/"
NS_XMPMM = "http://ns.adobe.com/xap/1.0/mm/"
NS_STEVT = "http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
NS_IPTC_EXT = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
NS_DCTERMS = "http://purl.org/dc/terms/"
NS_TIFF = "http://ns.adobe.com/tiff/1.0/"
NS_EXIF = "http://ns.adobe.com/exif/1.0/"
NS_HDRGM = "http://ns.adobe.com/hdr-gain-map/1.0/"
NS_CONTAINER = "http://ns.google.com/photos/1.0/container/"
NS_ITEM = "http://ns.google.com/photos/1.0/container/item/"
NS_GCAMERA = "http://ns.google.com/photos/1.0/camera/"
NS_APDI = "http://ns.apple.com/pixeldatainfo/1.0/"
NS_APPLE_GAINMAP = "http://ns.apple.com/HDRGainMap/1.0/"
NS_XMPNOTE = "http://ns.adobe.com/xmp/note/"

PROTECTED_NAMESPACES = (NS_HDRGM, NS_CONTAINER, NS_ITEM, NS_GCAMERA, NS_APDI,
                        NS_APPLE_GAINMAP, NS_XMPNOTE)
APPLE_GAINMAP_AUX = "urn:com:apple:photo:2020:aux:hdrgainmap"

_XMLNS = re.compile(r'xmlns:([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|\'([^\']*)\')')


@dataclass(frozen=True)
class XmpField:
    namespace: str
    local: str
    qname: str
    value: str
    span: tuple[int, int]
    form: str


def decode_packet(data: bytes) -> str:
    text = data.decode("utf-8", "replace")
    return text.rstrip("\x00")


def prefixes(text: str) -> dict[str, list[str]]:
    result: dict[str, list[str]] = {}
    for m in _XMLNS.finditer(text):
        uri = m.group(3) if m.group(3) is not None else m.group(4)
        result.setdefault(uri, [])
        if m.group(1) not in result[uri]:
            result[uri].append(m.group(1))
    return result


def find_fields(text: str, namespace: str, local: str) -> list[XmpField]:
    out: list[XmpField] = []
    for prefix in prefixes(text).get(namespace, []):
        q = re.escape(f"{prefix}:{local}")
        for m in re.finditer(rf'(?<![\w:.-]){q}\s*=\s*("([^"]*)"|\'([^\']*)\')', text):
            raw = m.group(2) if m.group(2) is not None else m.group(3)
            out.append(XmpField(namespace, local, f"{prefix}:{local}", html.unescape(raw),
                                (m.start(), m.end()), "attribute"))
        for m in re.finditer(rf'<{q}(\s[^>]*)?>(.*?)</{q}\s*>', text, re.S):
            inner = re.sub(r"<[^>]+>", " ", m.group(2))
            out.append(XmpField(namespace, local, f"{prefix}:{local}",
                                html.unescape(" ".join(inner.split())), (m.start(), m.end()), "element"))
        for m in re.finditer(rf'<{q}(\s[^>]*)?/>', text):
            out.append(XmpField(namespace, local, f"{prefix}:{local}", "", (m.start(), m.end()), "element"))
    out.sort(key=lambda f: f.span)
    return out


def protected_spans(text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    pmap = prefixes(text)
    for ns in PROTECTED_NAMESPACES:
        for prefix in pmap.get(ns, []):
            p = re.escape(prefix)
            for m in re.finditer(rf'(?<![\w:.-]){p}:[\w.-]+\s*=\s*("[^"]*"|\'[^\']*\')', text):
                spans.append((m.start(), m.end()))
            for m in re.finditer(rf'<{p}:([\w.-]+)(\s[^>]*)?(/>|>.*?</{p}:\1\s*>)', text, re.S):
                spans.append((m.start(), m.end()))
    return spans


def is_parseable(text: str) -> bool:
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        return False
    try:
        ET.fromstring(text.strip().encode("utf-8"))
    except ET.ParseError:
        return False
    return True


def blank_spans(text: str, spans: list[tuple[int, int]]) -> str:
    if not spans:
        return text
    if not is_parseable(text):
        raise UnsafeOperationError("XMP packet is not well-formed XML; refusing to edit it")
    for a, b in spans:
        for pa, pb in protected_spans(text):
            if a < pb and pa < b:
                raise UnsafeOperationError("Requested XMP edit overlaps HDR/container metadata")
    chars = list(text)
    for a, b in spans:
        chars[a:b] = [" "] * (b - a)
    result = "".join(chars)
    if len(result.encode("utf-8")) != len(text.encode("utf-8")):
        raise UnsafeOperationError("XMP edit changed the packet length")
    if not is_parseable(result):
        raise UnsafeOperationError("XMP edit produced invalid XML; refusing")
    if protected_spans(result) != protected_spans(text):
        raise UnsafeOperationError("XMP edit would change HDR/container metadata")
    return result


def set_simple_value(text: str, namespace: str, local: str, value: str,
                     *, match_index: int | None = None) -> str:
    fields = find_fields(text, namespace, local)
    if match_index is not None:
        fields = [fields[match_index]] if match_index < len(fields) else []
    for f in sorted(fields, key=lambda f: f.span, reverse=True):
        a, b = f.span
        escaped = html.escape(value, quote=True)
        if f.form == "attribute":
            text = text[:a] + f'{f.qname}="{escaped}"' + text[b:]
        else:
            text = text[:a] + f"<{f.qname}>{escaped}</{f.qname}>" + text[b:]
    return text


@dataclass(frozen=True)
class ContainerItem:
    semantic: str
    mime: str
    length: int | None
    padding: int | None
    span: tuple[int, int]


def container_items(text: str) -> list[ContainerItem]:
    pmap = prefixes(text)
    items: list[ContainerItem] = []
    for cprefix in pmap.get(NS_CONTAINER, []):
        for m in re.finditer(rf'<{re.escape(cprefix)}:Item\b([^>]*?)/?>', text):
            attrs = dict(_attrs(m.group(1)))
            vals: dict[str, str] = {}
            for iprefix in pmap.get(NS_ITEM, []):
                for key in ("Semantic", "Mime", "Length", "Padding"):
                    if f"{iprefix}:{key}" in attrs:
                        vals[key] = attrs[f"{iprefix}:{key}"]
            items.append(ContainerItem(vals.get("Semantic", ""), vals.get("Mime", ""),
                                       _int_or_none(vals.get("Length")),
                                       _int_or_none(vals.get("Padding")), (m.start(), m.end())))
    items.sort(key=lambda i: i.span)
    return items


def set_container_length(text: str, index: int, length: int) -> str:
    items = container_items(text)
    item = items[index]
    a, b = item.span
    tag = text[a:b]
    iprefix = prefixes(text)[NS_ITEM][0]
    pat = re.compile(rf'({re.escape(iprefix)}:Length\s*=\s*)("[^"]*"|\'[^\']*\')')
    if not pat.search(tag):
        raise UnsafeOperationError("Container item has no Item:Length to update")
    new_tag = pat.sub(lambda m: f'{m.group(1)}"{length}"', tag, count=1)
    return text[:a] + new_tag + text[b:]


def _attrs(s: str):
    for m in re.finditer(r'([\w.:-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')', s):
        yield m.group(1), html.unescape(m.group(3) if m.group(3) is not None else m.group(4))


def _int_or_none(v: str | None) -> int | None:
    try:
        return int(v) if v is not None else None
    except ValueError:
        return None


def hdr_signals(text: str) -> dict:
    sig: dict = {}
    hv = find_fields(text, NS_HDRGM, "Version")
    if hv:
        sig["hdrgm_version"] = hv[0].value
    for local in ("GainMapMin", "GainMapMax", "Gamma", "OffsetSDR", "OffsetHDR",
                  "HDRCapacityMin", "HDRCapacityMax", "BaseRenditionIsHDR"):
        f = find_fields(text, NS_HDRGM, local)
        if f:
            sig.setdefault("hdrgm", {})[local] = f[0].value
    items = container_items(text)
    if items:
        sig["container"] = [{"semantic": i.semantic, "mime": i.mime, "length": i.length} for i in items]
    aux = find_fields(text, NS_APDI, "AuxiliaryImageType")
    if aux:
        sig["apple_aux_type"] = aux[0].value
    av = find_fields(text, NS_APPLE_GAINMAP, "HDRGainMapVersion")
    if av:
        sig["apple_gainmap_version"] = av[0].value
    return sig
