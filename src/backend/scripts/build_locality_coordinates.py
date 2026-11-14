"""Build the locality coordinates fixture seeded by migration `0098`.

Reads the GUGiK PRNG localities register (the attribute table
`PRNG_MIEJSCOWOSCI_SHP.dbf` of the SHP package) and the existing
`localities_pl.csv.gz`, and writes `locality_coordinates_pl.csv.gz`: the main
point of every dictionary locality PRNG knows by its SIMC id, as WGS 84
decimal degrees. Sources and rules are documented in
`alembic/data/localities_pl.README.md`.

Run from `src/backend`:
    uv run python scripts/build_locality_coordinates.py \
        --prng PRNG_MIEJSCOWOSCI_SHP.dbf --out alembic/data
"""

from __future__ import annotations

import argparse
import csv
import gzip
import re
from pathlib import Path

from build_localities import _dbf_records, _write

COORDINATES_HEADER = ["locality_id", "lat", "lng"]
PRNG_SYSTEM_FIELD = "systemZewn"
PRNG_SIMC_FIELD = "idZewnetrz"
PRNG_POINT_FIELD = "wspGeograf"
PRNG_SIMC_SYSTEM = "TERYT (SIMC)"
# `52°13'47" 21°00'42"`: latitude, then longitude, to the arc second. The
# degree sign is matched as "not a digit" because the reader decodes latin-1.
_POINT = re.compile(r"(\d{2})\D+(\d{2})'(\d{2})\"\s+(\d{2})\D+(\d{2})'(\d{2})\"")


def _degrees(degrees: str, minutes: str, seconds: str) -> str:
    return f"{int(degrees) + int(minutes) / 60 + int(seconds) / 3600:.6f}"


def _locality_ids(fixture: Path) -> set[str]:
    with gzip.open(fixture, "rt", encoding="utf-8", newline="") as f:
        return {row["id"] for row in csv.DictReader(f)}


def build_coordinates(prng: Path, locality_ids: set[str]) -> list[list[str]]:
    points: dict[str, tuple[str, str]] = {}
    fields = (PRNG_SYSTEM_FIELD, PRNG_SIMC_FIELD, PRNG_POINT_FIELD)
    for system, simc_id, raw_point in _dbf_records(prng, fields):
        if system != PRNG_SIMC_SYSTEM or simc_id not in locality_ids:
            continue
        match = _POINT.fullmatch(raw_point)
        if match is None:
            raise SystemExit(f"{prng}: SIMC {simc_id} has an unreadable point {raw_point!r}")
        point = (_degrees(*match.groups()[:3]), _degrees(*match.groups()[3:]))
        if points.setdefault(simc_id, point) != point:
            raise SystemExit(f"{prng}: SIMC {simc_id} has two different points")
    print(f"PRNG: {len(locality_ids) - len(points)} dictionary localities have no point")
    return [[simc_id, *point] for simc_id, point in sorted(points.items())]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--prng", type=Path, required=True, help="PRNG_MIEJSCOWOSCI_SHP.dbf")
    parser.add_argument("--out", type=Path, required=True, help="holds localities_pl.csv.gz")
    args = parser.parse_args()

    coordinates = build_coordinates(args.prng, _locality_ids(args.out / "localities_pl.csv.gz"))
    _write(args.out / "locality_coordinates_pl.csv.gz", COORDINATES_HEADER, coordinates)


if __name__ == "__main__":
    main()
