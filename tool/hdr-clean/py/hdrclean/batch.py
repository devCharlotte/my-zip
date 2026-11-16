from __future__ import annotations

import hashlib
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import __version__, engine
from .errors import ProvenanceError

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_stem(name: str) -> str:
    stem = Path(name).stem or "image"
    stem = _SAFE.sub("_", stem).strip("._") or "image"
    return stem[:80]


class NameAllocator:
    def __init__(self, reserved: set[str] | None = None) -> None:
        self.used = {n.lower() for n in (reserved or set())}

    def allocate(self, name: str, ext: str, suffix: str = "-processed") -> str:
        base = f"{safe_stem(name)}{suffix}"
        candidate = base + ext
        n = 2
        while candidate.lower() in self.used:
            candidate = f"{base}-{n}{ext}"
            n += 1
        self.used.add(candidate.lower())
        return candidate


@dataclass
class FileResult:
    name: str
    sha256: str
    status: str
    output_name: str | None = None
    output: bytes | None = None
    report: dict = field(default_factory=dict)
    error: dict | None = None
    duplicate_of: str | None = None

    def to_dict(self) -> dict:
        return {"name": self.name, "sha256": self.sha256, "status": self.status,
                "output_name": self.output_name, "duplicate_of": self.duplicate_of,
                "error": self.error, "report": self.report}


def process_one(name: str, data: bytes, options: engine.ProcessOptions,
                allocator: NameAllocator) -> FileResult:
    digest = hashlib.sha256(data).hexdigest()
    try:
        out, report = engine.process(data, options, name=name)
    except ProvenanceError as exc:
        return FileResult(name, digest, "failed", error=exc.to_dict())
    except ValueError as exc:
        return FileResult(name, digest, "failed", error={"code": "invalid_options", "message": str(exc)})
    if out is None:
        return FileResult(name, digest, report["status"], report=report)
    fmt = report["output"]["format"]
    return FileResult(name, digest, "success", allocator.allocate(name, engine.EXT[fmt]), out, report)


def summarize(results: list[FileResult]) -> dict:
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
    if counts.get("failed"):
        overall = "partial_failure" if counts.get("success") or counts.get("nothing_to_do") else "failed"
    elif counts.get("success"):
        overall = "success"
    else:
        overall = "nothing_to_do"
    return {"overall": overall, "counts": counts, "total": len(results)}


def run(inputs: list[tuple[str, bytes | Path]], options: engine.ProcessOptions | dict,
        per_file: dict | None = None) -> list[FileResult]:
    allocator = NameAllocator({n for n, _ in inputs})
    seen: dict[str, str] = {}
    results: list[FileResult] = []
    for name, src in inputs:
        try:
            data = src.read_bytes() if isinstance(src, Path) else src
        except OSError as exc:
            results.append(FileResult(name, "", "failed", error={"code": "io", "message": str(exc)}))
            continue
        digest = hashlib.sha256(data).hexdigest()
        if digest in seen:
            results.append(FileResult(name, digest, "duplicate", duplicate_of=seen[digest]))
            continue
        seen[digest] = name
        try:
            opts = _options_for(name, options, per_file)
        except (ValueError, KeyError, TypeError) as exc:
            results.append(FileResult(name, digest, "failed",
                                      error={"code": "invalid_options", "message": str(exc)}))
            continue
        results.append(process_one(name, data, opts, allocator))
    return results


def _options_for(name: str, options: engine.ProcessOptions | dict,
                 per_file: dict | None) -> engine.ProcessOptions:
    override = (per_file or {}).get(name)
    if isinstance(options, engine.ProcessOptions):
        if override:
            raise ValueError("per-file overrides need dict options")
        return options
    return engine.ProcessOptions.from_dict({**options, **(override or {})})


def manifest(results: list[FileResult]) -> dict:
    return {"tool": {"name": "hdr-clean", "version": __version__},
            "summary": summarize(results), "files": [r.to_dict() for r in results]}


def write_zip(results: list[FileResult], target) -> None:
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as zf:
        for r in results:
            if r.output is not None and r.output_name:
                zf.writestr(r.output_name, r.output)
        zf.writestr("manifest.json", json.dumps(manifest(results), indent=2, ensure_ascii=False),
                    compress_type=zipfile.ZIP_DEFLATED)


def write_dir(results: list[FileResult], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for r in results:
        if r.output is None or not r.output_name:
            continue
        path = out_dir / r.output_name
        n = 2
        while path.exists():
            path = out_dir / f"{Path(r.output_name).stem}-{n}{Path(r.output_name).suffix}"
            n += 1
        write_exclusive(path, r.output)
        r.output_name = path.name
        written.append(path)
    mpath = out_dir / "manifest.json"
    n = 2
    while mpath.exists():
        mpath = out_dir / f"manifest-{n}.json"
        n += 1
    write_exclusive(mpath, json.dumps(manifest(results), indent=2, ensure_ascii=False).encode())
    written.append(mpath)
    return written


def write_exclusive(path: Path, data: bytes) -> None:
    created = False
    try:
        with path.open("xb") as fh:
            created = True
            fh.write(data)
            fh.flush()
        if path.read_bytes() != data:
            raise OSError(f"Read-back of {path} differs from the validated output")
    except BaseException:
        if created:
            path.unlink(missing_ok=True)
        raise
