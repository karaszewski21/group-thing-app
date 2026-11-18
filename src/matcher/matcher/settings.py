"""Configuration: `DATABASE_URL` only, the same value the backend reads. The
URL carries the password, so it is never logged and kept out of `repr`."""

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

_DRIVER_SUFFIX = re.compile(r"^(postgres(?:ql)?)\+[A-Za-z0-9_]+://")


@dataclass(frozen=True)
class Settings:
    dsn: str = field(repr=False)


def to_asyncpg_dsn(url: str) -> str:
    """`postgresql+asyncpg://…` (SQLAlchemy form) → `postgresql://…`, which
    `asyncpg.connect` accepts."""
    return _DRIVER_SUFFIX.sub(r"\1://", url, count=1)


def load(environ: Mapping[str, str] = os.environ) -> Settings:
    url = environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return Settings(dsn=to_asyncpg_dsn(url))
