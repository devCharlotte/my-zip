from __future__ import annotations

import hashlib
import io
import json
import zipfile

from hdrclean import __version__, batch, engine

DEFAULT_CATEGORIES = ["c2pa", "software-tags", "xmp-tool", "xmp-provenance-ref"]

_allocator = batch.NameAllocator()


def version() -> str:
    return __version__


def reset() -> None:
    global _allocator
    _allocator = batch.NameAllocator()


def reserve(input_names_json: str) -> None:
    _allocator.used.update(n.lower() for n in json.loads(input_names_json))


def process(buf, name: str, options_json: str):
    raw = bytes(buf.to_py()) if hasattr(buf, "to_py") else bytes(buf)
    opts = {"categories": DEFAULT_CATEGORIES, "scope": "provider", **json.loads(options_json)}
    opts["verify_signature"] = False
    options = engine.ProcessOptions.from_dict(opts)
    try:
        r = batch.process_one(name, raw, options, _allocator)
    except Exception as exc:
        r = batch.FileResult(name, hashlib.sha256(raw).hexdigest(), "failed",
                             error={"code": "internal", "message": f"{type(exc).__name__}: {exc}"})
    return r.output, json.dumps(r.to_dict(), ensure_ascii=False, default=str)


def make_zip(names_json: str, *buffers) -> bytes:
    names = json.loads(names_json)
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_STORED) as z:
        manifest = []
        for entry, buf in zip(names, buffers):
            data = bytes(buf.to_py()) if hasattr(buf, "to_py") else bytes(buf)
            z.writestr(entry["output_name"], data)
            manifest.append({**entry, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
        z.writestr("manifest.json", json.dumps({"tool": {"name": "hdr-clean", "version": __version__,
                                                         "runtime": "browser (Pyodide)"},
                                                "files": manifest}, ensure_ascii=False, indent=2))
    return mem.getvalue()
