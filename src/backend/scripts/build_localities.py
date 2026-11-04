"""Build the locality dictionary fixtures seeded by migration `0079`.

Reads the GUS TERYT `SIMC` and `TERC` catalogues (the "urzędowy" CSV files)
and the GUGiK PRG address points (the attribute table
`PRG_PunktyAdresowe_POLSKA.dbf` of the national SHP package), and writes `localities_pl.csv.gz` and
`locality_postal_codes_pl.csv.gz`. Sources and filtering rules are documented
in `alembic/data/localities_pl.README.md`.

Run from `src/backend`:
    uv run python scripts/build_localities.py --simc SIMC.csv --terc TERC.csv \
        --prg PRG_PunktyAdresowe_POLSKA.dbf --out alembic/data
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import re
import struct
import sys
from collections.abc import Iterator
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.locations.localities import fold_polish  # noqa: E402

TOWN_RM = "96"
# Warsaw districts (95) and the delegations of Kraków, Łódź, Poznań and
# Wrocław (98) are independent in SIMC but are city parts: they fold into
# their city, like any other locality part.
CITY_PART_RMS = {"95", "98"}
LOCALITY_HEADER = ["id", "name", "name_search", "kind", "gmina", "powiat", "voivodeship"]
POSTAL_HEADER = ["postal_code", "locality_id"]
PRG_SIMC_FIELD = "ID_SIMC"
PRG_POSTAL_FIELD = "KOD_POCZT"
DBF_BLOCK_RECORDS = 10_000
_POSTAL = re.compile(r"(\d{2})-?(\d{3})")


def _read_teryt(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter=";"))


def _units(terc: list[dict[str, str]]) -> dict[tuple[str, ...], str]:
    """TERC names keyed by (WOJ,), (WOJ, POW) and (WOJ, POW, GMI, RODZ)."""
    units: dict[tuple[str, ...], str] = {}
    for row in terc:
        code = (row["WOJ"], row["POW"], row["GMI"], row["RODZ"])
        units[tuple(part for part in code if part)] = row["NAZWA"]
    return units


def _roots(simc: list[dict[str, str]]) -> dict[str, str]:
    """Every SIMC id mapped to the dictionary locality that contains it."""
    by_id = {row["SYM"]: row for row in simc}
    cities = {
        (row["WOJ"], row["POW"]): row["SYM"]
        for row in simc
        if row["RM"] == TOWN_RM and row["GMI"] == "01" and row["RODZ_GMI"] == "1"
    }
    roots: dict[str, str] = {}
    for row in simc:
        root = by_id[row["SYMPOD"]]
        while root["SYM"] != root["SYMPOD"]:
            root = by_id[root["SYMPOD"]]
        if root["RM"] in CITY_PART_RMS:
            root = by_id[cities[(root["WOJ"], root["POW"])]]
        roots[row["SYM"]] = root["SYM"]
    return roots


def build_localities(
    simc: list[dict[str, str]], units: dict[tuple[str, ...], str]
) -> list[list[str]]:
    rows = []
    for row in simc:
        if row["SYM"] != row["SYMPOD"] or row["RM"] in CITY_PART_RMS:
            continue
        woj, pow_, gmi = row["WOJ"], row["POW"], row["GMI"]
        rows.append(
            [
                row["SYM"],
                row["NAZWA"],
                fold_polish(row["NAZWA"]),
                "TOWN" if row["RM"] == TOWN_RM else "VILLAGE",
                units[(woj, pow_, gmi, row["RODZ_GMI"])],
                units[(woj, pow_)],
                units[(woj,)].lower(),
            ]
        )
    return sorted(rows)


def _dbf_records(path: Path, fields: tuple[str, ...]) -> Iterator[tuple[str, ...]]:
    """Yield the named character fields of each live dBASE III record."""
    with path.open("rb") as f:
        count, header_size, record_size = struct.unpack("<xxxxIHH20x", f.read(32))
        layout: dict[str, tuple[int, int]] = {}
        offset = 1
        while (descriptor := f.read(32))[0] != 0x0D:
            name = descriptor[:11].split(b"\0")[0].decode("ascii")
            size = descriptor[16]
            layout[name] = (offset, offset + size)
            offset += size
        missing = set(fields) - set(layout)
        if missing:
            raise SystemExit(f"{path}: missing fields {sorted(missing)}, has {sorted(layout)}")
        slices = [slice(*layout[name]) for name in fields]
        f.seek(header_size)
        for first in range(0, count, DBF_BLOCK_RECORDS):
            block = f.read(min(DBF_BLOCK_RECORDS, count - first) * record_size)
            for start in range(0, len(block), record_size):
                record = block[start : start + record_size]
                if record[:1] != b"*":
                    # latin-1 never fails; non-ASCII junk is rejected by the callers' checks.
                    yield tuple(record[s].decode("latin-1").strip() for s in slices)


def build_postal_codes(prg: Path, roots: dict[str, str]) -> list[list[str]]:
    pairs: set[tuple[str, str]] = set()
    skipped = 0
    for simc_id, raw_code in _dbf_records(prg, (PRG_SIMC_FIELD, PRG_POSTAL_FIELD)):
        match = _POSTAL.fullmatch(raw_code)
        if match is None or simc_id not in roots:
            skipped += 1
            continue
        pairs.add((f"{match.group(1)}-{match.group(2)}", roots[simc_id]))
    print(f"PRG: skipped {skipped} points without a valid postal code or known SIMC id")
    return [list(pair) for pair in sorted(pairs)]


def _write(path: Path, header: list[str], rows: list[list[str]]) -> None:
    # mtime=0 and no embedded file name keep a rebuild from identical inputs byte-identical.
    with (
        path.open("wb") as raw,
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as packed,
        io.TextIOWrapper(packed, encoding="utf-8", newline="") as f,
    ):
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(header)
        writer.writerows(rows)
    print(f"{path}: {len(rows)} rows, {path.stat().st_size} bytes")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--simc", type=Path, required=True, help="SIMC_Urzedowy_*.csv")
    parser.add_argument("--terc", type=Path, required=True, help="TERC_Urzedowy_*.csv")
    parser.add_argument("--prg", type=Path, required=True, help="PRG_PunktyAdresowe_POLSKA.dbf")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    simc = _read_teryt(args.simc)
    localities = build_localities(simc, _units(_read_teryt(args.terc)))
    postal_codes = build_postal_codes(args.prg, _roots(simc))

    args.out.mkdir(parents=True, exist_ok=True)
    _write(args.out / "localities_pl.csv.gz", LOCALITY_HEADER, localities)
    _write(args.out / "locality_postal_codes_pl.csv.gz", POSTAL_HEADER, postal_codes)


if __name__ == "__main__":
    main()
