from __future__ import annotations

import json
from typing import Any

from . import cbor, jumbf, providers
from .errors import FormatError, LimitError

GENERATIVE_SOURCE_TYPES = ("trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia",
                           "algorithmicMedia", "compositeSynthetic")
_OIDS = {b"\x55\x04\x03": "CN", b"\x55\x04\x0a": "O", b"\x55\x04\x0b": "OU", b"\x55\x04\x06": "C"}


def _der(data: bytes, pos: int) -> tuple[int, int, int]:
    if pos + 2 > len(data):
        raise FormatError("Truncated DER")
    tag = data[pos]
    length = data[pos + 1]
    pos += 2
    if length & 0x80:
        n = length & 0x7F
        if n == 0 or n > 4 or pos + n > len(data):
            raise FormatError("Invalid DER length")
        length = int.from_bytes(data[pos:pos + n], "big")
        pos += n
    if pos + length > len(data):
        raise FormatError("DER value exceeds input")
    return tag, pos, pos + length


def _children(data: bytes, start: int, end: int):
    pos = start
    count = 0
    while pos < end:
        tag, a, b = _der(data, pos)
        yield tag, a, b
        pos = b
        count += 1
        if count > 4096:
            raise LimitError("Too many DER elements")


def certificate_subject(der: bytes) -> dict[str, str]:
    _, a, b = _der(der, 0)
    _, ta, tb = _der(der, a)
    elems = list(_children(der, ta, tb))
    if elems and elems[0][0] == 0xA0:
        elems = elems[1:]
    if len(elems) < 5:
        raise FormatError("Unexpected certificate layout")
    _, sa, sb = elems[4]
    subject: dict[str, str] = {}
    for _, rdn_a, rdn_b in _children(der, sa, sb):
        for _, atv_a, atv_b in _children(der, rdn_a, rdn_b):
            parts = list(_children(der, atv_a, atv_b))
            if len(parts) == 2 and parts[0][0] == 0x06:
                oid = der[parts[0][1]:parts[0][2]]
                if oid in _OIDS:
                    subject[_OIDS[oid]] = der[parts[1][1]:parts[1][2]].decode("utf-8", "replace")
    return subject


def _content(box: jumbf.Box) -> Any:
    for c in box.content():
        if c.type == b"cbor":
            return cbor.loads(c.payload)
        if c.type == b"json":
            return json.loads(c.payload.decode("utf-8"))
    return None


def _s(value: Any) -> str | None:
    if isinstance(value, str):
        return value[:500]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _agent_name(agent: Any) -> str:
    if isinstance(agent, str):
        return agent
    if isinstance(agent, dict):
        return " ".join(_s(agent.get(k)) or "" for k in ("name", "version")).strip()
    return ""


def _signature(box: jumbf.Box) -> dict:
    out: dict = {}
    value = None
    for c in box.content():
        if c.type == b"cbor":
            value = cbor.loads(c.payload)
    if isinstance(value, cbor.Tagged) and value.tag == 18:
        value = value.value
    if not isinstance(value, list) or len(value) != 4:
        out["problem"] = "Signature is not a COSE_Sign1 structure"
        return out
    protected = cbor.loads(value[0]) if isinstance(value[0], bytes) and value[0] else {}
    unprotected = value[1] if isinstance(value[1], dict) else {}
    alg = protected.get(1) if isinstance(protected, dict) else None
    out["alg"] = {-7: "ES256", -35: "ES384", -36: "ES512", -37: "PS256", -38: "PS384",
                  -39: "PS512", -8: "Ed25519"}.get(alg, alg) if alg is not None else None
    chain = None
    for src in (protected, unprotected):
        if isinstance(src, dict):
            chain = src.get(33, src.get("x5chain", chain))
    if isinstance(chain, bytes):
        chain = [chain]
    if isinstance(chain, list) and chain and isinstance(chain[0], bytes):
        try:
            out["subject"] = certificate_subject(chain[0])
        except (FormatError, LimitError) as exc:
            out["problem"] = f"Certificate subject unreadable: {exc}"
        out["chain_length"] = len(chain)
    out["timestamped"] = isinstance(unprotected, dict) and any(
        k in unprotected for k in ("sigTst", "sigTst2", "rVals"))
    return out


def summarize_manifest(box: jumbf.Box) -> dict:
    m: dict = {"label": box.label, "kind": "update" if box.uuid == jumbf.C2PA_UPDATE_MANIFEST_UUID
               else "standard", "assertions": [], "actions": [], "ingredients": [],
               "authors": [], "problems": []}
    for child in box.children:
        try:
            if child.uuid == jumbf.C2PA_CLAIM_UUID:
                claim = cbor.untag(_content(child)) or {}
                if not isinstance(claim, dict):
                    raise FormatError("Claim is not a map")
                m["claim_label"] = child.label
                m["claim_generator"] = _s(claim.get("claim_generator"))
                info = claim.get("claim_generator_info")
                infos = info if isinstance(info, list) else [info] if isinstance(info, dict) else []
                m["claim_generator_info"] = [_agent_name(i) for i in infos if _agent_name(i)]
                m["title"] = _s(claim.get("dc:title", claim.get("title")))
                m["format"] = _s(claim.get("dc:format"))
                m["instance_id"] = _s(claim.get("instanceID"))
            elif child.uuid == jumbf.C2PA_SIGNATURE_UUID:
                m["signature"] = _signature(child)
            elif child.uuid == jumbf.C2PA_ASSERTIONS_UUID:
                for a in child.children:
                    if a.type != b"jumb":
                        continue
                    m["assertions"].append(a.label)
                    _assertion(a, m)
        except (FormatError, LimitError, ValueError, UnicodeDecodeError) as exc:
            m["problems"].append(f"{child.label or child.type!r}: {exc}")
        except (TypeError, AttributeError, KeyError, IndexError) as exc:
            m["problems"].append(f"{child.label or child.type!r}: unexpected structure ({type(exc).__name__})")
    return m


def _assertion(a: jumbf.Box, m: dict) -> None:
    label = a.label or ""
    base = label.split("__")[0]
    if base.startswith("c2pa.actions"):
        data = cbor.untag(_content(a)) or {}
        agents = data.get("softwareAgents") if isinstance(data, dict) else None
        acts = data.get("actions") if isinstance(data, dict) else None
        for act in acts if isinstance(acts, list) else []:
            if not isinstance(act, dict):
                continue
            agent = act.get("softwareAgent")
            if isinstance(agent, int) and isinstance(agents, list) and 0 <= agent < len(agents):
                agent = agents[agent]
            m["actions"].append({
                "action": _s(act.get("action")),
                "software_agent": _agent_name(agent),
                "digital_source_type": _s(act.get("digitalSourceType")),
                "description": _s(act.get("description")),
            })
    elif base.startswith("c2pa.ingredient"):
        data = cbor.untag(_content(a)) or {}
        if isinstance(data, dict):
            m["ingredients"].append({k: _s(data.get(k)) for k in ("title", "format", "relationship")
                                     if _s(data.get(k)) is not None})
    elif base in ("stds.schema-org.CreativeWork", "cawg.metadata"):
        data = _content(a) or {}
        authors = data.get("author") if isinstance(data, dict) else None
        for au in authors if isinstance(authors, list) else []:
            if isinstance(au, dict) and _s(au.get("name")):
                m["authors"].append(_s(au["name"]))


def summarize_store(data: bytes) -> dict:
    result: dict = {"parsed": False, "manifests": [], "problems": []}
    try:
        boxes = jumbf.parse(data)
    except (FormatError, LimitError) as exc:
        result["problems"].append(f"JUMBF parse failed: {exc}")
        return result
    stores = [b for b in boxes if b.uuid == jumbf.C2PA_STORE_UUID]
    if not stores:
        result["problems"].append("No C2PA manifest store superbox")
        return result
    for mbox in stores[0].children:
        if mbox.type == b"jumb":
            result["manifests"].append(summarize_manifest(mbox))
    result["parsed"] = True
    if result["manifests"]:
        result["active_manifest"] = result["manifests"][-1]["label"]
    return result


def evidence(summary: dict) -> list[dict]:
    found = []
    for man in summary.get("manifests", []):
        label = man.get("label")
        fields = []
        subj = (man.get("signature") or {}).get("subject") or {}
        for key in ("O", "CN", "OU"):
            if subj.get(key):
                fields.append(("c2pa_signer", f"signer {key}", subj[key]))
        if man.get("claim_generator"):
            fields.append(("c2pa_claim_generator", "claim_generator", str(man["claim_generator"])))
        for name in man.get("claim_generator_info") or []:
            fields.append(("c2pa_claim_generator", "claim_generator_info", name))
        for act in man.get("actions") or []:
            if act.get("software_agent"):
                fields.append(("c2pa_action_agent", f"action {act.get('action')} softwareAgent",
                               act["software_agent"]))
        for kind, where, value in fields:
            for mt in providers.match(value, kind):
                found.append({"provider": mt.provider, "kind": kind, "field": where, "value": value[:200],
                              "manifest": label, "ambiguous": mt.ambiguous,
                              "strength": providers.EVIDENCE_STRENGTH[kind]})
    return found


def generative_declarations(summary: dict) -> list[dict]:
    out = []
    for man in summary.get("manifests", []):
        for act in man.get("actions") or []:
            dst = act.get("digital_source_type") or ""
            if any(dst.endswith(t) for t in GENERATIVE_SOURCE_TYPES):
                out.append({"manifest": man.get("label"), "action": act.get("action"),
                            "digital_source_type": dst})
    return out


def validate_with_c2pa_library(data: bytes, mime: str) -> dict:
    try:
        import io

        import c2pa as sdk
    except Exception:
        return {"available": False, "note": "c2pa-python not installed; signature not verified"}
    try:
        reader = sdk.Reader(mime, io.BytesIO(data))
        report = json.loads(reader.json())
    except Exception as exc:
        return {"available": True, "state": "error", "message": str(exc)[:300]}
    statuses = report.get("validation_status") or []
    state = report.get("validation_state")
    if state is None:
        state = "Invalid" if statuses else "Valid"
    return {"available": True, "state": state,
            "statuses": [s.get("code") for s in statuses if isinstance(s, dict)][:20]}
