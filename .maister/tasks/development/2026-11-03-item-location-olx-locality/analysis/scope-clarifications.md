# Scope Clarifications (Phase 2)

## TL;DR
All 6 critical and 11 important gap-analysis decisions resolved by the user; every recommended default accepted except duplicates (always create new places). Scope: TERYT+GUGiK postal dictionary seeded by migration, locations rework (locality required, address optional, name/notes dropped), per-item required location (backend-enforced, editable, cleared on transfer), inventory location removed, item draft store for the /places/new round trip.

## Key Decisions
- Postal codes from GUGiK address points (PRG) reduced offline to postal-code↔SIMC pairs — official, keyed by TERYT id; licence to be confirmed during data prep.
- Dataset shipped as gzipped fixture in `alembic/data/` + seeding data migration (0069 precedent).
- Item location cleared (`location_id = NULL`) on ownership transfer; new owner must set one before relisting.
- Location required on item create in backend (`CreateInventoryItemRequest.location_id`, ownership via circulation locations ACL) and frontend; shared conftest helper for ~20 test files.
- Item location editable on `/items/:id/edit` (same LocationPicker; PATCH accepts `location_id`).
- Privacy: everyone (incl. anonymous) sees locality label on item page; exact address only for owner; non-owners never receive address-derived text.
- Personal pickup and item-page location switch to the item's own live `location_id`.
- Remove `InventoryLocationCard`, `GET|PUT /api/inventories/mine/location`, `useMyInventoryLocation`, `inventories.location_id`; picker prefills last-used item location / only saved place.
- ItemCreateView draft (fields + photo File[]) lifted to AppDataContext (eventDraft/eventBanner pattern) so page-mode "+" round trip preserves it.
- No coordinates for locality-only places; Maps link queries by locality label; lat/lng only from Google address.
- Dictionary: independent localities only (no city districts), towns ranked before villages, labels always carry gmina/powiat/województwo.
- Address: locality first, Google address suggestions biased to chosen locality, no server-side consistency check.
- Deleting a place used by items allowed (soft delete); item still shows locality, pickup unavailable.
- Duplicates: **always create a new place** (no dedup) — user overrode the recommendation.
- Drop `name`/`notes` columns; API responses carry a computed `label`; update consumers (location_name, publicMetadata, picker).
- Locality on item cards (owner items, event participants, recent items): out of scope.
- Migrations: 0078 dictionary tables, 0079 seed, 0080 locations rework + item `location_id` (+ drop `inventories.location_id`); delete old location rows instead of backfill (MVP, DB wiped); plain downgrades + downgrade→upgrade test per revision.

## Open Questions / Risks
- GUGiK PRG licence/format must be verified before building the fixture; fallback is dropping postal search.
- Removing Google place dedup (always create new) — note existing partial unique index on google_place_id must go or be adapted.
