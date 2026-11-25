"""Locality dictionary: `fold_polish` (also imported by
`scripts/build_localities.py` to precompute `localities.name_search`, so it
uses the standard library only) and the `GET /api/localities` search."""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Float, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Locality, LocalityKind, LocalityPostalCode

# NFKD leaves "ł" whole: it is a separate letter, not "l" plus a combining mark.
_STROKE_LETTERS = str.maketrans({"ł": "l", "Ł": "l"})
_POSTAL_PREFIX = re.compile(r"^\d{2}(-?\d{0,3})?$")
MIN_QUERY_LENGTH = 2


def fold_polish(text: str) -> str:
    """Case- and diacritic-insensitive search form: "Łódź " -> "lodz"."""
    decomposed = unicodedata.normalize("NFKD", text.translate(_STROKE_LETTERS))
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(stripped.lower().split())


@dataclass(frozen=True)
class LocalityMatch:
    locality: Locality
    postal_code: str | None


def _postal_prefix(query: str) -> str | None:
    """A postal query in the stored `NN-…` form ("32650" -> "32-650"), or
    `None` for a name query."""
    if not _POSTAL_PREFIX.match(query):
        return None
    digits = query.replace("-", "")
    return digits if len(digits) == 2 else f"{digits[:2]}-{digits[2:]}"


def _ordering(exact: Any) -> list[Any]:
    """Towns first, then exact matches, then a stable alphabetical order."""
    return [
        case((Locality.kind == LocalityKind.TOWN, 0), else_=1),
        case((exact, 0), else_=1),
        Locality.name,
        Locality.voivodeship,
        Locality.powiat,
        Locality.gmina,
        Locality.id,
    ]


async def list_major_towns(db: AsyncSession) -> list[Locality]:
    """The cities with county rights (their powiat carries their own name),
    66 in the 2026 register: the larger towns of each voivodeship."""
    rows = await db.scalars(
        select(Locality)
        .where(Locality.kind == LocalityKind.TOWN, Locality.powiat == Locality.name)
        .order_by(Locality.voivodeship, Locality.name, Locality.id)
    )
    return list(rows)


async def search_localities(
    db: AsyncSession, query: str, limit: int
) -> tuple[list[LocalityMatch], int]:
    """Localities matching a name prefix (diacritic-folded, `%`/`_`/`\\`
    escaped) or a postal-code prefix, at most `limit`, plus the full match
    count. Two statements, whatever the result size; none for a query (or
    folded name) shorter than `MIN_QUERY_LENGTH`."""
    query = query.strip()
    if len(query) < MIN_QUERY_LENGTH:
        return [], 0

    prefix = _postal_prefix(query)
    if prefix is not None:
        code_match = LocalityPostalCode.postal_code.startswith(prefix)
        codes = (
            select(
                LocalityPostalCode.locality_id,
                func.min(LocalityPostalCode.postal_code).label("postal_code"),
            )
            .where(code_match)
            .group_by(LocalityPostalCode.locality_id)
            .subquery()
        )
        rows = await db.execute(
            select(Locality, codes.c.postal_code)
            .join(codes, codes.c.locality_id == Locality.id)
            .order_by(*_ordering(codes.c.postal_code == prefix))
            .limit(limit)
        )
        total = await db.scalar(
            select(func.count(func.distinct(LocalityPostalCode.locality_id))).where(code_match)
        )
        return [LocalityMatch(locality, code) for locality, code in rows.tuples()], total or 0

    folded = fold_polish(query)
    if len(folded) < MIN_QUERY_LENGTH:
        return [], 0
    name_match = Locality.name_search.startswith(folded, autoescape=True)
    localities = await db.scalars(
        select(Locality)
        .where(name_match)
        .order_by(*_ordering(Locality.name_search == folded))
        .limit(limit)
    )
    total = await db.scalar(select(func.count()).select_from(Locality).where(name_match))
    return [LocalityMatch(locality, None) for locality in localities], total or 0


# About 55 km of latitude; a point further from every locality is outside
# the dictionary's country.
NEAREST_BOX_DEGREES = 0.5


async def find_nearest_locality(db: AsyncSession, lat: float, lng: float) -> Locality | None:
    """The locality whose point is closest to (`lat`, `lng`), or `None` when
    none lies within `NEAREST_BOX_DEGREES`. One statement: the box keeps the
    scan small and the equirectangular distance orders it (exact enough at
    this range)."""
    lng_scale = math.cos(math.radians(lat))
    point_lat = cast(Locality.lat, Float)
    point_lng = cast(Locality.lng, Float)
    distance = func.pow(point_lat - lat, 2) + func.pow((point_lng - lng) * lng_scale, 2)
    localities = await db.scalars(
        select(Locality)
        .where(
            Locality.lat.between(lat - NEAREST_BOX_DEGREES, lat + NEAREST_BOX_DEGREES),
            Locality.lng.between(lng - NEAREST_BOX_DEGREES, lng + NEAREST_BOX_DEGREES),
        )
        .order_by(distance, Locality.id)
        .limit(1)
    )
    return localities.first()
