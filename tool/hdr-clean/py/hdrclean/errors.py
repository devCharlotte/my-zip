from __future__ import annotations

MAX_FILE_BYTES = 512 * 1024 * 1024
MAX_SEGMENTS = 20_000
MAX_BOX_DEPTH = 32
MAX_CBOR_DEPTH = 64
MAX_CBOR_ITEMS = 1_000_000
MAX_IFD_ENTRIES = 4096
MAX_PIXELS = 300_000_000


class ProvenanceError(Exception):
    code = "error"

    def __init__(self, message: str, *, detail: dict | None = None) -> None:
        super().__init__(message)
        self.detail = detail or {}

    def to_dict(self) -> dict:
        return {"code": self.code, "message": str(self), **({"detail": self.detail} if self.detail else {})}


class FormatError(ProvenanceError):
    code = "malformed"


class UnsupportedError(ProvenanceError):
    code = "unsupported"


class UnsafeOperationError(ProvenanceError):
    code = "refused"


class LimitError(ProvenanceError):
    code = "limit"


class ValidationError(ProvenanceError):
    code = "validation_failed"


def check_size(raw: bytes, limit: int = MAX_FILE_BYTES) -> None:
    if len(raw) > limit:
        raise LimitError(f"File is {len(raw)} bytes; limit is {limit} bytes")
