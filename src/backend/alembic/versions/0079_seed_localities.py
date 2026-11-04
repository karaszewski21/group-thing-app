"""seed localities

Data only. Seeds `localities` and `locality_postal_codes` from the gzipped
CSV fixtures in `alembic/data/` (provenance and rebuild command in
`localities_pl.README.md`).

Upgrade validates both fixtures before inserting anything: the exact header,
7-digit unique locality ids, a known `kind`, non-empty names, `NN-NNN`
postal codes, unique pairs, and that every pair's `locality_id` exists.
A violation raises with the fixture line. Rows are inserted in 10k-row
chunks, one `INSERT ... SELECT FROM unnest(...)` per chunk with bound
arrays. The counts and elapsed time are logged.

Downgrade empties both tables (nothing references them yet at this
revision).

Revision ID: 0079
Revises: 0078
Create Date: 2026-11-03
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
revision: str = "0079"
down_revision: str | None = "0078"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

DATA_DIR = Path(__file__).resolve().parents[1] / "data"
LOCALITIES_FILE = "localities_pl.csv.gz"
POSTAL_CODES_FILE = "locality_postal_codes_pl.csv.gz"
LOCALITY_COLUMNS = ("id", "name", "name_search", "kind", "gmina", "powiat", "voivodeship")
POSTAL_COLUMNS = ("postal_code", "locality_id")
CHUNK_SIZE = 10_000

_KINDS = {"TOWN", "VILLAGE"}
_LOCALITY_ID = re.compile(r"\d{7}")
_POSTAL_CODE = re.compile(r"\d{2}-\d{3}")

log = logging.getLogger("alembic.runtime.migration")


def _insert(table: str, columns: Sequence[str]) -> sa.TextClause:
    names = ", ".join(columns)
    arrays = ", ".join(f"CAST(:{column} AS text[])" for column in columns)
    return sa.text(f"INSERT INTO {table} ({names}) SELECT * FROM unnest({arrays})")


def _read(name: str, header: Sequence[str]) -> list[list[str]]:
    with gzip.open(DATA_DIR / name, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        if next(reader, None) != list(header):
            raise ValueError(f"{name}: header must be {','.join(header)}")
        rows = list(reader)
    for line, row in enumerate(rows, start=2):
        if len(row) != len(header):
            raise ValueError(f"{name}:{line}: expected {len(header)} fields, got {len(row)}")
    return rows


def _load_localities() -> list[list[str]]:
    rows = _read(LOCALITIES_FILE, LOCALITY_COLUMNS)
    seen: set[str] = set()
    for line, (locality_id, name, name_search, kind, *units) in enumerate(rows, start=2):
        where = f"{LOCALITIES_FILE}:{line}"
        if not _LOCALITY_ID.fullmatch(locality_id):
            raise ValueError(f"{where}: id {locality_id!r} is not 7 digits")
        if locality_id in seen:
            raise ValueError(f"{where}: duplicate id {locality_id}")
        if kind not in _KINDS:
            raise ValueError(f"{where}: unknown kind {kind!r}")
        if not all([name, name_search, *units]):
            raise ValueError(f"{where}: empty name field")
        seen.add(locality_id)
    return rows


def _load_postal_codes(locality_ids: set[str]) -> list[list[str]]:
    rows = _read(POSTAL_CODES_FILE, POSTAL_COLUMNS)
    seen: set[tuple[str, str]] = set()
    for line, (postal_code, locality_id) in enumerate(rows, start=2):
        where = f"{POSTAL_CODES_FILE}:{line}"
        if not _POSTAL_CODE.fullmatch(postal_code):
            raise ValueError(f"{where}: postal code {postal_code!r} is not NN-NNN")
        if locality_id not in locality_ids:
            raise ValueError(f"{where}: unknown locality_id {locality_id!r}")
        if (postal_code, locality_id) in seen:
            raise ValueError(f"{where}: duplicate pair")
        seen.add((postal_code, locality_id))
    return rows


def _insert_chunks(
    conn: sa.Connection, table: str, columns: Sequence[str], rows: list[list[str]]
) -> None:
    statement = _insert(table, columns)
    for start in range(0, len(rows), CHUNK_SIZE):
        chunk = rows[start : start + CHUNK_SIZE]
        arrays = zip(*chunk, strict=True)
        conn.execute(statement, dict(zip(columns, map(list, arrays), strict=True)))


def upgrade() -> None:
    started = time.perf_counter()
    localities = _load_localities()
    postal_codes = _load_postal_codes({row[0] for row in localities})

    conn = op.get_bind()
    _insert_chunks(conn, "localities", LOCALITY_COLUMNS, localities)
    _insert_chunks(conn, "locality_postal_codes", POSTAL_COLUMNS, postal_codes)
    log.info(
        "0079 seeded %d localities and %d postal codes in %.2fs",
        len(localities),
        len(postal_codes),
        time.perf_counter() - started,
    )


def downgrade() -> None:
    op.execute("TRUNCATE locality_postal_codes, localities")
