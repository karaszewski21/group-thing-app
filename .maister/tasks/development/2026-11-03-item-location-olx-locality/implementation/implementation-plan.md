# Implementation Plan: Mandatory item location + OLX-style locality (TERYT)

## TL;DR
- 14 task groups, 99 steps: 6 backend (dictionary data → 0080 schema → localities/locations API → circulation item location → groups privacy/pickup/listing guard → test-helper adoption), 6 frontend (contract/types → place form, picker → item hosts, term/stepper hosts, display sites), then docs/removal audit and test review.
- Two chains start at once: backend from Group 1, frontend from Group 7. The frontend codes against the spec's API contract, so it does not wait for the backend.
- Every UI group carries binding `Visual References`. `visual-coverage.md` covers all 7 design IDs.
- No commit steps (the user revoked checkpoint commits). Never print secret values: no env or `.env` dumps, presence checks only.

## Key Decisions
- **The frontend chain does not depend on the backend groups.** The spec pins every request and response shape (Req. 5, 7, 10, 16, 20). Groups 7–12 mock the API in vitest, and Group 14 checks the contract end to end.
- **Model changes go with the code that consumes them, not with the migrations.** Group 2 is migration-only (0080 + the two rewritten migration tests, run through the alembic subprocess). `Location`/`Locality` model edits go in Group 3, and `InventoryItem`/`Inventory` model edits go in Group 4. This keeps each group's own tests runnable.
- **Term/event `location_name` → `label` (Req. 12) is in Group 3, not Group 5.** Dropping `Location.name` in Group 3 would otherwise break `item_actions.py`, `owner_items.py` and `events_acl.py` until Group 5.
- **`find_item_live_location_id` is added in Group 4, and the old `find_personal_inventory_live_location_id` is removed in Group 5.** That way the bridge keeps compiling between the two groups.
- **Shared test helpers (`locality_ids`, `create_location`) are created in Group 3.** They are adopted across about 20 item-creating test files in a separate Group 6, after the circulation and groups behaviour is final.
- **`fold_polish` is built in Group 1**, because the build script imports it. Locality search is built in Group 3.
- **Docs are a separate group (13)** with a grep-based removal audit as its check, covering Success Criterion "grep is clean".
- **About 70–80 tests are expected, more than the usual 16–34.** The spec lists them explicitly, and the regression surface (Risk: high, 37 requirements) justifies it. Each group stays within 2–8 test functions, parametrizing related cases.

## Open Questions / Risks
- **GUGiK PRG licence/format is not yet confirmed.** Step 1.3 decides. The fallback is an empty `locality_postal_codes` table, the hint without "albo kod pocztowy", and code queries returning `[]`.
- **The suite is red between groups.** After Group 3, item creation tests that do not pass `location_id` fail until Group 6. After Group 7, `npm run typecheck` fails until Groups 8–12 update their consumers. Each group runs only its own tests, and Group 14 asserts that everything is clean.
- **Migration-test overhead.** All 22 migration tests reseed 0079. Step 1.2 records a baseline and step 1.9 measures again. Above +2 min, 0079 switches to asyncpg `copy_records_to_table`.
- **`AppDataContext.tsx` is shared by Groups 10 and 11**, so the executor serializes them. Both declare the file.
- **`groups/schemas.py`, `item_actions.py`, `authorization_matrix.py`, `test_item_location.py` and `test_authorization_matrix.py` are edited by more than one backend group.** Dependencies already serialize those groups.
- **`InventoryLocationCard.tsx` has an uncommitted CRLF-only diff.** Group 7 deletes the file, which is intended.
- **Known baselines:** 12 pre-existing vitest failures and mypy 15. Compare against these and do not count them as regressions.

## Overview
Total Steps: 99 (excluding the N.0 parent items)
Task Groups: 14
Expected Tests: about 70–80 test functions (Groups 1–12: about 72; Group 14 adds up to 10)

## Implementation Steps

### Task Group 1: Locality Dictionary Data & Seed Migrations
**Dependencies:** None
**Files to Modify:** `src/backend/app/locations/localities.py`, `src/backend/scripts/build_localities.py`, `src/backend/alembic/data/localities_pl.csv.gz`, `src/backend/alembic/data/locality_postal_codes_pl.csv.gz`, `src/backend/alembic/data/localities_pl.README.md`, `src/backend/alembic/versions/0078_localities.py`, `src/backend/alembic/versions/0079_seed_localities.py`, `src/backend/tests/test_localities_migration.py`, `src/backend/tests/test_localities.py`
**Estimated Steps:** 10

**Secrets:** never print secret values (no env or `.env` dumps, presence checks only). The build script and README must not contain or print credentials.

- [x] 1.0 Complete the locality dictionary data layer
  - [x] 1.1 Write 4–6 focused tests
    - `tests/test_localities_migration.py`:
      - `downgrade 0077` then `upgrade head` restores `localities` and `locality_postal_codes`;
      - the seed row counts equal the README counts;
      - the 0079 duration is logged and asserted below the 10 s ceiling;
      - head is restored with `alembic upgrade head` + `engine.dispose()` in `finally`.
    - `tests/test_localities.py` (pure unit tests, parametrized) for `fold_polish`:
      - "Kęty" → "kety";
      - "Łódź"/"ŁÓDŹ" → "lodz" (explicit `ł/Ł`);
      - NFKD mark stripping;
      - whitespace collapse and lowercasing.
  - [x] 1.2 Record the migration-test baseline before adding 0078.
    - From `src/backend`, run `uv run python -m pytest tests/ -k migration` and note the wall time in the work-log.
  - [x] 1.3 Confirm GUGiK PRG address-point availability, licence and postal-code format.
    - If it is not viable (licence, access or format), build an empty `locality_postal_codes_pl.csv.gz` (header only).
    - Record the outcome in the README.
    - Flag for Group 8 that the combobox hint must then drop "albo kod pocztowy".
  - [x] 1.4 Implement `fold_polish` in `app/locations/localities.py`.
    - NFKD, strip combining marks, explicit `ł/Ł → l`, lowercase, collapse whitespace.
    - Stdlib only, so the script can import it.
  - [x] 1.5 Write `scripts/build_localities.py` (new directory, stdlib + `fold_polish` only).
    - Arguments: `--simc`, `--terc`, `--prg`, `--out`.
    - Keep only independent SIMC entries (SYM = SYMPOD). `kind` is `TOWN` when RM = 96, else `VILLAGE`.
    - gmina/powiat/voivodeship come from lowercase TERC names.
    - PRG points on a dependent SIMC map to their root.
    - Normalise postal codes to `NN-NNN` and deduplicate pairs.
    - Write both `.csv.gz` files with a fixed header.
  - [x] 1.6 Run the script and commit-ready the outputs.
    - Write `alembic/data/localities_pl.csv.gz` and `alembic/data/locality_postal_codes_pl.csv.gz`.
    - Check the fixture size (expected 1–3 MB gzipped).
    - Write `localities_pl.README.md` on the `vinted_categories_pl.README.md` pattern: sources, "stan na", download date, licences, row counts, filtering rules, exact rebuild command.
  - [x] 1.7 Write migration `0078` (`down_revision` 0077).
    - `localities`:
      - `id String(7)` PK (`pk_localities`);
      - `name`, `name_search`, `kind`, `gmina`, `powiat`, `voivodeship`;
      - `ck_localities_kind`;
      - `ix_localities_name_search` with `text_pattern_ops`.
    - `locality_postal_codes`:
      - composite `pk_locality_postal_codes`;
      - `fk_locality_postal_codes_locality_id_localities` ON DELETE CASCADE;
      - `ix_locality_postal_codes_postal_code` with `varchar_pattern_ops`.
    - The downgrade drops the index, then the tables in reverse order.
  - [x] 1.8 Write data migration `0079`.
    - Fixture path: `Path(__file__).parents[1] / "data"`.
    - Stream with `gzip` + `csv`.
    - Validate the header, unique 7-digit ids, `kind`, the postal format, and that every postal `locality_id` exists.
    - Insert in 10k-row chunks: `INSERT … SELECT * FROM unnest(:a::text[], …)` with bound arrays.
    - Log the counts and the elapsed time.
    - Downgrade: `TRUNCATE locality_postal_codes, localities`.
  - [x] 1.9 Measure seed time.
    - Check 0079 alone (target ≤3 s, ceiling 10 s).
    - Re-run the step 1.2 command and compare with the baseline.
    - If the added time exceeds 2 minutes, switch the insert to asyncpg `copy_records_to_table`. Reach it via `op.get_bind().connection.driver_connection` wrapped in `sqlalchemy.util.await_only`, and keep parsing and validation unchanged.
    - Record both timings in the work-log.
  - [x] 1.10 Ensure the Group 1 tests pass.
    - Run ONLY `uv run python -m pytest tests/test_localities_migration.py tests/test_localities.py`.
    - Run `uv run python -m ruff check app tests scripts`.

**Acceptance Criteria:**
- The 4–6 tests pass, and ruff is clean, including `scripts/`.
- `alembic upgrade head` seeds counts that match the README. 0079 is ≤3 s locally (≤10 s ceiling).
- The baseline and post-change migration-test timings are recorded. The COPY fallback is in place if the overhead exceeds 2 min.
- The PRG decision is documented in the README.

---

### Task Group 2: Locations & Item-Location Schema Migration (0080)
**Dependencies:** 1
**Files to Modify:** `src/backend/alembic/versions/0080_item_location_locality.py`, `src/backend/tests/test_inventory_location_migration.py`, `src/backend/tests/test_locations_migration.py`
**Estimated Steps:** 5

- [x] 2.0 Complete the 0080 schema migration
  - [x] 2.1 Rewrite 2–4 migration tests.
    - `test_inventory_location_migration.py`:
      - `downgrade 0074` → `inventories.location_id` is absent;
      - `upgrade 0075` → the column, the FK (no ON DELETE) and the partial index exist;
      - `upgrade head` → `inventories.location_id`, its FK and its index are absent;
      - at head, `inventory_items.location_id` is nullable, with `fk_inventory_items_location_id_locations` and `ix_inventory_items_location_id WHERE location_id IS NOT NULL`;
      - head is restored in `finally`.
    - `test_locations_migration.py`:
      - `downgrade 0056` → the table is absent;
      - `upgrade 0058` → the 0057/0058 shape (`uq_locations_owner_party_id_google_place_id`, the group/term FKs);
      - at head: the unique index is absent; `locality_id` is NOT NULL with an FK to `localities`; `name`/`notes` are absent; `formatted_address` is nullable; `ck_locations_address_fields` and the group/term FKs exist.
    - Add one case: rows in `locations` plus the 4 referencing FKs before 0080 are deleted or nulled after `upgrade head`.
  - [x] 2.2 Write the 0080 upgrade.
    - `SET LOCAL lock_timeout = '5s'`.
    - Null `groups.default_location_id`, `terms.location_id`, `events.location_id` and `inventories.location_id`, then `DELETE FROM locations`.
    - Add `locality_id String(7) NOT NULL` + `fk_locations_locality_id_localities` (RESTRICT).
    - Drop `name`/`notes`, and make `formatted_address`/`source` nullable.
    - Add `ck_locations_address_fields`: no address means `source`, `google_place_id`, `lat` and `lng` are null; an address means `source` is not null.
    - Drop `uq_locations_owner_party_id_google_place_id`.
    - Add `inventory_items.location_id` UUID nullable + `fk_inventory_items_location_id_locations` (no ON DELETE) + the partial `ix_inventory_items_location_id`.
    - Drop the `inventories.location_id` index, FK and column.
  - [x] 2.3 Write the 0080 downgrade in reverse order.
    1. Drop the item index, FK and column.
    2. Re-add `inventories.location_id` + FK + partial index (the 0075 shape).
    3. Null the referencing FKs and `DELETE FROM locations`.
    4. Drop the CHECK and `locality_id`.
    5. Re-add `name NOT NULL`/`notes`, restore NOT NULL on `formatted_address`/`source`, and re-create the unique index.

    The docstring must say that a downgrade below 0080 deletes all places and item locations.
  - [x] 2.4 Re-run the unchanged `test_personal_pickup_migration.py` and `test_localities_migration.py`, so the 0075 guard still applies after 0080's downgrade.
  - [x] 2.5 Ensure the Group 2 tests pass.
    - Run ONLY `uv run python -m pytest tests/test_inventory_location_migration.py tests/test_locations_migration.py tests/test_personal_pickup_migration.py`.

**Acceptance Criteria:**
- The rewritten migration tests pass, and every one restores head.
- 0080 upgrades and downgrades cleanly. Its names follow `pk_`/`fk_`/`ix_`/`ck_`.

---

### Task Group 3: Localities Search & Locations API
**Dependencies:** 2
**Files to Modify:**
- Locations module: `src/backend/app/locations/models.py`, `src/backend/app/locations/localities.py`, `src/backend/app/locations/schemas.py`, `src/backend/app/locations/service.py`, `src/backend/app/locations/router.py`
- Wiring and ACLs: `src/backend/app/main.py`, `src/backend/app/core/authorization_matrix.py`, `src/backend/app/circulation/infrastructure/locations_acl.py`, `src/backend/app/groups/infrastructure/locations_acl.py`, `src/backend/app/events/infrastructure/locations_acl.py`
- Term/event place strings: `src/backend/app/groups/schemas.py`, `src/backend/app/events/schemas.py`, `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/application/owner_items.py`, `src/backend/app/groups/infrastructure/events_acl.py`
- Tests: `src/backend/tests/conftest.py`, `src/backend/tests/test_localities.py`, `src/backend/tests/test_locations.py`, `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_events.py`, `src/backend/tests/test_group_location_defaults.py`, `src/backend/tests/test_term_location_capacity.py`, `src/backend/tests/test_public_term.py`, `src/backend/tests/test_organizer_page.py`, `src/backend/tests/test_organizer_terms.py`

**Estimated Steps:** 11

- [x] 3.0 Complete the localities search and locations API
  - [x] 3.1 Write up to 8 focused test functions, parametrized.
    - `test_localities.py` search:
      - a folded prefix ("kety" → Kęty);
      - TOWN first, then exact match;
      - postal "32-65" and "32650";
      - `%`/`_` match literally;
      - "łódź" finds Łódź;
      - `limit` 0/21 returns 422, and `q` shorter than 2 returns empty;
      - the exact key set;
      - `count_queries` == 2;
      - 401 for anonymous.
    - `test_locations.py`:
      - no-address create;
      - MANUAL/GOOGLE field rules (422s);
      - an unknown locality returns 404;
      - no dedup (two POSTs give two rows);
      - a PUT that changes the locality returns the new `locality`/`label` in the same response;
      - a PUT clears the address;
      - exact key sets for `LocationResponse`/`LocationRefResponse`/`PublicLocationResponse`;
      - foreign 403.
  - [x] 3.2 Rework the models in `app/locations/models.py`.
    - Add `Locality` and `LocalityPostalCode` on plain `Base`, with the SIMC `String(7)` natural PK carve-out.
    - `Location` gains `locality_id` + `locality = relationship(lazy="raise")`.
    - Drop `name`/`notes`, and make `formatted_address`/`source` nullable.
    - Mirror the CHECK in `__table_args__`.
    - Remove the google-place unique index from the model.
  - [x] 3.3 Implement `search_localities(db, q, limit)` in `localities.py`.
    - Trim `q`; fewer than 2 characters returns empty.
    - Postal mode: `^\d{2}(-?\d{0,3})?$`, normalised to `NN-…`. Return distinct localities with the minimum matching `postal_code`.
    - Name mode: `name_search.startswith(fold_polish(q), autoescape=True)`.
    - Order by kind (TOWN first), exact folded match, `name`, `voivodeship`, `powiat`, `gmina`.
    - SQL-level `LIMIT`, and a separate count statement for `total`: 2 statements in all.
  - [x] 3.4 Update the schemas.
    - `LocalityResponse {id, name, kind, gmina, powiat, voivodeship}`.
    - `LocalitySearchResponse {results: [... + postal_code|null], total}`.
    - `LocationRequest` with `extra=forbid` and the Req. 7 rules: blank address → null; `source` required with an address and forbidden without one; GOOGLE requires `google_place_id`/`lat`/`lng`, MANUAL forbids them.
    - `LocationResponse`, `LocationRefResponse` and `PublicLocationResponse` per the Req. 10 table, with `label`.
  - [x] 3.5 Update `service.py`.
    - Add `location_label(location)`: "Kęty, małopolskie", or "Kęty — {formatted_address}".
    - Add `load_location` and `load_locations_by_ids`: `joinedload(Location.locality)` + `execution_options(populate_existing=True)`, soft-deleted rows included.
    - `create_location`/`update_location` commit, then return `await load_location(...)`. An unknown locality raises `EntityNotFoundException("Locality")`.
    - `get_own_location` uses `joinedload`, keeping 404 before 403.
    - `list_mine` is ordered by locality name, then `created_at`.
    - Remove the dedup and the `GoogleAddressNotEditable` 409.
  - [x] 3.6 Update the router.
    - Add `GET /api/localities?q=&limit=` (`limit` `ge=1, le=20`, default 10).
    - Replace `PATCH /api/locations/{id}` with `PUT`.
    - Register the new router in `app/main.py` if it is a separate router.
  - [x] 3.7 Update `authorization_matrix.py`.
    - Add `GET ^/api/localities$` → `READ`/`mcp:read`.
    - Change the locations PATCH row to PUT.
    - Update `test_authorization_matrix.py` to match.
  - [x] 3.8 Point the three `locations_acl.py` modules (circulation, groups, events) at `load_location`/`load_locations_by_ids` instead of `db.get`/own selects.
    - Update the `LocationRefResponse`/`PublicLocationResponse` embeds in `groups/schemas.py` and `events/schemas.py`.
  - [x] 3.9 Switch the term/event place strings to `label` (Req. 12).
    - The term context `location_name` in `item_actions.py`.
    - The term rows in `owner_items.py`.
    - `UpcomingEvent.location_name` in `events_acl.py`.
  - [x] 3.10 Add the shared test helpers to `tests/conftest.py`.
    - `locality_ids(client, headers, n)`: through `GET /api/localities`, called per test, never cached.
    - `create_location(client, headers, *, address=None) -> str`.
    - Replace the `name`/`notes` place bodies in `test_events.py`, `test_group_location_defaults.py` and `test_term_location_capacity.py`.
    - Update the term/event/organizer key-set assertions (`test_public_term.py`, `test_organizer_page.py`, `test_organizer_terms.py`).
  - [x] 3.11 Ensure the Group 3 tests pass.
    - Run ONLY `uv run python -m pytest tests/test_localities.py tests/test_locations.py tests/test_authorization_matrix.py tests/test_events.py tests/test_group_location_defaults.py tests/test_term_location_capacity.py tests/test_public_term.py tests/test_organizer_page.py tests/test_organizer_terms.py`.

**Acceptance Criteria:**
- The new and changed tests pass. Search runs in 2 SQL statements, and `%`/`_` match literally.
- POST/PUT responses carry a loaded `locality` + `label` with no `MissingGreenlet`. A PUT that changes the locality returns the new locality.
- No dedup remains. PUT replaces PATCH in both the router and the matrix.

---

### Task Group 4: Item Location in Circulation
**Dependencies:** 3
**Files to Modify:**
- Circulation code: `src/backend/app/circulation/models.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/circulation/router.py`, `src/backend/app/circulation/service.py`, `src/backend/app/circulation/application/inventory_items.py`, `src/backend/app/circulation/application/inventory.py`, `src/backend/app/circulation/application/item_details.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/infrastructure/ledger.py`, `src/backend/app/circulation/infrastructure/locations_acl.py`, `src/backend/app/core/authorization_matrix.py`
- Tests: `src/backend/tests/test_item_location.py`, `src/backend/tests/test_inventory_location.py` (delete), `src/backend/tests/test_authorization_matrix.py`, `src/backend/tests/test_item_details.py`

**Estimated Steps:** 9

- [x] 4.0 Complete item location in the circulation context
  - [x] 4.1 Write 6 focused tests in the new `tests/test_item_location.py`, using `create_location`.
    - Create without `location_id` returns 422.
    - Create with a foreign place returns 403, and with a deleted place 404.
    - A PATCH changes the location, and a PATCH with `{"location_id": null}` returns 422.
    - A GIFT transfer clears the location, and REGISTER keeps it.
    - `GET /api/inventory-items/{id}` has no `location_id` key.
    - `/details` `location_id` is null for a non-owner and for the owner of a soft-deleted place.

    Delete `tests/test_inventory_location.py`.
  - [x] 4.2 Update the models.
    - `InventoryItem.location_id` (nullable UUID FK → `locations.id`, plain FK-id column, no `relationship()`).
    - Remove `Inventory.location_id`.
  - [x] 4.3 Update the schemas.
    - `CreateInventoryItemRequest.location_id: uuid.UUID` (required).
    - `UpdateInventoryItemRequest.location_id: uuid.UUID | None = None`. An explicit `null` returns 422; use a `model_fields_set` check.
    - `ItemDetailsResponse.location_id: uuid.UUID | None`.
    - Remove `InventoryLocationResponse` and `SetInventoryLocationRequest`.
  - [x] 4.4 In `circulation/infrastructure/locations_acl.py`, build `get_owned_location` from `load_location` (404 for unknown or deleted, 403 for foreign).
    - Remove `get_location_ref` if it becomes unused.
  - [x] 4.5 Update `register_item` and the item update path in `application/inventory_items.py`.
    - Resolve the owner party with `repository.find_party_id_by_user_id`.
    - Validate through `get_owned_location` before inserting or updating.
    - Do not notify on a change during an open pickup reservation (accepted).
  - [x] 4.6 Add `repository.find_item_live_location_id(db, item_id)`.
    - Single statement: join on `locations.deleted_at IS NULL`.
    - Export it from `circulation/service.py`.
    - `item_details.py` fills `location_id` only when `is_owner` and the place is live.
  - [x] 4.7 In `ledger._apply_projection`, set `item.location_id = None` for GIFT/SWAP only. REGISTER, REMOVE and legacy LEND/RETURN leave it untouched.
  - [x] 4.8 Remove the inventory location surface.
    - `GET|PUT /api/inventories/mine/location` routes.
    - `get/set_my_inventory_location` in `application/inventory.py`.
    - The service exports.
    - Matrix row 172.
    - Update `test_authorization_matrix.py` and `test_item_details.py` (key set includes `location_id`).
  - [x] 4.9 Ensure the Group 4 tests pass.
    - Run ONLY `uv run python -m pytest tests/test_item_location.py tests/test_item_details.py tests/test_authorization_matrix.py`.

**Acceptance Criteria:**
- The 6 tests pass. Every created item has a `location_id`, and create without one returns 422.
- Non-owners never receive `location_id` through `GET /api/inventory-items/{id}` or `/details`.
- The inventory location routes, schemas, column and matrix row are gone.

---

### Task Group 5: Item Page Privacy, Personal Pickup & Listing Guard
**Dependencies:** 4
**Files to Modify:**
- Groups code: `src/backend/app/groups/schemas.py`, `src/backend/app/groups/application/item_actions.py`, `src/backend/app/groups/application/reservation_context.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/infrastructure/circulation_bridge.py`
- Circulation cleanup: `src/backend/app/circulation/service.py`, `src/backend/app/circulation/infrastructure/repository.py`
- Tests: `src/backend/tests/test_item_actions.py`, `src/backend/tests/test_personal_pickup.py`, `src/backend/tests/test_item_visibility.py`, `src/backend/tests/test_item_location.py`, `src/backend/tests/test_term_item_listings.py`

**Estimated Steps:** 8

- [x] 5.0 Complete item-page privacy, pickup and the listing guard
  - [x] 5.1 Write or update up to 8 focused tests.
    - Rewrite `test_personal_pickup.py::_set_location` to create a place and PATCH the item. It is imported by `test_item_actions.py` and `test_item_visibility.py`.
    - OWN/OTHER/ANONYMOUS `/actions` `location` key sets.
    - OTHER/ANONYMOUS get `location == {locality: …, formatted_address: None, deleted_at: None}`, and the JSON contains no substring of the item place's address. The fixture place has an address that no term uses.
    - Reusing that place for a term gives a context `location_name` equal to its `label`.
    - A deleted place still shows the locality to others.
    - Pickup is gated by the item location: 409 "Właściciel nie ustawił lokalizacji przedmiotu", `personal_pickup_available = false`.
    - In `test_item_location.py`, DRAFT → ACTIVE without a live location returns 409 "Ustaw lokalizację przedmiotu, aby go wystawić".
    - A mode or visibility change on an already-listed item whose place was deleted succeeds.
    - `MyInventoryItemResponse.location_id` is present.
  - [x] 5.2 Rework `ItemLocationResponse` to `{locality, formatted_address, deleted_at}` (drop `name`).
    - In `_viewer_location`, OWN gets all three fields.
    - Others get the locality only, with the `formatted_address` and `deleted_at` keys present as `null`.
  - [x] 5.3 In `item_actions`, use `owner_location_id = item.location_id`, still batched with the term places in one `IN` query via `load_locations_by_ids`. Keep `set_personalised_cache_headers`.
  - [x] 5.4 Add `circulation_bridge.get_item_live_location_id(db, item_id)`.
    - `reservation_context.load_personal_context` uses it, with the new 409 message.
    - Remove `get_personal_inventory_live_location_id` and `find_personal_inventory_live_location_id` (repository, service export, bridge `__all__`).
  - [x] 5.5 Add the listing guard in `set_item_listing_preference`.
    - After the FOR UPDATE item read: when `mode` is non-null, `existing is None` and the item has no live location, raise `BusinessConflictException` (409).
    - Changing an existing preference and clearing a mode are never blocked.
  - [x] 5.6 Add `location_id` to `MyInventoryItemResponse` (`groups/schemas.py`) and fill it in the `term_item_listings.py` builder.
  - [x] 5.7 Check that `/actions` and `/details` keep `set_personalised_cache_headers`, and that the anonymous response stays shared-cacheable (`public, max-age=0, s-maxage=60`).
  - [x] 5.8 Ensure the Group 5 tests pass.
    - Run ONLY `uv run python -m pytest tests/test_item_actions.py tests/test_personal_pickup.py tests/test_item_visibility.py tests/test_item_location.py tests/test_term_item_listings.py`.

**Acceptance Criteria:**
- The tests pass. Non-owners get exactly `{locality, formatted_address: null, deleted_at: null}`.
- Pickup and the item page read `item.location_id`. The DRAFT → ACTIVE 409 is enforced, and existing listings are never blocked.
- The old inventory-location bridge and repository functions are gone.

---

### Task Group 6: Backend Shared Location Helpers Adoption
**Dependencies:** 4, 5
**Files to Modify:**
- New helper test: `src/backend/tests/test_location_helpers.py`
- Item-creating test files that adopt the helper: `src/backend/tests/test_attendance_withdrawal.py`, `src/backend/tests/test_circulation.py`, `src/backend/tests/test_circulation_ledger.py`, `src/backend/tests/test_conversation_inbox.py`, `src/backend/tests/test_conversation_messages.py`, `src/backend/tests/test_event_item_reservations.py`, `src/backend/tests/test_event_reservation_readers.py`, `src/backend/tests/test_exchange_summary.py`, `src/backend/tests/test_handover_copy_api.py`, `src/backend/tests/test_item_conversations.py`, `src/backend/tests/test_item_history.py`, `src/backend/tests/test_item_listing_status.py`, `src/backend/tests/test_messaging_cross_context.py`, `src/backend/tests/test_organizer_bridges.py`, `src/backend/tests/test_photo_moderation_gate.py`, `src/backend/tests/test_product_description.py`, `src/backend/tests/test_product_photos.py`, `src/backend/tests/test_product_resolution.py`, `src/backend/tests/test_reservation_write_guards.py`, `src/backend/tests/test_reserved_listings.py`, `src/backend/tests/test_term_clock_regressions.py`, `src/backend/tests/test_term_end_scan.py`, `src/backend/tests/test_term_item_listings_router.py`, `src/backend/tests/test_domain_clock_guard.py`, `src/backend/tests/test_lend_step0_fixes.py`, `src/backend/tests/test_pledge_fulfillment.py`

**Estimated Steps:** 4

- [x] 6.0 Complete helper adoption across the item-creating test files
  - [x] 6.1 Write 2 tests in `tests/test_location_helpers.py`.
    - `create_location` (with and without an address) returns a live owned id accepted by `POST /api/inventory-items`.
    - `locality_ids(client, headers, n)` returns `n` distinct ids per call.
  - [x] 6.2 Adopt the helper in every test file that POSTs `/api/inventory-items`.
    - Use `grep -rl "inventory-items" tests` as the source of truth; the list above is from that grep.
    - Pass `location_id` from `create_location` in each file's `_create_*` helper.
    - Never cache ids at module or session scope.
  - [x] 6.3 Remove any remaining `name`/`notes` location bodies or `.name` assertions on places.
    - Use `grep -rn "/api/locations" tests`.
  - [x] 6.4 Ensure the touched tests pass.
    - Run the helper test and each adopted file (`uv run python -m pytest tests/test_location_helpers.py <adopted files>`).
    - Then run `uv run python -m mypy app` (≤15) and `uv run python -m ruff check app tests scripts`.

**Acceptance Criteria:**
- Both helper tests pass, and every adopted file passes.
- mypy stays ≤15, and ruff is clean.

---

### Task Group 7: Frontend Location Contract — Types, API, Hooks & Fixtures
**Dependencies:** None (codes against the spec's API contract, Req. 5, 7, 10, 16, 20)
**Files to Modify:**
- API: `src/frontend/src/api/locations.ts`, `src/frontend/src/api/localities.ts`, `src/frontend/src/api/inventories.ts`, `src/frontend/src/api/items.ts`, `src/frontend/src/api/itemActions.ts`, `src/frontend/src/api/terms.ts`, `src/frontend/src/api/events.ts`, `src/frontend/src/api/groups.ts`
- Hooks: `src/frontend/src/hooks/useLocalitySearch.ts`, `src/frontend/src/hooks/useMyLocations.ts`, `src/frontend/src/hooks/useMyInventoryLocation.ts` (delete)
- Utilities: `src/frontend/src/utils/locationLabel.ts`, `src/frontend/src/utils/appHelpers.ts`, `src/frontend/src/lib/googleMaps.ts`
- Removed card: `src/frontend/src/features/items/InventoryLocationCard.tsx` (delete), `src/frontend/src/features/items/MyItemsView.tsx`
- Tests and fixtures: `src/frontend/src/test/fixtures/locations.ts`, `src/frontend/src/test/useLocalitySearch.test.tsx`, `src/frontend/src/test/locationLabel.test.ts`, `src/frontend/src/test/useMyLocations.test.tsx`, `src/frontend/src/test/useMyInventoryLocation.test.tsx` (delete), `src/frontend/src/test/MyItemsView.test.tsx`, `src/frontend/src/test/MyItemsViewCategory.test.tsx`

**Estimated Steps:** 9

- [x] 7.0 Complete the frontend location contract layer
  - [x] 7.1 Write 4–6 focused tests.
    - Typed factories in `src/test/fixtures/locations.ts`, with no `as` casts: `makeLocality`, `makeLocationResponse`, `makeLocationRef`, `makePublicLocation`, `makeItemLocation`.
    - `useLocalitySearch.test.tsx`: `q` shorter than 2 issues no request; the key is prefixed with `LOCALITIES_KEY`; a debounced request.
    - `locationLabel.test.ts`: `localityDetail`, `localityMapsQuery`, and `buildMapsUrl({query, google_place_id?})`.
    - `useMyLocations.test.tsx`: create no longer dedups; `update` calls PUT and awaits invalidation of the locations prefix.
  - [x] 7.2 Update the types in `api/locations.ts`.
    - Add `Locality`.
    - `LocationResponse`, `LocationRefResponse` and `PublicLocationResponse` per Req. 10 (no `name`/`notes`, with `label`).
    - Add `LocationRequest`.
    - `updateLocation` uses `PUT`.
  - [x] 7.3 Add `api/localities.ts` (`searchLocalities(q, limit)`, `LocalitySearchResponse`) and `hooks/useLocalitySearch.ts` (TanStack Query, `LOCALITIES_KEY` prefix, 300 ms debounce, app-shaped return with a stable empty fallback).
  - [x] 7.4 In `useMyLocations`, remove the create dedup and expose `create`/`update`/`remove` for hosts to pass as props.
  - [x] 7.5 Update the item types.
    - In `api/items.ts`/`api/inventories.ts`: `location_id` on the create (required) and update (optional) requests, on `MyInventoryItemResponse`, and on `ItemDetailsResponse`.
    - Remove `getMyInventoryLocation`/`setMyInventoryLocation` and their types.
  - [x] 7.6 Update the embedded location types.
    - `api/itemActions.ts`: `ItemLocationResponse {locality, formatted_address, deleted_at}`.
    - `api/terms.ts`/`api/events.ts`/`api/groups.ts`: embedded `LocationRefResponse`/`PublicLocationResponse`. `TermPlaceLocation` drops `name`/`notes`.
  - [x] 7.7 Add and update the shared helpers.
    - New `utils/locationLabel.ts` (`localityDetail`, `localityMapsQuery`).
    - `lib/googleMaps.ts` `buildMapsUrl` accepts `{query, google_place_id?}`.
    - `utils/appHelpers.ts`: `PickedLocationState.pickedLocation.locationId: string | null`.
  - [x] 7.8 Remove the inventory location UI.
    - Delete `InventoryLocationCard.tsx` and its use in `MyItemsView.tsx`.
    - Delete `useMyInventoryLocation.ts` and its test.
    - Update the `MyItemsView` tests to the typed factories.
  - [x] 7.9 Ensure the Group 7 tests pass.
    - Run ONLY `npx vitest run src/test/useLocalitySearch.test.tsx src/test/locationLabel.test.ts src/test/useMyLocations.test.tsx src/test/MyItemsView.test.tsx src/test/MyItemsViewCategory.test.tsx`.

**Acceptance Criteria:**
- The 4–6 tests pass, and the factories are fully typed.
- The inventory location API, hook and card are deleted. `npm run typecheck` errors that remain are only in files owned by Groups 8–12.

---

### Task Group 8: Place Form & Locality Combobox
**Dependencies:** 7
**Files to Modify:** `src/frontend/src/components/shared/LocalityCombobox.tsx`, `src/frontend/src/components/shared/LocationAddForm.tsx`, `src/frontend/src/features/places/PlaceCreateView.tsx`, `src/frontend/src/features/places/PlaceEditView.tsx`, `src/frontend/src/features/places/PlacesView.tsx`, `src/frontend/src/test/LocalityCombobox.test.tsx`, `src/frontend/src/test/LocationAddForm.test.tsx`, `src/frontend/src/test/PlaceCreateView.test.tsx`, `src/frontend/src/test/PlacesView.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html
  - element: screen:place-create
  - locator: `#mockup-content` (line 247), all 5 `.phone` panels — "1 · pusty", "2 · podpowiedzi (nazwa)", "3 · podpowiedzi (kod)", "4 · miejscowość wybrana + adres Google", "5 · błąd walidacji".
  - acceptance:
    - Exactly 2 fields, in this order: "Lokalizacja *" then "Adres (opcjonalnie)", with buttons "Zapisz", "Anuluj".
    - Empty state: placeholder "Miejscowość lub kod pocztowy"; hint "Np. „Kęty”, „Nowa Wieś” albo „32-650”." (without "albo kod pocztowy" wording if PRG fell back); address disabled with "Najpierw wybierz miejscowość".
    - Address hint "Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty."
    - Chosen state shows the locality chip + "zmień", and enables the address with Google suggestions.
    - Error state: `role="alert"` "Wybierz miejscowość z listy" with `aria-invalid`.
    - Applies to `/places/new` and `/places/:id/edit`.
- mockup: analysis/design-context/mockups/dodaj-miejsce-lokalizacja-adres.html
  - element: component:locality-combobox
  - locator: `.lb[role=listbox]` in panels "2 · podpowiedzi (nazwa)" and "3 · podpowiedzi (kod)", plus `.chip` in panel 4.
  - acceptance:
    - Option = bold name + small detail line "gm. X, pow. Y, voivodeship", with " · miasto" for TOWN.
    - In postal mode the detail line is prefixed "NN-NNN · ".
    - The overflow line "… i N więcej — doprecyzuj wpis" is a non-option status.
    - Chosen chip = name + detail line + "zmień" button.
- mockup: analysis/design-context/mockups/moje-miejsca-lista.html
  - element: screen:places-list
  - locator: `#mockup-content` (line 247), the "lista miejsc" panel: `.prow` rows + footer `.help`.
  - acceptance:
    - The primary line is the locality name.
    - The secondary line is `{formatted_address} · {voivodeship}`, or the detail line when there is no address.
    - Row actions "Edytuj · Usuń".
    - Footer "Miejsca bez adresu wystarczą dla przedmiotów. Dla terminów i wydarzeń dodaj adres."

**Estimated Steps:** 7

**Secrets:** never print secret values. Check `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` only for presence (`isGoogleMapsConfigured`), and never log or dump it.

- [x] 8.0 Complete the place form and locality combobox
  - [x] 8.1 Write up to 8 focused tests.
    - `LocalityCombobox.test.tsx`:
      - suggestions render the detail line and "· miasto";
      - ArrowDown + Enter selects;
      - Esc closes only the listbox (`defaultPrevented`, the parent is not closed);
      - the overflow line is not a `role="option"`;
      - typed but never picked shows "Wybierz miejscowość z listy".
    - `LocationAddForm.test.tsx`:
      - the address is disabled until a locality is chosen;
      - changing the locality clears the address;
      - the create and edit `submit` request shapes.
    - `PlaceCreateView.test.tsx`:
      - save with `returnTo` navigates with `replace: true` and `{pickedLocation: {picker, locationId}}`;
      - cancel with `returnTo` + `picker` uses `replace` and `locationId: null`;
      - no `returnTo` pushes `/places`.
    - `PlacesView.test.tsx` row lines.

    Use the Group 7 factories and `renderWithRoute`.
  - [x] 8.2 Build `components/shared/LocalityCombobox.tsx` over `useLocalitySearch`.
    - Copy the combobox mechanics from `LocationAddForm`: `aria-activedescendant`, `aria-controls` only while open, ArrowUp/Down + Enter, and Esc with `preventDefault` + `stopPropagation`.
    - Overflow status line, chip with "zmień", pick-required error.
    - Use the `LOCATION_INPUT_CLASS`/`LOCATION_LABEL_CLASS`/`LOCATION_ERROR_CLASS` tokens.
  - [x] 8.3 Rework `LocationAddForm` to two fields.
    - It takes `initial?: LocationResponse` and `submit(request)`.
    - The address is disabled until a locality is chosen; use `aria-disabled` + hint per the accessibility standard.
    - Google suggestions are biased with "{locality}, {voivodeship}". The manual fallback is kept.
    - Changing the locality clears the address.
    - Remove Nazwa/Notatka.
  - [x] 8.4 Update `PlaceCreateView`.
    - Toast `Dodano miejsce „{locality.name}”`.
    - With a safe `returnTo`, save and cancel use `useAppNavigate(..., { replace: true, state })`: the pick on save, and `locationId: null` on cancel when `picker` is set.
    - Without `returnTo`, push `/places`.
  - [x] 8.5 `PlaceEditView` uses the same form with `initial` + `update` (PUT), passed as props from `useMyLocations`.
  - [x] 8.6 `PlacesView` rows: the primary locality name, the secondary address · voivodeship or detail line (`localityDetail`), and the footer note.
  - [x] 8.7 Ensure the Group 8 tests pass.
    - Run ONLY `npx vitest run src/test/LocalityCombobox.test.tsx src/test/LocationAddForm.test.tsx src/test/PlaceCreateView.test.tsx src/test/PlacesView.test.tsx`.

**Acceptance Criteria:**
- The tests pass.
- Implementation matches each `acceptance` criterion declared above for `screen:place-create`, `component:locality-combobox` and `screen:places-list`.

---

### Task Group 9: Required Page-Mode LocationPicker
**Dependencies:** 7
**Files to Modify:** `src/frontend/src/components/shared/LocationPicker.tsx`, `src/frontend/src/test/LocationPicker.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
  - element: component:location-picker-required
  - locator: `#mockup-content` (line 247), the `.pick` block + following `.help` in panels "1 · wypełniony", "2 · brak zapisanych miejsc", "3 · po powrocie z /places/new".
  - acceptance:
    - In `required` mode there is no "none" option, and a null value shows the disabled placeholder "Wybierz miejsce".
    - A `+` link (`aria-label="Dodaj nowe miejsce"`) sits beside the select.
    - Options show `label` (e.g. "Kęty, małopolskie").
    - With no places: "Nie masz jeszcze miejsc" + `+` + helper "Dodaj miejsce przyciskiem „+”. Wrócisz tu z zachowanymi danymi i zdjęciami."
    - With `invalid`: `aria-invalid` + `role="alert"` "Wybierz lokalizację".
- mockup: analysis/design-context/mockups/edytuj-rzecz-zmiana-lokalizacji.html
  - element: component:location-picker-required
  - locator: panel "2 · przekazany przedmiot bez lokalizacji", `.pick` + `.error`.
  - acceptance: the empty required picker shows "Wybierz miejsce ▾" in the error style, with an inline `role="alert"` "Wybierz lokalizację".

**Estimated Steps:** 7

- [x] 9.0 Complete the required page-mode LocationPicker
  - [x] 9.1 Write 6 focused tests in `LocationPicker.test.tsx`.
    - No "none" option in `required` mode.
    - `invalid` gives `aria-invalid` + an alert.
    - The empty-state copy.
    - The `+` link uses `replace` and runs `onAddClick` before navigating.
    - A pick from navigation state is applied once.
    - A `null` pick (cancel) leaves the value unchanged.
  - [x] 9.2 Remove the inline mode: the `addMode` prop, the `LocationAddForm` import, and the `create` usage.
  - [x] 9.3 Make `+` always a facade `Link` to `placeCreatePath(...)` with `replace`, plus an optional `onAddClick` callback.
  - [x] 9.4 In the `handledPick` consumption, mark a `locationId === null` pick as handled without calling `onChange`.
  - [x] 9.5 Add the `required`, `invalid` and `errorText` props: placeholder "Wybierz miejsce", `aria-describedby` to the alert, and the empty state with helper text.
  - [x] 9.6 Options render `label`. The selected-place line shows the address, or `localityDetail`. `FallbackLocation` becomes `{id, label, deleted_at}`.
  - [x] 9.7 Ensure the Group 9 tests pass.
    - Run ONLY `npx vitest run src/test/LocationPicker.test.tsx`.

**Acceptance Criteria:**
- The 6 tests pass. No inline add form remains in the picker.
- Implementation matches each `acceptance` criterion declared above for `component:location-picker-required`.

---

### Task Group 10: Item Create & Edit with Required Location and Drafts
**Dependencies:** 8, 9
**Files to Modify:**
- Panel state and item views: `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/items/ItemCreateView.tsx`, `src/frontend/src/components/shared/ItemQuickAddForm.tsx`, `src/frontend/src/utils/itemQuickAdd.ts`, `src/frontend/src/features/items/ItemEditView.tsx`, `src/frontend/src/features/items/product/ItemEditForm.tsx`
- Hooks: `src/frontend/src/hooks/useCreateItem.ts`, `src/frontend/src/hooks/useItemDetail.ts`
- Tests: `src/frontend/src/test/ItemCreateView.test.tsx`, `src/frontend/src/test/ItemEditView.test.tsx`, `src/frontend/src/test/ItemQuickAddForm.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
  - element: screen:item-create
  - locator: `#mockup-content` (line 247), panels "1 · wypełniony (podpowiedź ostatnio użytego miejsca)", "2 · brak zapisanych miejsc", "3 · po powrocie z /places/new".
  - acceptance:
    - Field order: Zdjęcia, Nazwa, Stan, Kategoria, Opis, then "Lokalizacja *" with `+`.
    - Helper "Kupujący zobaczą tylko miejscowość. Adres widzisz tylko Ty."
    - The prefilled picker shows the last-used place label.
    - With no places: the empty picker plus hint "Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać." and the action buttons `aria-disabled`.
    - After returning from `/places/new`: toast "Dodano miejsce „Kęty”", the new place selected, and name/category/description/photos intact.
- mockup: analysis/design-context/mockups/edytuj-rzecz-zmiana-lokalizacji.html
  - element: screen:item-edit
  - locator: `#mockup-content` (line 247), panels "1 · edycja z lokalizacją" and "2 · przekazany przedmiot bez lokalizacji".
  - acceptance:
    - Field order: Nazwa, Stan, Kategoria, Opis, then "Lokalizacja *" with `+` and the helper; buttons "Zapisz zmiany" / "Anuluj".
    - A null `location_id` (no location or a deleted place) shows the `role="status"` banner "Ustaw lokalizację, aby wystawić przedmiot." with an empty picker.
    - Saving without a pick shows "Wybierz lokalizację" and saves nothing.
- mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
  - element: component:location-picker-required
  - locator: the `.pick` blocks in all 3 panels.
  - acceptance: the picker is used with `required`, `idPrefix="item-create-place"` / `"item-edit-place"`, and `invalid`/`errorText` wired to the host's submit attempt.

**Estimated Steps:** 7

- [x] 10.0 Complete item create and edit with a required location
  - [x] 10.1 Write up to 8 focused tests.
    - `ItemCreateView.test.tsx`:
      - actions blocked without a location (`aria-disabled` + hint);
      - the draft and photos survive an unmount and remount through `AppDataContext`;
      - `location_id` is sent;
      - the draft is cleared after a successful create, before navigating;
      - the prefill picks the newest item's live place, else the only place.
    - `ItemEditView.test.tsx`:
      - a location change is saved, and `ITEM_ACTIONS_KEY` + `ITEM_DETAILS_KEY` are invalidated;
      - the banner shows for a null `location_id`;
      - "Anuluj" clears `itemEdit`;
      - after the `+` → `/places/new` → back round trip, save calls `navigate(-1)` and `getTestRouter().calls` records no `/places/new` push entry.
  - [x] 10.2 Add the `AppDataContext` slices, exposed via `useAppData()`, on the `eventDraft`/`eventBanner`/`eventEdit` pattern.
    - `itemDraft` (fields + `locationId`).
    - `itemPhotos` (`File[]`).
    - `itemEdit {itemId, draft}`, seeded once per `itemId`.
  - [x] 10.3 Update `ItemCreateView` and `ItemQuickAddForm`/`itemQuickAdd.ts`.
    - Lift the state into `itemDraft`.
    - Render the required `LocationPicker` under Opis with the helper.
    - Prefill only while `itemDraft.locationId` is null and the draft is untouched.
    - Extend `fieldsMissing` and the hint text.
  - [x] 10.4 `useCreateItem` sends `location_id`.
    - `ItemCreateView` clears `itemDraft` + `itemPhotos` after success, before `navigate(itemPagePath, {replace: true})`.
  - [x] 10.5 Update `ItemEditView`/`ItemEditForm`.
    - The form state, including `locationId`, lives in `itemEdit`.
    - Add the required picker and the banner for a null `location_id`.
    - Validate on save.
    - Clear `itemEdit` on a successful save and on "Anuluj", before `done()`.
  - [x] 10.6 In `useItemEditing` (`hooks/useItemDetail.ts`), send a changed location via `updateInventoryItem(id, {location_id})`.
    - Then await invalidation of `ITEM_DETAILS_KEY` and `ITEM_ACTIONS_KEY`, and reload the panel's my-items list.
  - [x] 10.7 Ensure the Group 10 tests pass.
    - Run ONLY `npx vitest run src/test/ItemCreateView.test.tsx src/test/ItemEditView.test.tsx src/test/ItemQuickAddForm.test.tsx`.

**Acceptance Criteria:**
- The tests pass. History after the round trip has no `/places/new` entry.
- The `itemDraft`/`itemPhotos`/`itemEdit` clear points match the spec's Req. 30 table.
- Implementation matches each `acceptance` criterion declared above for `screen:item-create`, `screen:item-edit` and `component:location-picker-required`.

---

### Task Group 11: Term, First-Term Stepper, Event & Group Picker Hosts
**Dependencies:** 9
**Files to Modify:**
- Panel state: `src/frontend/src/features/panel/AppDataContext.tsx`, `src/frontend/src/features/panel/AppModals.tsx`
- Term, event and group forms: `src/frontend/src/features/terms/FirstTermStepperOrganizer.tsx`, `src/frontend/src/features/terms/TermEditForm.tsx`, `src/frontend/src/features/terms/TermEditView.tsx`, `src/frontend/src/features/terms/AddTermView.tsx`, `src/frontend/src/features/events/EventForm.tsx`, `src/frontend/src/features/groups/GroupFormFields.tsx`
- Tests: `src/frontend/src/test/FirstTermStepperOrganizer.test.tsx`, `src/frontend/src/test/TermEditForm.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-rzecz-obowi-zkowa-lokalizacja.html
  - element: component:location-picker-required
  - locator: the `.pick` block (select + `+` link) in panel "1 · wypełniony". This is the shared picker anatomy; these hosts use it in optional, non-`required` mode.
  - acceptance:
    - Term, event and group pickers render options by `label`, with the `+` link to `/places/new` (`replace`) and no inline add form.
    - The optional "none" option stays here, because place optionality on terms, events and groups is unchanged.

**Estimated Steps:** 5

- [x] 11.0 Complete the term, stepper, event and group picker hosts
  - [x] 11.1 Write up to 6 focused tests.
    - `FirstTermStepperOrganizer.test.tsx`:
      - reopens with the draft after a pick and after a cancel (`locationId: null`);
      - does not reopen twice for the same state object;
      - ✕ clears `firstTermDraft`, while `+` keeps it.
    - `TermEditForm.test.tsx`:
      - the draft survives a remount;
      - it is cleared on save and on cancel;
      - the page-mode picker has no inline form.
  - [x] 11.2 Add the `termEdit {termId, draft}` slice in `AppDataContext`, seeded once per `termId`.
    - `TermEditForm` reads and writes occursOn, description, locationId and capacity text there, in page mode.
    - Clear it on save or cancel (`onDone(saved)`) before `TermEditView` navigates.
    - Needed-item sub-CRUD stays immediate.
  - [x] 11.3 Add the `firstTermDraft` slice and the stepper wiring.
    - Reset the draft when the stepper is opened from its normal trigger.
    - `closeStepperForPlace()` sets `modal = null` and keeps the draft; it is used as the picker's `onAddClick`.
    - `closeStepper()` clears the draft (✕/Esc/backdrop/finish).
    - A reopen effect sets `modal = "pierwszy-termin"` when the state has `pickedLocation.picker === "first-term-place"` (id or `null`), with a `useRef` once-only guard on the state object.
  - [x] 11.4 Update `AddTermView`, `EventForm` and `GroupFormFields`.
    - Drop the `addMode`/`create` props.
    - Switch to `label` and the reworked `LocationRefResponse` types.
    - Keep the existing drafts and explicit navigation targets (`eventHref`, `/meetings`).
  - [x] 11.5 Ensure the Group 11 tests pass.
    - Run ONLY `npx vitest run src/test/FirstTermStepperOrganizer.test.tsx src/test/TermEditForm.test.tsx`.

**Acceptance Criteria:**
- The tests pass.
- The `termEdit`/`firstTermDraft` clear points match Req. 30, and the stepper reopens exactly once per handed-back state.
- Implementation matches the `acceptance` criteria declared above.

---

### Task Group 12: Item Page Location Card & Display Sites
**Dependencies:** 7
**Files to Modify:**
- Item page: `src/frontend/src/features/items/product/ItemContextActions.tsx`, `src/frontend/src/features/items/product/itemActionsViewState.ts`, `src/frontend/src/features/items/product/PersonalPickupSheet.tsx`
- Term and event display: `src/frontend/src/components/shared/TermPlaceLine.tsx`, `src/frontend/src/features/events/components/EventWhenCard.tsx`, `src/frontend/src/features/terms/components/TermCard.tsx`, `src/frontend/src/features/meetings/TermCards.tsx`, `src/frontend/src/features/terms/views/PublicTermView.tsx`
- Group, admin and metadata: `src/frontend/src/features/groups/GroupDetailsPage.tsx`, `src/frontend/src/features/groups/GroupsView.tsx`, `src/frontend/src/features/admin/AdminTermsPage.tsx`, `src/frontend/src/lib/publicMetadata.ts`
- Tests: `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/itemActionsViewState.test.ts`, `src/frontend/src/test/TermPlaceLine.test.tsx`, `src/frontend/src/test/publicMetadata.test.ts`, `src/frontend/src/test/GroupDetailsPage.test.tsx`, `src/frontend/src/test/AdminTermsPage.test.tsx`, `src/frontend/src/test/AppPage.test.tsx`, `src/frontend/src/test/OwnerMeetingsPage.test.tsx`

**Visual References:**
- mockup: analysis/design-context/mockups/strona-przedmiotu-blok-lokalizacji.html
  - element: screen:item-page-location
  - locator: `#mockup-content` (line 247), panels "1 · gość / inny użytkownik", "2 · właściciel", "3 · właściciel, miejsce usunięte".
  - acceptance:
    - One card titled "Lokalizacja przedmiotu" for every viewer, including anonymous: 📍 + bold `locality.name`, the detail line, and "Otwórz w Mapach" (Maps search on the locality query).
    - The owner additionally sees "Widoczne tylko dla Ciebie" + `formatted_address`, and the link "Zmień lokalizację" → `/items/:id/edit`.
    - The owner with a deleted place sees "{name} (usunięte)", no Maps link, and "Odbiór osobisty niedostępny — ustaw lokalizację" linking to edit. The same note shows when the owner has no location.
    - Non-owners of a deleted place see the plain locality + Maps link.

**Estimated Steps:** 7

- [x] 12.0 Complete the item page location card and display sites
  - [x] 12.1 Write up to 8 focused tests.
    - Item page location card (in `ItemDetailPage.test.tsx`): owner, other, anonymous and owner-deleted states, plus owner-no-location.
    - `itemActionsViewState.test.ts`: the reworked location shape (`it.each` rows).
    - `TermPlaceLine.test.tsx`:
      - bold locality, then the address or the detail line;
      - no notes;
      - the Maps rule (address + place id, else the locality query).
    - `publicMetadata.test.ts`: uses `label`.

    Use the Group 7 typed factories.
  - [x] 12.2 Update `ItemContextActions`.
    - Render the "Lokalizacja przedmiotu" card for all viewers per the mockup, with owner-only address, "Zmień lokalizację", "(usunięte)" and the pickup-unavailable note.
    - `PersonalPickupSheet` `locationName={choose.location.locality.name}`.
  - [x] 12.3 Update the `itemActionsViewState.ts` derivations for the new `ItemLocationResponse` (owner, deleted, none).
  - [x] 12.4 Update the term and event display sites.
    - `TermPlaceLine` and `EventWhenCard`: bold locality, the address or detail line, the Maps rule, and calendar export `groupName: location?.label`.
    - `TermCard`: `label` + a `buildMapsUrl` that follows the `TermPlaceLine` rule.
    - `TermCards`/`PublicTermView` type updates.
  - [x] 12.5 `GroupDetailsPage`, `GroupsView`, `AdminTermsPage` and `lib/publicMetadata.ts` use `label`.
    - `OwnerMeetingsPage` and `ChooseContextSheet` show the longer `location_name` unchanged, with no truncation.
  - [x] 12.6 Switch the remaining tests that build location objects inline to the typed factories: `GroupDetailsPage`, `AdminTermsPage`, `AppPage`, `ItemDetailPage`, `OwnerMeetingsPage`. Use `npm run typecheck` output to find the rest in these files.
  - [x] 12.7 Ensure the Group 12 tests pass.
    - Run ONLY `npx vitest run src/test/ItemDetailPage.test.tsx src/test/itemActionsViewState.test.ts src/test/TermPlaceLine.test.tsx src/test/publicMetadata.test.ts src/test/GroupDetailsPage.test.tsx src/test/AdminTermsPage.test.tsx src/test/AppPage.test.tsx src/test/OwnerMeetingsPage.test.tsx`.

**Acceptance Criteria:**
- The tests pass, and no display site reads `location.name`/`notes`.
- Implementation matches each `acceptance` criterion declared above for `screen:item-page-location`.

---

### Task Group 13: Documentation & Removal Audit
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
**Files to Modify:** `.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/models.md`, `.maister/docs/standards/backend/migrations.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 6

**Secrets:** never print secret values. Docs and runbooks reference env var names only, never values.

- [x] 13.0 Complete the documentation and removal audit
  - [x] 13.1 Define the removal checks: grep commands that must return no matches in `src/`.
    - `inventories/mine/location`, `InventoryLocationCard`, `useMyInventoryLocation`.
    - `getMyInventoryLocation`, `setMyInventoryLocation`.
    - `get_personal_inventory_live_location_id`, `find_personal_inventory_live_location_id`.
    - `InventoryLocationResponse`, `SetInventoryLocationRequest`.
    - `addMode` in `LocationPicker` and its hosts.
    - `Inventory.location_id` model use.
    - `GoogleAddressNotEditable`.
  - [x] 13.2 Update `architecture.md`.
    - The locality dictionary (`app/locations`, `GET /api/localities`).
    - Item location replacing the inventory location.
    - The listing-guard scope (DRAFT → ACTIVE only).
    - The item-location privacy scope.
    - The page-mode picker with `replace` on both legs and the `AppDataContext` draft slices.
    - The 0078–0080 runbook: a downgrade below 0080 deletes all places and item locations; 0079 is a TRUNCATE downgrade; the dictionary is refreshed with the script + a new data migration.
  - [x] 13.3 Update `models.md`.
    - The third string-PK carve-out (`Locality`/`LocalityPostalCode`).
    - `Location.locality` `lazy="raise"` with the `load_location`/`load_locations_by_ids` loaders, including the post-write reload.
    - ACL delegation to the loaders.
  - [x] 13.4 Update `migrations.md`: the gzipped CSV fixture + chunked `unnest` seed precedent (0079), the COPY fallback if adopted, and the `TRUNCATE` downgrade for dictionary data.
  - [x] 13.5 Refresh the `INDEX.md` summaries for `architecture.md`, `models.md` and `migrations.md`.
  - [x] 13.6 Run the 13.1 checks and confirm they are all clean. Fix any leftovers in the owning files, then re-run that group's tests.

**Acceptance Criteria:**
- Every removal grep is clean.
- The docs describe the dictionary, item location, runbook and standards precedents, and `INDEX.md` matches.

---

### Task Group 14: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
**Files to Modify:** `src/backend/tests/test_item_location.py`, `src/backend/tests/test_localities.py`, `src/backend/tests/test_locations.py`, `src/frontend/src/test/*.test.tsx`

**Secrets:** never print secret values. Test runs check configuration by presence only, with no env dumps.

- [x] 14.0 Review and fill critical gaps
  - [x] 14.1 Review the tests from Groups 1–12 (about 72) against the spec's Testing Approach list and Success Criteria.
  - [x] 14.2 Find the gaps for THIS feature only. Candidates:
    - SWAP clearing (only GIFT tested);
    - the `ssrSafety.test.tsx` `initialToken` case with the new item card;
    - the end-to-end contract between the frontend types and the backend key sets;
    - the cancelled-trip `null` pick on item create.
  - [x] 14.3 Write up to 10 additional strategic tests.
  - [x] 14.4 Run the feature tests and the static checks.
    - Backend: the feature test files from Groups 1–6, `uv run python -m mypy app` (≤15) and `uv run python -m ruff check app tests scripts`.
    - Frontend: the feature test files from Groups 7–12 + `ssrSafety.test.tsx`, `npm run typecheck` (clean) and `npm run lint`. The full `npx vitest run` must show no failures beyond the 12-failure baseline.

**Acceptance Criteria:**
- All feature tests pass (about 70–80 in total), with no more than 10 added.
- mypy ≤15, ruff clean (incl. `scripts/`), typecheck clean, and no new vitest failures beyond the baseline.

## Execution Order

1. Group 1: Locality Dictionary Data & Seed Migrations (10 steps)
2. Group 7: Frontend Location Contract — Types, API, Hooks & Fixtures (9 steps, no dependencies)
3. Group 2: Locations & Item-Location Schema Migration (5 steps, depends on 1)
4. Group 8: Place Form & Locality Combobox (7 steps, depends on 7)
5. Group 9: Required Page-Mode LocationPicker (7 steps, depends on 7)
6. Group 12: Item Page Location Card & Display Sites (7 steps, depends on 7)
7. Group 3: Localities Search & Locations API (11 steps, depends on 2)
8. Group 10: Item Create & Edit with Required Location and Drafts (7 steps, depends on 8, 9)
9. Group 11: Term, First-Term Stepper, Event & Group Picker Hosts (5 steps, depends on 9; shares `AppDataContext.tsx` with 10)
10. Group 4: Item Location in Circulation (9 steps, depends on 3)
11. Group 5: Item Page Privacy, Personal Pickup & Listing Guard (8 steps, depends on 4)
12. Group 6: Backend Shared Location Helpers Adoption (4 steps, depends on 4, 5)
13. Group 13: Documentation & Removal Audit (6 steps, depends on 1–12)
14. Group 14: Test Review & Gap Analysis (4 steps, depends on all)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: validation (Polish inline `role="alert"` errors, server-side checks), minimal-implementation (remove the inline picker mode, inventory location and dedup; no speculative districts or coordinates), error-handling, conventions, coding-style, commenting.
- `backend/`:
  - `models.md`: the string-PK carve-out, `lazy="raise"` + explicit `joinedload`, ACL-only cross-context access with 404 before 403, safe-by-default visibility.
  - `migrations.md`: names, `SET LOCAL lock_timeout`, reverse-order downgrades, round-trip tests that restore head.
  - `queries.md`/`jooq.md`: bound params, `autoescape`, SQL LIMIT, explicit ordering, no N+1.
  - `security.md`: matrix rows, personalised cache headers.
  - `api.md`: plural `/api/localities`, PUT.
  - `time.md`.
- `frontend/`:
  - `components.md`: routing facade only, `replace` via `NavigateOptions`/`Link`, drafts in `AppDataContext`, no browser globals in render.
  - `accessibility.md`: inline combobox rules, `aria-disabled` + hint, `aria-invalid`/`aria-describedby`.
  - `data-fetching.md`: `useLocalitySearch` prefix key, mutations passed as props, awaited invalidation.
  - `css.md`, `responsive.md`.
- `testing/`:
  - `backend-testing.md`: exact key sets, per-test helpers, `count_queries`, migration tests restoring head.
  - `frontend-testing.md`: typed factories with no casts, `renderWithRoute`/`getTestRouter()`, explicit vitest imports.

## Notes

- **Test-driven:** each group starts with 2–8 focused tests.
- **Run incrementally:** run only the group's tests after each group. The full suite runs in Group 14.
- **Mark progress:** check off steps as they are completed.
- **Reuse first:**
  - `0069_vinted_categories.py` + README pattern;
  - `0075_inventory_location.py` shape;
  - the `LocationAddForm` combobox mechanics;
  - `handledPick`, `placeCreatePath`;
  - the `eventDraft`/`eventEdit` slices;
  - `set_personalised_cache_headers`;
  - `leaf_category_ids` helper style.
- **No commit, push or PR steps.** Leave the work uncommitted, per the user's preference.
- **Never print secret values** (no `env`/`printenv`/`.env` dumps). Check presence only.
