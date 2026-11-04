# localities_pl.csv.gz, locality_postal_codes_pl.csv.gz: provenance

The Polish locality dictionary seeded by revision 0079 into `localities` and `locality_postal_codes`. It is a static snapshot: a TERYT or PRG update means rebuilding with the command below and adding a new data migration.

## Sources and date
- Download date: 2026-11-03.
- **TERYT SIMC and TERC** (GUS, Krajowy Rejestr Urzędowy Podziału Terytorialnego Kraju), "stan na" 2026-01-01. Files `SIMC_Urzedowy_2026-11-03.zip` and `TERC_Urzedowy_2026-11-03.zip` (the "urzędowy" CSV variants), from https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pliki_pelne.aspx (the "Pobierz" buttons post the page back).
  - SHA-256 of `SIMC_Urzedowy_2026-11-03.zip`: `555bac753ddd03a89c7133d503043f1d3a3653af37ea7b430fd233a03900093f`.
  - SHA-256 of `TERC_Urzedowy_2026-11-03.zip`: `8d3e82a4696d53aed0480e402c43edbf8e09b84c9f8ec70bbf706cf2bbd47cb1`.
- **PRG address points** (GUGiK, Państwowy Rejestr Granic, punkty adresowe), the national SHP package exported 2026-11-03: https://opendata.geoportal.gov.pl/prg/adresy/PunktyAdresowe/POLSKA.zip (564 MB, Deflate64; extract `PRG_PunktyAdresowe_POLSKA.dbf` with Info-ZIP `unzip` or 7-Zip, since Python's `zipfile` cannot read it). Only the `ID_SIMC` and `KOD_POCZT` attributes are read.
  - SHA-256 of `POLSKA.zip`: `284affa744fad40ad621466f7597f8b8b9301fb4234fc65e759a382d27b59b11`.

## Licences
- TERYT is a public official register, published by GUS for free download. Reuse follows the Act of 11 August 2021 on open data and the reuse of public-sector information. Attribute it as "Źródło: GUS, TERYT".
- PRG: geoportal.gov.pl states "Dane PRG są dostępne bezpłatnie i do dowolnego wykorzystania" (free of charge, any use). Attribute it as "Źródło: GUGiK, PRG".
- The project owner confirms both at review.

## Filtering rules
- `localities` holds only independent SIMC entries (SYM = SYMPOD).
- Warsaw's districts (RM 95) and the delegations of Kraków, Łódź, Poznań and Wrocław (RM 98) are independent in SIMC but are city parts. They are left out and fold into their city (the RM 96 locality of the same city powiat).
- `kind` is `TOWN` when RM = 96 (miasto), else `VILLAGE`.
- `gmina` and `powiat` are the TERC names as published (powiat names are lowercase there, city powiats keep the city name). `voivodeship` is the TERC name lowercased (TERC stores it in capitals).
- `name_search` is `app.locations.localities.fold_polish(name)`.
- Each PRG address point maps its `ID_SIMC` to the independent root (a part maps to the locality containing it, a city district to its city).
- Postal codes are normalised to `NN-NNN`, and (postal_code, locality_id) pairs are deduplicated.
- 942 address points without a valid postal code or a SIMC id known to this SIMC edition are skipped.
- 3781 localities have no address point with a postal code, so they have no postal pair. They are found by name only.

## Counts
- `localities`: 54440 rows
- `locality_postal_codes`: 72245 rows

The 54440 localities are 1026 `TOWN` and 53414 `VILLAGE`. Sizes: `localities_pl.csv.gz` 734700 bytes, `locality_postal_codes_pl.csv.gz` 214405 bytes. Both files are gzip with mtime 0, so rebuilding from the same inputs is byte-identical.

## Rebuild
From `src/backend`, with the downloads unpacked:

```
uv run python scripts/build_localities.py --simc SIMC_Urzedowy_2026-11-03.csv --terc TERC_Urzedowy_2026-11-03.csv --prg PRG_PunktyAdresowe_POLSKA.dbf --out alembic/data
```

The script uses only the standard library plus `fold_polish`, needs no credentials, and reads the 7 GB `.dbf` in about 20 seconds.
