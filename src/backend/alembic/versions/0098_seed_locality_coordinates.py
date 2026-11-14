"""seed locality coordinates

Data only. Fills `localities.lat`/`lng` from the gzipped CSV fixture
`locality_coordinates_pl.csv.gz` in `alembic/data/` (provenance and rebuild
command in `localities_pl.README.md`).

Upgrade validates the fixture before updating anything: the exact header,
7-digit unique locality ids, and decimal coordinates with six places inside
Poland's bounding box. A violation raises with the fixture line. Rows are
applied in 10k-row chunks, one `UPDATE ... FROM unnest(...)` per chunk with
bound arrays; an id missing from `localities` raises, so nothing is applied.
The count and elapsed time are logged.

Downgrade clears both columns.

Revision ID: 0098
Revises: 0097
Create Date: 2026-11-14
"""

from __future__ import annotations

import csv
import gzip
import logging
import re
import time
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0098"
down_revision: str | None = "0097"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
COORDINATES_FILE = "locality_coordinates_pl.csv.gz"
COLUMNS = ("locality_id", "lat", "lng")
CHUNK_SIZE = 10_000
LAT_BOUNDS = (48.9, 55.0)
LNG_BOUNDS = (14.0, 24.2)

_LOCALITY_ID = re.compile(r"\d{7}")
_DEGREES = re.compile(r"\d{2}\.\d{6}")

_UPDATE = sa.text(
    "UPDATE localities AS l "
    "SET lat = CAST(c.lat AS numeric(9, 6)), lng = CAST(c.lng AS numeric(9, 6)) "
    "FROM unnest(CAST(:locality_id AS text[]), CAST(:lat AS text[]), CAST(:lng AS text[])) "
    "AS c(locality_id, lat, lng) "
    "WHERE l.id = c.locality_id"
)

log = logging.getLogger("alembic.runtime.migration")


def _in_bounds(value: str, bounds: tuple[float, float]) -> bool:
    return _DEGREES.fullmatch(value) is not None and bounds[0] <= float(value) <= bounds[1]


def _load_coordinates() -> list[list[str]]:
    with gzip.open(DATA_DIR / COORDINATES_FILE, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        if next(reader, None) != list(COLUMNS):
            raise ValueError(f"{COORDINATES_FILE}: header must be {','.join(COLUMNS)}")
        rows = list(reader)
    seen: set[str] = set()
    for line, row in enumerate(rows, start=2):
        where = f"{COORDINATES_FILE}:{line}"
        if len(row) != len(COLUMNS):
            raise ValueError(f"{where}: expected {len(COLUMNS)} fields, got {len(row)}")
        locality_id, lat, lng = row
        if not _LOCALITY_ID.fullmatch(locality_id):
            raise ValueError(f"{where}: locality_id {locality_id!r} is not 7 digits")
        if locality_id in seen:
            raise ValueError(f"{where}: duplicate locality_id {locality_id}")
        if not _in_bounds(lat, LAT_BOUNDS) or not _in_bounds(lng, LNG_BOUNDS):
            raise ValueError(f"{where}: coordinates {lat!r}, {lng!r} are not a point in Poland")
        seen.add(locality_id)
    return rows


def upgrade() -> None:
    started = time.perf_counter()
    rows = _load_coordinates()

    conn = op.get_bind()
    updated = 0
    for start in range(0, len(rows), CHUNK_SIZE):
        arrays = zip(*rows[start : start + CHUNK_SIZE], strict=True)
        result = conn.execute(_UPDATE, dict(zip(COLUMNS, map(list, arrays), strict=True)))
        updated += result.rowcount
    if updated != len(rows):
        raise ValueError(
            f"{COORDINATES_FILE}: {len(rows) - updated} locality ids are not in localities"
        )
    log.info(
        "0098 set coordinates of %d localities in %.2fs", updated, time.perf_counter() - started
    )


def downgrade() -> None:
    op.execute("UPDATE localities SET lat = NULL, lng = NULL")
