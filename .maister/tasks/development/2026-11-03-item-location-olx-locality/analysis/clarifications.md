# Phase 1 Clarifications

## TL;DR
Location is stored per item (new item-level FK), the Locality comes from an own TERYT-based dictionary (like OLX), the optional Address uses Google Places suggestions, the place form drops "Nazwa miejsca" and "Notatka", and existing data needs no compatibility (MVP, DB will be wiped).

## Key Decisions
- Item location stored on the item (per item, like an OLX listing), not on the shared PERSONAL inventory — user choice.
- Locality source: own TERYT (GUS) dictionary imported into Postgres with a backend search endpoint (by name / postal code); Address (optional) keeps Google Places suggestions — user choice "TERYT dla Lokalizacji + Google dla Adresu".
- Remove "Nazwa miejsca" and "Notatka" from the place form; display name derived from locality (+ address when present).
- No backward compatibility / data migration for existing places or items: MVP, database will be wiped (no guarded downgrades, no fallbacks for legacy rows required).

## Q&A
1. Where is the mandatory location stored? → **Na przedmiocie** (per item).
2. Locality data source? → User asked whether OLX has its own location database; answered: yes, OLX uses its own dictionary based on GUS TERYT (voivodeship → county → commune → locality, plus city districts), not Google. Follow-up answer: **TERYT dla Lokalizacji + Google dla Adresu**.
3. Fate of "Nazwa miejsca" / "Notatka"? → **Usunąć z formularza**.
4. Existing places/items without locality? → "nie trzeba, to jest aplikacja MVP, zmaże/wyczyści bazę, to nie produkcja" — no compat handling needed.
