# Specification: "Szukam" (wanted) mechanism

## TL;DR
- Build the private, seeker-owned want end to end: backend module `app/wants` (tables `wants`, `want_matches`, `want_scan_markers`, migration 0099), one match statement used at want creation and by a 15-minute marker scan, two in-app notification kinds, `/api/wants`, and the frontend `features/wanted` replacing the `/wanted` and `/add/hunting` demo.
- Every product and architecture decision is taken from the sources listed in `analysis/requirements.md`; where the codebase analysis "Corrected" table (X1-X16) differs from the high-level design, the correction is specified.
- Foreign modules change minimally: annotations in groups, 2 moderation fields, 2 notification kinds + 1 batch writer, 2 authorization rows, wiring in `app/main.py`.
- The 8 approved mockups are binding for layout, Polish copy, field order and states; 11 design ids are mapped to requirements.
- Release gate: merge is allowed, deployment is not, until the labelled Polish sample is scored (follow-up task). This task measures cost only (`EXPLAIN ANALYZE`).

## Key Decisions
- Trigram branch = `name_folded <% fold_pl(p.name)` AND `word_similarity(...) >= CASE` — the operator is the only form that uses `ix_products_name_trgm` (X1).
- Bell row = delete the unread row, insert a new one with the summed count, in one batch writer — an in-place update breaks "`created_at` set once" and races `mark_read` (X2, Phase 1 answer 2).
- Scan entry point takes `now`; the scheduler wrapper catches `StaleDataError` itself — nothing freezes `datetime.utcnow()`, and jobs have no HTTP handler (X3, key decision of the codebase analysis).
- "Tylko tu" is stored as null; CHECK allows 1-100; the API turns 0 into null (I1).
- Counters (`match_count`, `new_match_count`) go through the same read-time filter as the match list (I3).
- A foreign or withdrawn want is 404 through an own Polish `WantNotFound`; the want is always selected by `(id, seeker_party_id)` (X9, I4).
- Authorization rows copy conversations (login token only), not notifications (P11).
- Closing prompt is owned by `ItemPickupActions`, shown after a personal or term/event take only, never stacked on `TakeSuccessSheet`, and closes every returned want (Phase 1 answer 3, I6, I7).
- No feature switch; the release gate is a written rule in `architecture.md` (I13).
- `short_words_query` is built in SQL in the write statement from the lexemes of `to_tsvector('simple'::regconfig, fold_pl(:name))` of length up to 3 — a Python split cannot reproduce the parser (audit H1).
- Every set-based `UPDATE` of `wants` in the scan and sweep also sets `updated_at`, so a concurrent ORM write gets the existing 409 (audit H2).
- Pairs already stored are excluded before the top-20 ranking (audit M1).
- Contact-details message: the existing `CONTACT_INFO_MESSAGE`, verbatim (user decision; the mockup shortens it).
- Match cards keep the intent labels `ItemCard` renders today; only the marker slot and the captions are new (user decision).
- Empty-search state: only the prompt block changes; heading, body and the scope-"mine" suffix stay as today (user decision).
- The want form shows only the locality field and the radius chips; it shares with search only the radius chips and the chip style constants; its offer-mode chips are its own (user decision, audit M6).
- The API returns `category_name` and `category_path`; the list card shows the node name, the match page the full path; no category-tree load for display (user decision, audit M8).

## Open Questions / Risks
Undecided points. Each has a stated default so planning is not blocked; none of the defaults reopens a decision. (OQ2, OQ3 and OQ4 were decided by the user and moved to Key Decisions; the ids are not reused.)

| # | Question | Default used in this spec |
|---|---|---|
| OQ1 | Statement timeout on the scan job. The design's risk table names one; X13 notes it would be a first; the requirements are silent. | No statement timeout on the scan (workable: the app runs a single uvicorn process). |
| OQ5 | UI details no mockup shows: the FULFILLED state of `/wanted/:id`; `/wanted/:id/edit` opened for a non-ACTIVE want; where "Znalezione — zamknij" leads; when "Przedłuż o 90 dni" is the primary action; the target of the "‹ Szukaj" back link; which number the "Konto" row shows; the order of the list and the secondary order of the match list; plural forms and the close-sheet label for 3+ wants. | Listed per item in "Frontend" (marked "default"). |
| OQ6 | API details the design left open: bodies of the action routes, `opened` for an unknown pair, the `locality_name` field, the definition of `score`, and every Polish message marked "to confirm". | Listed per item in "API" and "Data model" (marked "default" / "to confirm"). |

Risks:
- Short Polish prepositions are mandatory. The `'simple'` configuration has no stop words, so "dla", "na", "do", "od", "po", "ze" are required exact tokens in the trigram branch and required words in the full-text branch. The form's own placeholder "Np. kask rowerowy dla dziecka" would not match a listing "Kask rowerowy dziecięcy". The rule stands; the labelled sample must include such names.
- Reverse-scan cost. There is no index on the want side, so the largest measured point is 500 listings × 10,000 wants = 5 million pairs, each evaluating `fold_pl(p.name)` up to twice. The auditor estimates the 2 s budget fails there; FR-T-30 will show, and names the first lever.
- Stale pairs after a concurrent edit. A scan statement that started before a PATCH commits can store pairs for the old name after the PATCH reset; the window is one statement long. Accepted.
- The match list is unbounded in v1 (no limit, no paging): pairs accumulate at up to 20 per run for 90 days.
- After more than 30 days of downtime a want is expired and purged in the same run, so the seeker never sees the expired state; the reminder says "za 7 dni" whatever the real remainder. Accepted.
- Thresholds 0.70 / 0.60 are starting values, unmeasured at the end of this task (release gate).
- Two unrun checks decide details in implementation: a generated stored `tsquery` column on PostgreSQL 18 (fallback: application-written column) and `EXPLAIN (ANALYZE, BUFFERS)` of the match statement in both directions (decides the `item_listing_preferences.created_at` index).
- Pre-existing failing tests (24 Vitest, 5 typecheck, 2 backend per project memory) sit partly in files this task edits; without the baseline a regression cannot be told from an old failure.
- The "Konto" prefix match changes pages outside wants (`/places/...`, `/groups/:id`, `/family/...`); their tests need a look.
- A scan run and a seeker's write can race on the want's version column; because the scan's set-based updates set `updated_at` (FR-S-07), the user then gets the existing 409 "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie".
- A downgrade of 0099 or an image-only rollback breaks the bell while rows of the two new kinds exist (runbook step).
- A deleted category sets `wants.category_id` to null and silently moves the want to the strict threshold; `wants.seeker_party_id` has no ON DELETE rule (future account deletion must handle wants).
- Items that become takeable after their listing time are never matched; delivery is in-app only (accepted costs, ADR-005, ADR-009).

## Goal
Let a logged-in user save what they are looking for and be told in the app when a matching item is listed, using the existing take / propose flow to complete the exchange.

## User Stories
- As a seeker, I want to save a want from the `/add` tile so that I am told when someone lists a matching item.
- As a seeker whose search found nothing, I want to turn that search (text and filters) into a want without retyping so that the search keeps working for me.
- As a guest with an empty search, I want to log in or register and land on the prefilled form so that I do not lose my query.
- As a seeker, I want to see existing matches right after saving so that I can act at once.
- As a seeker, I want one bell row per want with a count, and a counter on the tile and the "Konto" row, so that the bell is not flooded.
- As a seeker, I want to mute, edit, extend, close, withdraw and resume a want so that the list reflects what I still need.
- As a seeker who just took a matched item, I want to be asked whether to close the want so that I stop getting alerts.
- As a seeker, I want a reminder before a want expires so that it does not vanish silently.

## Core Requirements
1. A logged-in user creates a want: name (required), optional category, offer mode, locality with radius, private note; notifications on by default.
2. Saving shows the want's existing matches at once, with no notification and no counter.
3. Listings created later are matched by a scan every 15 minutes; the seeker gets at most one unread bell row per want.
4. The seeker sees their wants with match counts, new-match counts and expiry on `/wanted`.
5. The seeker opens a want on `/wanted/:id`: filters, note, notification toggle, matched items (new ones marked, reserved ones captioned), actions.
6. The seeker edits a want; changing a matching field searches again from scratch.
7. A want lives 90 days, is reminded 7 days before the end, can be extended, closed as found, withdrawn, resumed or reopened; closed wants are deleted after 30 days.
8. At most 30 active wants per user.
9. Name and note pass the contact-details rule and the text classifier.
10. After a personal or term/event take of a matched item the item page offers to close the matching wants.
11. Three entry points: the `/add` tile (with new-match count), the "Konto" row (with real counts), the empty-search prompt (forwarding the query and filters).

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: layout, Polish copy, field order and the listed states are binding; icons are placeholder glyphs (use `components/shared/appIcons.tsx`); tokens and shared components as in `analysis/design-context/design-resources.md`.

| ID | Mockup | Key elements | Requirements |
|---|---|---|---|
| screen:wanted-list | `analysis/design-context/mockups/wanted-list.html` | Back "‹ Konto"; h1 "Szukam"; "+ Dodaj"; intro "Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz."; want cards (name link, filter summary, "N nowe" pill, match band, expiry hint with "Przedłuż"); expired row with "Wznów"; fulfilled row with "Szukam znowu"; empty state "Czego potrzebujesz?" with "+ Dodaj poszukiwanie" | FR-F-10..15, FR-A-01 |
| screen:wanted-form | `analysis/design-context/mockups/wanted-form.html` | `/add/wanted` empty, prefilled with "Doprecyzuj" expanded, `/wanted/:id/edit`; fields in order: name, disclosure, category, offer-mode chips, locality + radius chips, note; "Zapisz poszukiwanie" / "Zapisz zmiany" + "Anuluj" | FR-F-20..29, FR-W-01..06 |
| screen:wanted-form-errors | `analysis/design-context/mockups/wanted-form-errors.html` | Prefilled name outside 3-80 with inline error and blocked submit; 409 limit with "Zobacz listę"; contact-details / moderation / 503 messages in a `role="alert"` block | FR-F-24, FR-F-27, FR-W-07..09, FR-A-20 |
| screen:wanted-matches | `analysis/design-context/mockups/wanted-matches.html` | Back "‹ Szukam", "Edytuj"; name; filter line with full category path; "Notatka: ..."; toggle row; "N pasujących rzeczy"; card grid; "Ważne jeszcze N dni"; "Znalezione — zamknij", "Przedłuż", "Wycofaj" | FR-F-30..38, FR-A-08 |
| screen:wanted-matches-states | `analysis/design-context/mockups/wanted-matches-states.html` | No matches ("Jeszcze nic nie pasuje"); expired with "Wznów na 90 dni"; withdraw confirmation; own not-found state linking to `/wanted` | FR-F-33..37, FR-L-03..06 |
| component:close-want-sheet | `analysis/design-context/mockups/close-want-sheet.html` | `ModalSheet` "Znalezione?" for one want and for several; "Zamknij poszukiwanie" / "Zamknij oba poszukiwania" / "Szukam dalej"; retention hint | FR-F-50..55 |
| component:want-disclosure | `analysis/design-context/mockups/wanted-form.html` | Button "Doprecyzuj (opcjonalnie)" with `aria-expanded`, `aria-controls`, `aria-hidden` ▸/▾ | FR-F-22 |
| component:want-notification-toggle | `analysis/design-context/mockups/wanted-matches.html` | Row "Powiadomienia o nowych rzeczach", sub-text "Damy znać w dzwonku" / "Wyłączone", `role="switch"`, saved at once | FR-F-32, FR-A-04 |
| component:match-card | `analysis/design-context/mockups/wanted-matches.html` | `ItemCard` with a "nowe" marker; captions "Zarezerwowane przez Ciebie", "Twoja propozycja", "Zarezerwowane" | FR-F-34, FR-F-60, FR-A-08 |
| component:entry-points | `analysis/design-context/mockups/entry-points.html` | `/add` tile with "N nowe"; "Konto" row "N rzeczy · M nowe dopasowania"; empty-search prompt "Damy znać, gdy ktoś doda pasującą rzecz." + "Dodaj do listy „Szukam”" | FR-F-40..43 |
| component:bell-rows | `analysis/design-context/mockups/bell-rows.html` | One match naming the item; several matches with a count; expiry reminder | FR-N-03..05 |

## Reusable Components

Backend paths are relative to `src/backend/`, frontend paths to `src/frontend/src/`.

### Existing Code to Leverage

| What | Path | Use |
|---|---|---|
| Module layering and ACL shape | `app/search/` (`application/`, `domain/`, `infrastructure/*_acl.py`, `router/`, `schemas.py`), `app/pages/` | Layout of `app/wants`; one ACL per foreign module, no `..schemas` import |
| Model style | `app/events/models.py`, `app/core/base_model.py` | `BaseEntity`, `_enum_column`, business-key equality |
| Scan and sweep | `app/groups/application/term_end_scan.py`, `app/media/service.py:188-222` | Marker + one commit + one log line; set-based `DELETE ... RETURNING` |
| Count cap with 409 | `app/media/service.py:288-302` | Cap of 30 counted in the write transaction |
| Polish 404 / 409 subclasses | `app/events/service.py:33-104` | `WantNotFound`, conflict exceptions |
| PATCH through `model_fields_set` | `app/events/service.py:234-266` | `PATCH /api/wants/{id}` |
| Logged-in-only router | `app/messaging/router.py:33-37`, `app/messaging/infrastructure/users_acl.py:25-32` | `require_any("READ")` / `require_any("EDIT")`; 401 on a missing profile |
| Statement timeout to 503 | `app/search/application/search.py:99-103,890-921` | `SET LOCAL statement_timeout = '3s'`, sqlstate 57014 |
| Text, category and distance recipes | `app/search/application/search.py:183-394` | Column-form copies (not imports) of the haversine, category subtree and card inputs; the category-only branch is NOT copied (X14) |
| Visibility predicates | `app/groups/infrastructure/visibility.py:41-59,91-108`, `membership.py` | `owner_shares_group_with` (match time), `items_visible_to` (read time) |
| Listed-items select, pending proposer | `app/inventory/infrastructure/repository.py:269-314`, `app/groups/infrastructure/repository.py:938-963` | Takeability; `reserved_by_user_id` for "reserved by me" |
| Photos and slugs | `app/product/service.py:328`, `app/organizations/service.py:113`, `app/groups/domain/organizer_slug.py:36` | First approved photo batch; organization slug batch; `derive_party_slug` |
| Moderation | `app/moderation/rules.py:34`, `app/moderation/text_guard.py` | `ensure_no_contact_info`, `check_text` |
| Notifications | `app/notifications/service.py`, `app/groups/infrastructure/notifications_bridge.py` | `create_notification`; writer-ACL template |
| Link builder | `app/search/domain/links.py` | Shape of `product_path` |
| Clock helper | `app/core/clock.py` (`fit_notification_message`) | Message cap of 500 |
| Migration templates | `alembic/versions/0082_media.py`, `0070_events.py`, `0088` (generated column), `0063` (delete rows of a kind) | Hand-written 0099 |
| Test templates | `tests/conftest.py` (`count_queries`, `leaf_category_ids`, locality helpers), `tests/test_term_end_scan.py`, `tests/test_media_sweep.py`, `tests/test_search_api.py`, `tests/test_search_location.py`, `tests/test_visible_to.py`, `tests/test_locality_coordinates_migration.py` | Patterns and known distances |
| Private list hook | `hooks/useMyLocations.ts` | `useWants` (token in the key, mutations, awaited invalidation) |
| Detail hook with not-found | `hooks/useEvent.ts` | `useWantMatches` |
| View-state pattern | `features/terms/termViewState.ts`, `features/search/searchViewState.ts` | `resolve...View()` per page |
| Form patterns | `features/items/ItemCreateView.tsx`, `features/places/PlaceEditView.tsx` | `aria-disabled` submit with hint; toast then navigate |
| Shared UI | `components/shared/ItemCard.tsx`, `ItemTileBadges.tsx`, `ModalSheet.tsx`, `ConfirmDeleteDialog.tsx`, `CategoryTreePicker.tsx`, `LocalityCombobox.tsx`, `openSheets.ts`, `appIcons.tsx`; `hooks/useLocality.ts`, `hooks/useCategories.ts` | Match cards, sheets, pickers |
| Filter controls | `features/search/SearchFilters.tsx` (radius chips inside `LocationSection` L196-208, style constants L30-34), `features/search/useSearchUrlState.ts` (`SEARCH_RADII_KM`) | Only the radius chips and the chip style constants are extracted and shared; the rest of `LocationSection`, `MajorTownPicker` and the offer toggles stay private to search |
| Take flow | `features/product/useItemTake.ts`, `features/product/blocks/ItemPickupActions.tsx`, `features/product/TakeSuccessSheet.tsx` | Closing prompt hook-in; "Zobacz rzecz" also closes the sheet |
| Dates | `utils/dayjs.ts` (UTC plugin, as `features/messages/messageTime.ts`) | Naive-UTC want timestamps |

### New Components Required

| Component | Why existing code cannot serve |
|---|---|
| `app/wants/` (models, schemas, router, application: writes, reads, matcher, scan; domain: limits, thresholds, state machine, `links.py`; nine ACLs: groups, inventory, product, category, locations, users, organizations, moderation, notifications) | No module owns standing demand; `app/search` is read-only and importable only from `app/main.py`; `app/groups` is group-centred (ADR-004) |
| Match statement with column forms of haversine, category ancestry and group sharing | Search binds viewer, radius and origin as Python values and handles one category node; a set statement needs columns (ADR-006) |
| `app/wants/domain/links.py` (`product_path`, `want_path`) | `item_links.item_path` runs several statements per item; `app.search` may not be imported (X7) |
| Batch delete-unread-then-insert writer and a delete-only function in `app.notifications` | `create_notification` returns nothing and cannot replace a row; the module has no delete path (X2) |
| Migration `0099` | New tables; autogenerate is not wired (`alembic/env.py`, X15) |
| `features/wanted/` (list, form, match list, closing sheet, view states), `api/wants.ts`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`, `test/fixtures/wants.ts` | The demo views keep local state and store nothing |
| Shared radius chips and chip style constants (extracted); the form's own exclusive offer-mode chips | The radius chips are private to `SearchFilters.tsx` today (X12); search's offer toggles ("Oddam" / "Zamienię", switch off) have little in common with the form's three exclusive chips |
| "Doprecyzuj" disclosure | No disclosure-button pattern exists outside the admin tree |

## Technical Approach

### Module `app/wants`
- **FR-X-01** Layout as `app/search` / `app/pages` plus `models.py` in the `app/events` style. `__init__.py` states the boundary. Only `app/main.py` imports `app.wants` (router and scan function). `app/wants` imports only `app.core`, `app.db`, `app.storage` and itself outside `infrastructure/`.
- **FR-X-02** One ACL file per foreign module, each the only importer of that module, none importing `..schemas`. Contents: `groups_acl` (`ItemListingPreference`, `ItemVisibility`, `items_visible_to`, `owner_shares_group_with`, `with_pending_proposer`, `VisibilityScope`, `derive_party_slug`, `SwapProposal`, `SwapProposalStatus`), `inventory_acl` (`listed_items_with_product_select`, `InventoryItem`, `BalanceStatus`, `ItemCondition`, `newest_open_reservation_starts_at`), `product_acl` (`Product`, `first_approved_photo_by_product`), `category_acl` (`Category`), `locations_acl` (`Locality`, `Location`), `users_acl` (profile by principal giving `party_id` and `account_user_id`; 401 on a missing profile), `organizations_acl` (`get_own_organizations_by_party_ids`), `moderation_acl` (`check_text`, `TextField`, `ensure_no_contact_info`), `notifications_acl` (`create_notification`, the new writer, `NotificationKind`). Offer modes are the plain strings `"GIFT"` / `"SWAP"`. `schemas.py` imports foreign types (`ItemCondition`, the exchange-mode type) only through the module's own ACL files, as `app/search/schemas.py` does.
- **FR-X-03** Limits, thresholds, intervals, the status enum and the state machine are constants and pure functions in `app/wants/domain/` (files there may import only `app.wants.domain`, so the enum is defined there and `models.py` imports it): name 3-80, note 300, cap 30, top 20, validity 90 days, reminder 7 days, retention 30 days, auto-extension window 30 days, scan interval 15 minutes, overlap 5 minutes, thresholds 0.70 / 0.60, forward statement timeout 3 s.
- **FR-X-04** All wants time columns are naive UTC written with `datetime.utcnow()` (or the `now` passed to the scan). No `datetime.now()` / `date.today()`.

### Data model

All three tables use `BaseEntity` (UUID `id` with `gen_random_uuid()` server default, `created_at`, `updated_at` as version column). Set-based inserts (`INSERT ... SELECT` into `want_matches`, the batched notification insert) must not rely on Python-side column defaults: an `INSERT ... SELECT` is built with `include_defaults=False` and its select supplies `gen_random_uuid()`, `created_at` and `updated_at` explicitly (with the default `include_defaults=True` the `uuid4` default is evaluated once per statement and every row gets the same id). Hard delete; no `deleted_at`.

**FR-D-01 `wants`**

| Column | Type | Null | Notes |
|---|---|---|---|
| `seeker_party_id` | UUID | no | FK `parties.id`, `fk_wants_seeker_party_id_parties`; plain FK-id column, no `relationship()`, no ON DELETE rule |
| `name` | VARCHAR(80) | no | 3-80 code points after trim |
| `note` | VARCHAR(300) | yes | Not matched; seeker only |
| `category_id` | UUID | yes | FK `categories.id` ON DELETE SET NULL, `fk_wants_category_id_categories`; any node |
| `offer_mode` | VARCHAR(20) | yes | `GIFT`, `SWAP` or null ("Obojętnie") |
| `locality_id` | VARCHAR(7) | yes | FK `localities.id` ON DELETE RESTRICT, `fk_wants_locality_id_localities` |
| `radius_km` | SMALLINT | yes | null = "Tylko tu"; else 1-100; only with a locality |
| `notifications_enabled` | BOOLEAN | no | Default true |
| `status` | VARCHAR(20) | no | String-backed enum `ACTIVE`, `FULFILLED`, `WITHDRAWN`, `EXPIRED` |
| `expires_at` | TIMESTAMP | no | Creation / extension / resumption time + 90 days |
| `closed_at` | TIMESTAMP | yes | Set when the want leaves `ACTIVE`; starts the 30 days |
| `reminded_at` | TIMESTAMP | yes | Marker of the 7-day reminder; cleared on extension, resume, reopen |
| `name_folded` | TEXT, generated stored | no | `fold_pl(name)` |
| `name_query` | TSQUERY, generated stored | no | `plainto_tsquery('simple'::regconfig, fold_pl(name))` (two-argument form; the one-argument form is not immutable). Fallback if PostgreSQL 18 refuses: application-written column |
| `short_words_query` | TSQUERY | yes | All-words query of the name's tokens of up to 3 characters; null when there are none. Built in SQL in the statement that writes the name (FR-W-10), never in Python |
| `match_notification_id` | UUID | yes | Loose pointer (no FK) to the newest match bell row of this want |
| `match_notification_count` | INTEGER | no | Default 0; the count shown in that row |

Constraints and indexes: `pk_wants`; `ck_wants_radius_requires_locality` (`radius_km IS NULL OR (locality_id IS NOT NULL AND radius_km BETWEEN 1 AND 100)`); `ck_wants_closed_at_matches_status` (`(status = 'ACTIVE') = (closed_at IS NULL)`); `ix_wants_seeker_party_id_status` on `(seeker_party_id, status)`; `ix_wants_active_expires_at` on `(expires_at)` where `status = 'ACTIVE'`; `ix_wants_closed_at` on `(closed_at)` where `status <> 'ACTIVE'`. No text index on the want side. Model side: generated columns as `Computed(..., persisted=True)`, deferred with `deferred_raiseload=True`.

**FR-D-02 `want_matches`**

| Column | Type | Null | Notes |
|---|---|---|---|
| `want_id` | UUID | no | FK `wants.id` ON DELETE CASCADE, `fk_want_matches_want_id_wants` |
| `item_id` | UUID | no | Loose pointer to an inventory item, no FK |
| `source` | VARCHAR(10) | no | `FORWARD` or `SCAN` |
| `score` | REAL | no | Text score at match time (default, OQ6: `word_similarity(name_folded, fold_pl(product name))` for every stored pair, whichever branch matched) |
| `seen_at` | TIMESTAMP | yes | null = new; `FORWARD` rows are born seen |
| `opened_at` | TIMESTAMP | yes | First open from the match list; measurement only |

Constraints and indexes: `pk_want_matches`; `uq_want_matches_want_id_item_id`; `ix_want_matches_item_id`.

**FR-D-03 `want_scan_markers`**: `scan_name` VARCHAR(30) not null with `uq_want_scan_markers_scan_name`; `scanned_through` TIMESTAMP not null (naive UTC). One row, `listings`, created by the first scan run; no seed.

### Migration 0099 and rollback
- **FR-D-04** One hand-written schema revision `0099_*` (template `0082_media.py` / `0070_events.py`), after head 0098. `SET LOCAL lock_timeout = '5s'` first in upgrade and downgrade. Generated columns added by raw `ALTER TABLE ... GENERATED ALWAYS AS (...) STORED`. No data revision. No new extension.
- **FR-D-05** Downgrade drops `want_matches`, `want_scan_markers`, `wants` in that order (indexes and FKs before tables). It is lossy and unguarded: no ledger row depends on a want.
- **FR-D-06** The `item_listing_preferences.created_at` index is NOT part of 0099. If the measurement (FR-T-30) shows it is needed, it is a separate revision with a concurrent build inside `autocommit_block()`.
- **FR-D-07** Runbook (in `architecture.md`): before a downgrade of 0099 or an image-only rollback, delete `notifications` rows of kinds `WANT_MATCH_FOUND` and `WANT_EXPIRING` (old code cannot load an unknown kind; precedent 0063). The two generated `wants` columns join the list of columns to DROP / ADD when `fold_pl` changes.

### Matching

**FR-M-01** One statement builder serves both directions; it inserts into `want_matches` with `ON CONFLICT (want_id, item_id) DO NOTHING` and returns the inserted `(want_id, item_id)` pairs. The insert follows the set-based insert rule of the data model (`include_defaults=False`, explicit `gen_random_uuid()`, `created_at`, `updated_at`).

| Direction | Filter | `source` | `seen_at` | Notification |
|---|---|---|---|---|
| Forward (create, matching-field edit, resume, reopen) | one want id | `FORWARD` | now | none |
| Reverse (scan) | `item_listing_preferences.created_at > marker - 5 min AND <= now` | `SCAN` | null | grouped per want |

**FR-M-02** Base rows: `wants` joined to `item_listing_preferences` (joined UNALIASED, because `owner_shares_group_with` is fixed over `ItemListingPreference.owner_party_id`), to the listed-items select, to `products`, to `inventory_items`, to a live `locations` row and its `localities` row, and (left) to the want's locality. Only wants with `status = 'ACTIVE'` and `expires_at > now`.

**FR-M-03** Predicates, all required:

| Predicate | Rule |
|---|---|
| Own items | `owner_party_id <> seeker_party_id` |
| Takeable | balance `AVAILABLE`, no pending swap proposal (`proposer_party_id IS NULL` over `with_pending_proposer`), and the item's own place exists with `deleted_at IS NULL`. Shared terms and events are not checked (P4) |
| Visibility | listing `PUBLIC`, or `PRIVATE` and `owner_shares_group_with(<seeker column>, private_only=True)` (live PRIVATE group shared by owner and seeker). PRIVATE inclusion is explicit |
| Offer mode | want's mode null, or equal to the listing mode |
| Category | want's category null, or the product's category is that node or a descendant. Narrows only; never a match on its own |
| Locality | want's locality null; or the item place's locality equals it; or, when `radius_km` is set, the haversine distance between the two locality points is at most the radius. When either point is null the rule is "same locality" only |
| Text (always required) | full text: `products.search_vector @@ name_query`; OR trigram: `name_folded <% fold_pl(product name)` (indexable pre-filter) AND `word_similarity(name_folded, fold_pl(product name)) >=` 0.70 when the want has no category, 0.60 when it has one, AND (`short_words_query` is null OR `products.search_vector @@ short_words_query`) |

**FR-M-04** Ranking and limit: pairs already stored for the want are excluded first (an anti-join on `want_matches` before `row_number()`); of the remaining candidates, per want, per run, the 20 best by score descending, then newest listing (`item_listing_preferences.created_at` descending) are inserted. A resume, reopen or matching-field edit therefore adds up to 20 pairs that are not stored yet.

**FR-M-05** Explicitly NOT matched: the seeker's own item; a PRIVATE item without a shared live PRIVATE group (a soft-deleted group or a PUBLIC-only shared group does not count; RSVP never counts); an item that is reserved, in transit or under a pending proposal; an item whose place is missing or soft-deleted; a category-only hit with no text signal; a short word (up to 3 characters) by trigram alone; condition (not a want field). Never re-matched by the scan: a released reservation, a rejected proposal, PRIVATE turned PUBLIC, a changed offer mode, an edited product or place, a seeker who joined a group. Such pairs appear only when the item is listed again or the seeker edits, resumes or reopens the want. A pair that fell outside the top 20 of a run is not excluded for good: because stored pairs are removed before the ranking, a later run picks it up while its listing is still inside the window (the 5-minute overlap, or a longer window after downtime), and so does any forward match; once its listing has left the window, only a forward match can store it.

**FR-M-06** Forward match runs inside the write transaction under `SET LOCAL statement_timeout = '3s'`. A statement cancelled with sqlstate 57014 rolls the transaction back and answers 503; nothing is saved.

**FR-M-07** Read-time check: the match list and the counters join stored pairs to the current state: the item must still be listed, visible to the seeker (`items_visible_to` with the seeker as viewer) and not owned by the seeker (`owner_party_id <> seeker_party_id`; `items_visible_to` has an own-item branch, and after a GIFT hand-over the seeker may list the item again). Gone items are left out; reserved items stay, after available ones.

### Scan job

**FR-S-01** Entry point `scan_wants(db, *, now=None)` in `app/wants/application/`; `now` defaults to `datetime.utcnow()` and is used for every time comparison and write of the run. Registered in `app/main.py` on the existing `AsyncIOScheduler` with a 15-minute interval constant.

**FR-S-02** Order of steps, one transaction, one commit:
1. Sweep - expire: `ACTIVE` wants with `expires_at <= now` become `EXPIRED`, `closed_at = expires_at`.
2. Sweep - remind: `ACTIVE` wants with `expires_at` within 7 days and `reminded_at` null get `reminded_at = now` and one `WANT_EXPIRING` row each, regardless of `notifications_enabled`.
3. Sweep - purge: wants with `status <> 'ACTIVE'` and `closed_at` older than 30 days are deleted; their matches cascade. An active want is never deleted. Bell rows of purged wants are left.
4. Read the marker row (an ORM entity, so its `updated_at` version column is checked on write). No row: the first window starts one interval plus the overlap (15 + 5 minutes) before `now`, and the row is created.
5. Reverse match over the window `(scanned_through - 5 min, now]`.
6. Notifications for wants with newly inserted pairs and `notifications_enabled` (FR-N-03..06); pointer and count updated on the want.
7. Marker: `scanned_through = now`.
8. Commit.

**FR-S-03** Idempotency: a pair already stored is skipped by the unique key, so the overlap, a retry or a second process creates no second pair and no second notification. After downtime the window is longer; the top-20 cap bounds the result. Both insert paths of the listing row (`set_item_listing_preference` and `list_registered_item`) are seen.

**FR-S-04** Error handling: the job wrapper in `app/main.py` catches `StaleDataError` (a lost race on the marker's version column) and, for a lost first-run race, the `IntegrityError` on `uq_want_scan_markers_scan_name`; it logs and rolls back, and the run is skipped as a whole. Other exceptions propagate as for the existing jobs.

**FR-S-05** Logging: one line per run with window start and end, listings in the window, active wants, pairs stored, notifications written, wants expired / reminded / purged and duration; INFO only when the run did work, DEBUG otherwise.

**FR-S-06** Statement budget: constant in the number of wants, listings and matches; target at most 16 statements per run. Per-want work uses set statements or one multi-row write, never a loop of reads. Slugs for links are batched.

**FR-S-07** Every set-based `UPDATE` of `wants` in the scan and the sweep (expire, remind, pointer and count) also sets `updated_at = now`. A Core `UPDATE` does not run the version generator, so without this a concurrent ORM write (PATCH, extend, close, resume) would see no conflict and could orphan a bell row or leave an `EXPIRED` want with a future `expires_at`; with it the ORM write raises `StaleDataError` and the user gets the existing 409.

**FR-S-08** Accepted edge cases: after more than 30 days of downtime a want is expired and purged in the same run; the reminder text says "za 7 dni" whatever the real remainder; a scan statement that started before a PATCH commits can store pairs for the old name after the reset.

### Notifications

**FR-N-01** `NotificationKind` gains `WANT_MATCH_FOUND` and `WANT_EXPIRING` (no migration: non-native VARCHAR(30)). The recipient is the seeker's party (`wants.seeker_party_id`); no party-to-user lookup.

**FR-N-02** `app.notifications.service` gains one batch writer (exported in `__all__`): given a list of entries (recipient party, kind, message, link, the id of a previous row or none), it deletes the previous rows that are still unread with one `DELETE ... WHERE id IN (...) AND read_at IS NULL RETURNING id`, inserts the new rows with explicit ids in one batched `INSERT`, and returns the new ids together with which previous rows were deleted. It does not flush or commit beyond its two statements. The batched insert supplies `id`, `created_at` and `updated_at` explicitly (set-based insert rule of the data model). It is the module's first delete path.

**FR-N-09** `app.notifications.service` gains a second exported function, delete-only: given notification ids, it deletes those that are still unread (`read_at IS NULL`) in one statement and returns the deleted ids. No insert, no commit.

**FR-N-03** At most one unread match row per want. For each want with new pairs in a run and the switch on: if `match_notification_id` points at a row the writer deleted (it was unread), the new count is `match_notification_count` + new pairs; otherwise the new count is the number of new pairs. The want's pointer and count are set to the new row and count.

**FR-N-04** Texts (through `clock.fit_notification_message`) and links:

| Case | Message | `link_path` |
|---|---|---|
| Count 1 | "Szukasz: «{want name}». Ktoś wystawił: «{product name}»." | item page: `product_path(owner slug, item_id)` |
| Count 2-4 (and 22-24, ...) | "Szukasz: «{want name}». {n} nowe pasujące rzeczy." | `want_path(want_id)` = `/wanted/{id}` |
| Count 5+ | "Szukasz: «{want name}». {n} nowych pasujących rzeczy." (plural form to confirm) | `/wanted/{id}` |
| `WANT_EXPIRING` | "Poszukiwanie «{want name}» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz." | `/wanted/{id}` |

The owner slug is the owner's Organization slug or `derive_party_slug`, as for search results. Messages carry no dates.

**FR-N-05** `WANT_EXPIRING` rows are plain inserts (no pointer, never replaced), once per validity period (`reminded_at`).

**FR-N-06** The want's unread match row is deleted (through the delete-only function of FR-N-09, by the pointer) and the pointer and count reset when the want is withdrawn and when an edit resets its matches. All other rows stay (read rows, reminder rows, rows of fulfilled, expired or purged wants).

**FR-N-07** The two kinds produce no pending action (`pendingActions.ts` reacts to two other kinds only). The bell row and the counters are independent: reading the bell does not reset `new_match_count`; opening the match list does not mark the bell row read.

**FR-N-08** Rows are written by the scan directly through `notifications_acl`, not through the outbox. A want with the switch off still stores pairs: while muted only `new_match_count` grows; `match_notification_id` and `match_notification_count` are untouched, so the first bell row after re-enabling does not sum the muted period.

### Lifecycle

| # | Transition | Trigger | Rules | HTTP |
|---|---|---|---|---|
| FR-L-01 | (none) to `ACTIVE` | `POST /api/wants` | Moderation, cap, `expires_at = now + 90 d`, forward match | 201; 400 / 409 / 503 |
| FR-L-02 | `ACTIVE` to `ACTIVE` (extend) | `POST /{id}/extend`; also inside `POST /{id}/matches/seen` when `expires_at - now <= 30 d` | `expires_at = now + 90 d`, `reminded_at = null`; matches kept; no forward match | 200; 409 when not `ACTIVE` |
| FR-L-03 | `ACTIVE` to `FULFILLED` | `POST /{id}/close` `outcome=FULFILLED` | `closed_at = now`; drops out of the scan at once; bell rows kept | 200; 409 when not `ACTIVE` |
| FR-L-04 | `ACTIVE` to `WITHDRAWN` | `POST /{id}/close` `outcome=WITHDRAWN` | `closed_at = now`; unread match row deleted (FR-N-06); hidden from the list; every later request for it is 404 | 200; 409 when not `ACTIVE` |
| FR-L-05 | `ACTIVE` to `EXPIRED` | sweep | `closed_at = expires_at` | - |
| FR-L-06 | `EXPIRED` to `ACTIVE` (resume), `FULFILLED` to `ACTIVE` (reopen) | `POST /{id}/resume` | Cap check; `closed_at = null`, `expires_at = now + 90 d`, `reminded_at = null`; stored matches kept; forward match (rows born seen) under the 3 s timeout | 200; 409 (cap, or already `ACTIVE`); 503 |
| FR-L-07 | non-`ACTIVE` to deleted | sweep, 30 days after `closed_at` | Hard delete with matches | - |

- **FR-L-08** Only `ACTIVE` wants with `expires_at > now` are matched.
- **FR-L-09** Editing is allowed only while `ACTIVE`; otherwise 409.
- **FR-L-10** Cap: at most 30 `ACTIVE` wants per seeker, counted in the write transaction without locks, on create, resume and reopen; over the cap is 409 and nothing is written. (Two concurrent requests can pass by a small margin; accepted, ADR-011.)

### Want writes
- **FR-W-01** Name: trimmed; 3-80 code points; at least one letter or digit. Note: trimmed; up to 300; blank becomes null.
- **FR-W-02** Category: optional, any existing node. Offer mode: `GIFT`, `SWAP` or null. Locality: optional existing locality. Radius: only with a locality; 0 or null means null ("Tylko tu"); otherwise 1-100. On PATCH the rules apply to the merged state, with one server-side rule: clearing the locality also clears the radius (no 400). A reference id (category, locality) that the PATCH does not change is not re-validated.
- **FR-W-03** Text checks on write, name then note: `ensure_no_contact_info`, then `check_text(WANT_NAME ...)` and `check_text(WANT_NOTE ...)`. On create they run before any database statement; on edit only the load of the want (ownership, status, current values for the `current` argument) precedes them. Rejection is 400; a classifier outage is 503.
- **FR-W-04** Create order: text checks first (no database statement before them), then the caller's profile load, statement timeout, cap count, existence checks, insert, forward match, commit.
- **FR-W-05** PATCH accepts any subset of name, note, category, offer mode, locality, radius, `notifications_enabled` (`model_fields_set`; unknown fields rejected).
- **FR-W-06** A PATCH that changes the stored value of name, category, offer mode, locality or radius deletes the want's matches, deletes its unread match bell row, resets pointer and count, and re-runs the forward match in the same transaction under the 3 s timeout. A PATCH that changes only the note or the switch does none of this.
- **FR-W-07** Cap message (fixed by the mockup): "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe."
- **FR-W-08** Classifier messages: `WANT_NAME` "Nazwa poszukiwania narusza zasady społeczności. Zmień ją i spróbuj ponownie." (fixed by the mockup); `WANT_NOTE` "Notatka narusza zasady społeczności. Zmień ją i spróbuj ponownie." (to confirm).
- **FR-W-09** Outage message: the existing "Moderacja jest chwilowo niedostępna — spróbuj za chwilę."
- **FR-W-10** `short_words_query` is computed in SQL in the statement that writes the name (create, and a PATCH that changes the name): the lexemes of `to_tsvector('simple'::regconfig, fold_pl(:name))` whose length is at most 3, joined with `&` into a `tsquery`; null when there are none. This is the same parser that builds `products.search_vector`, so "kurtka 3-5 lat" yields the parser's own tokens (`'3'`, `'-5'`, `'lat'`) and matches an identical product name.

### API

Prefix `/api/wants`; router as `app/messaging/router.py` (`require_any("READ")` for GET, `require_any("EDIT")` for POST / PATCH; no `mcp:*` scopes). Literal paths are declared before `/{id}` routes. Every `/{id}` route selects by `(id, seeker_party_id)` and excludes `WITHDRAWN`: a foreign, withdrawn, purged or unknown want is 404. No DELETE route. No public route, so `set_personalised_cache_headers` is not used. Request schemas use `extra="forbid"`.

Want response fields (all want-returning routes): `id`, `name`, `note`, `category_id`, `category_name` (the node's own name, null without a category), `category_path` (the full path joined with " › ", e.g. "Zabawki › Pojazdy dla dzieci", null without a category), `offer_mode`, `locality_id`, `locality_name` (default, OQ6: the locality's name, null without a locality), `radius_km`, `notifications_enabled`, `status`, `expires_at`, `closed_at`, `created_at`, `match_count`, `new_match_count`. Timestamps are naive UTC.

| # | Route | Request | Response | Status |
|---|---|---|---|---|
| FR-A-01 | `GET /api/wants` | Optional query `matched_item_id` (UUID) | List of wants in `ACTIVE`, `EXPIRED`, `FULFILLED` (never `WITHDRAWN`). With `matched_item_id`: only `ACTIVE` wants holding that item as a stored match. Default order (OQ5): `ACTIVE` first, then newest first | 200 |
| FR-A-02 | `POST /api/wants` | `name`, optional `note`, `category_id`, `offer_mode`, `locality_id`, `radius_km`, `notifications_enabled` | The want (forward matches already stored; `new_match_count` 0) | 201; 400; 409 cap; 503 |
| FR-A-03 | `GET /api/wants/{id}` | - | The want | 200; 404 |
| FR-A-04 | `PATCH /api/wants/{id}` | Any subset of the create fields | The want | 200; 400; 404; 409 not `ACTIVE`; 503 |
| FR-A-05 | `POST /api/wants/{id}/extend` | - | The want | 200; 404; 409 |
| FR-A-06 | `POST /api/wants/{id}/close` | `outcome`: `FULFILLED` or `WITHDRAWN` | The want (default, OQ6) | 200; 400; 404; 409 |
| FR-A-07 | `POST /api/wants/{id}/resume` | - | The want | 200; 404; 409; 503 |
| FR-A-08 | `GET /api/wants/{id}/matches` | - | List of match cards: `id` (item id), `title`, `subtitle`, `href`, `meta` {`mode`, `condition`, `thumb_url`, `reserved`, `reserved_until`}, `is_new`, `reserved_by_me`, `proposed_by_me`. Available first, then reserved; default secondary order (OQ5): new first, then score descending. Unbounded in v1: no limit, no paging | 200; 404 |
| FR-A-09 | `POST /api/wants/{id}/matches/seen` | - | The want (default, OQ6). Sets `seen_at = now` on the want's unseen pairs; when the want is `ACTIVE` and within its last 30 days, extends it (FR-L-02). For a non-`ACTIVE` want only the counter is reset | 200; 404 |
| FR-A-10 | `POST /api/wants/{id}/matches/{item_id}/opened` | - | Empty. Sets `opened_at` once (first open). Default (OQ6): unknown pair is 404 | 204; 404 |

- **FR-A-11** `match_count` and `new_match_count` count only pairs that pass the read-time filter of the match list (FR-M-07); `new_match_count` additionally requires `seen_at IS NULL`. Both come from the list statement, not from a per-want read. `category_name`, `category_path` and `locality_name` are resolved by a join or one batch, so the statement count of the list endpoint stays constant.
- **FR-A-12** `reserved` is true when the item is not `AVAILABLE` or has a pending proposal. `reserved_by_me` compares `reserved_by_user_id` of the listed-items select with the caller's `account_user_id` (from the profile by principal). `proposed_by_me` is an own `EXISTS` on pending proposals by the caller's party in the same statement (`with_pending_proposer` exposes only the oldest proposer).
- **FR-A-13** `href` is `product_path(owner slug, item_id)`; photos and organization slugs are batched as in search.
- **FR-A-14** Authorization matrix: two rows before the catch-all, copied from conversations rows 53-54: `GET ^/api/wants(/.*)?$` to `("READ",)` and `POST, PATCH ^/api/wants(/.*)?$` to `("EDIT",)`.
- **FR-A-15** GET routes have no side effects (cookie auth on GET); the counter reset and the open mark are POSTs.

**FR-A-20 Errors** (legacy flat envelope; validation is 400, never 422):

| Case | Status | Message |
|---|---|---|
| Name length | 400 | "Nazwa musi mieć od 3 do 80 znaków." (fixed by the mockup) |
| Name without a letter or digit | 400 | "Nazwa musi zawierać literę lub cyfrę." (to confirm) |
| Note too long | 400 | "Notatka może mieć najwyżej 300 znaków." (to confirm) |
| Radius without a locality | 400 | "Promień można ustawić tylko razem z miejscowością." (to confirm) |
| Radius outside 1-100 | 400 | "Promień musi mieć od 1 do 100 km." (to confirm) |
| Unknown category / locality | 400 | "Wybrana kategoria nie istnieje." / "Wybrana miejscowość nie istnieje." (to confirm) |
| Malformed body, unknown field, bad enum | 400 | "Validation failed" with `fieldErrors` (existing handler) |
| Contact details in name or note | 400 | The existing `CONTACT_INFO_MESSAGE`, verbatim (decided; the mockup shows it shortened) |
| Classifier rejection | 400 | FR-W-08 |
| Cap of 30 (create, resume, reopen) | 409 | FR-W-07 |
| Edit of a non-`ACTIVE` want | 409 | "To poszukiwanie nie jest aktywne. Wznów je, aby je edytować." (to confirm) |
| Extend of a non-`ACTIVE` want | 409 | "Przedłużyć można tylko aktywne poszukiwanie." (to confirm) |
| Close of a non-`ACTIVE` want | 409 | "To poszukiwanie jest już zamknięte." (to confirm) |
| Resume of an `ACTIVE` want | 409 | "To poszukiwanie jest już aktywne." (to confirm) |
| Foreign, withdrawn, purged or unknown want | 404 | "Nie znaleziono poszukiwania." (to confirm; `WantNotFound`) |
| `opened` for an item that is not a stored match of the want | 404 | "Nie znaleziono dopasowania." (to confirm) |
| Forward-match timeout | 503 | "Szukanie dopasowań trwa zbyt długo. Spróbuj ponownie za chwilę." (to confirm) |
| Classifier outage | 503 | FR-W-09 |
| Token without a profile | 401 | existing |

### Frontend

**Routes and paths**
- **FR-F-01** Thin client route files in `app/(site)/(panel)/`: `wanted/page.tsx` (list), `wanted/[id]/page.tsx` (match list, new), `wanted/[id]/edit/page.tsx` (form, new), `add/wanted/page.tsx` (form; `add/hunting/` is renamed, no redirect). The existing `wanted/error.tsx`, `loading.tsx`, `not-found.tsx` stay. `proxy.ts`, `PROTECTED_PREFIXES` and reserved slugs need no change.
- **FR-F-02** `routing/paths.ts`: `View` member `"add/hunting"` becomes `"add/wanted"`; new builders `wantPath(id)` and `wantEditPath(id)` (as `placeEditPath`).
- **FR-F-03** Feature folder `features/wanted/`: list view, form view (create and edit), match list view, closing sheet, and one `resolve...View()` per page in its own `*ViewState.ts`. Pages only `switch` on `view.kind`. Router access only through `routing/navigation.tsx`.
- **FR-F-04** `api/wants.ts` (typed requests and responses of FR-A-01..10). `hooks/useWants.ts` on the `useMyLocations` template: key `[WANTS_KEY, "mine", token]`, `enabled: token !== null`, stable empty fallback, `loading`, `error: string | null`, `refetch`, mutations `create`, `update`, `extend`, `close`, `resume` that pass `extractProblemMessage` errors through and `await` invalidation of the whole prefix; it also serves the counts of the entry points and the `matched_item_id` lookup of the closing prompt. `hooks/useWantMatches.ts` on the `useEvent` template under the same prefix: the want, its matches, a not-found flag, `markSeen`, `markOpened`.
- **FR-F-05** Want timestamps are naive UTC and are read with the UTC plugin of `utils/dayjs.ts`; day counts ("Ważne jeszcze N dni", "N dni temu", "za N dni") are computed on the client. No wants query runs during server render: `PublicAddView`, the item page and the search page must not call the wants hooks while rendering on the server.

**List `/wanted` (screen:wanted-list)**
- **FR-F-10** View states: `loading`, `error` (message + retry), `empty`, `list`.
- **FR-F-11** Header: back link "‹ Konto", h1 "Szukam", link "+ Dodaj" to `/add/wanted`, intro "Zapisz, czego potrzebujesz. Damy znać, gdy ktoś doda pasującą rzecz." No inline add field.
- **FR-F-12** Active card: name as a link to `wantPath(id)`; filter summary joined with " · " from `category_name` (the node's own name; the list mockup's "Zabawki" for a want whose path is "Zabawki › Pojazdy dla dzieci" was an inconsistency of the mockup), the offer mode ("Oddam" / "Zamiana"; nothing for null), and the place ("Kęty +10 km", "Kęty" for "Tylko tu", "cała Polska" without a locality); "Bez doprecyzowania" when no category, mode or locality is set; "powiadomienia wyłączone" appended when the switch is off. Pill "N nowe" when `new_match_count > 0`. Match band: "N pasujących rzeczy" / "1 pasująca rzecz", or "Jeszcze nic · powiadomimy Cię" with a bell icon at 0. Expiry hint "Ważne jeszcze N dni", with a "Przedłuż" action when 7 days or fewer remain.
- **FR-F-13** Expired card: "Wygasło N dni temu", pill "Wygasło", "Zniknie z listy za M dni", action "Wznów". Fulfilled card: "Znalezione N dni temu", pill "Znalezione", "Zniknie z listy za M dni", action "Szukam znowu". Both actions call resume; a 409 (cap) message is shown verbatim.
- **FR-F-14** Empty state: "Czego potrzebujesz?", "Dodaj rzecz, której szukasz, np. fotelik albo kurtkę na zimę.", link "+ Dodaj poszukiwanie" to `/add/wanted`.
- **FR-F-15** Category names for display come from the response (`category_name`, `category_path`); the list and the match page do not load the category tree. Default (OQ5): plural forms beyond the mockup follow `pluralPl` ("1 nowa", "5 nowych").

**Form `/add/wanted` and `/wanted/:id/edit` (screen:wanted-form, screen:wanted-form-errors)**
- **FR-F-20** View states. Create: `ready`. Edit: `loading`, `error`, `notFound` (same own state as FR-F-37), `ready`. Default (OQ5): the edit page of a non-`ACTIVE` want navigates with `replace` to `wantPath(id)`.
- **FR-F-21** Field order and copy: title "Szukam rzeczy" (create) / "Edytuj poszukiwanie" (edit); intro "Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz." (create); label "Czego szukasz?", placeholder "Np. kask rowerowy dla dziecka", counter "N/80 znaków"; disclosure; "Kategoria" (`CategoryTreePicker` in `mode="any"` with the clear label "Dowolna kategoria", also the empty trigger text); "Jak chcesz dostać rzecz?" chips "Obojętnie" (null, default), "Oddam" (`GIFT`), "Zamiana" (`SWAP`), exclusive (exactly one pressed), each with `aria-pressed` — the form's own chips, not a shared extraction; "Miejscowość": only the locality field (`LocalityCombobox` with the placeholder "Cała Polska — wpisz, aby zawęzić" through its new prop, FR-F-65) and the shared radius chips "Tylko tu", "+10 km", "+25 km", "+50 km", shown once a locality is chosen, with "Tylko tu" (radius null) selected by default on pick. No "Lokalizacja" heading, no `MajorTownPicker`, no "Ostatnio" chip; the form neither reads nor writes the remembered search locality; "Notatka dla siebie", placeholder "Rozmiar, kolor, do kiedy potrzebujesz", helper "Widzisz ją tylko Ty. N/300 znaków".
- **FR-F-22** "Doprecyzuj (opcjonalnie)" is a `<button type="button">` with `aria-expanded`, `aria-controls` and an `aria-hidden` ▸/▾ (component:want-disclosure). Collapsed on an empty create form; expanded on edit and when the form opens with any of `category`, `offer_type`, `locality`, `radius`.
- **FR-F-23** Prefill from the query string on `/add/wanted`: `name`, `category`, `offer_type`, `locality` (loaded into a `Locality` object with `hooks/useLocality`), `radius` (only with a locality).
- **FR-F-24** A prefilled name outside 3-80 characters is shown as typed, with the inline `role="alert"` error "Nazwa musi mieć od 3 do 80 znaków.", `aria-invalid` and `aria-describedby` on the field, and a blocked submit. The name field does not truncate.
- **FR-F-25** Submit "Zapisz poszukiwanie" / "Zapisz zmiany": blocked by input with `aria-disabled="true"` + `aria-describedby` and a handler guard (hint for an empty name: "Wpisz, czego szukasz (3–80 znaków)."); native `disabled` only while the request runs. Edit also shows "Anuluj" (to `wantPath(id)`) and the hint "Zmiana nazwy, kategorii, sposobu lub miejsca wyszuka dopasowania od nowa."
- **FR-F-26** After a successful save the form navigates with `replace` to `wantPath(id)`.
- **FR-F-27** Server errors appear in a `role="alert"` block above the name field with the server's message verbatim; the form stays filled. For a 409 on create the block also carries the link "Zobacz listę" to `/wanted`.
- **FR-F-28** Back link: "‹ Dodaj" (to `/add`) on create, "‹ {want name}" (to `wantPath(id)`) on edit. Default (OQ5): "‹ Szukaj" when the form was opened with prefill parameters, leading back to the search page.
- **FR-F-29** The note counter marks an over-length note with an inline error and blocks the submit (wording as FR-A-20, to confirm).

**Match list `/wanted/:id` (screen:wanted-matches, screen:wanted-matches-states)**
- **FR-F-30** View states: `loading`, `error`, `notFound`, `active` (with matches), `activeEmpty`, `expired`, `fulfilled`.
- **FR-F-31** Header: back "‹ Szukam", link "Edytuj" to `wantEditPath(id)` (active states only), h1 name, filter line as FR-F-12 but with the full category path from `category_path` ("Zabawki › Pojazdy dla dzieci"), "Notatka: ..." when a note exists.
- **FR-F-32** Notification toggle (component:want-notification-toggle), active states only: "Powiadomienia o nowych rzeczach" with "Damy znać w dzwonku" (on) / "Wyłączone" (off), `role="switch"` with `aria-checked`, its accessible name being the visible row label ("Powiadomienia o nowych rzeczach"); a change is saved at once by a PATCH of `notifications_enabled` alone.
- **FR-F-33** Opening the page calls the "seen" POST once after the matches have loaded; the call is guarded by a ref so effect re-runs do not repeat it. It refreshes the counters of the list, tile and "Konto" row (whole-prefix invalidation, which also refetches the matches with `is_new = false`). The page therefore keeps in its own state the ids of the items that were new on the first load and draws the "nowe" markers from that set for the rest of the visit.
- **FR-F-34** Matches: heading "N pasujących rzeczy" / "1 pasująca rzecz"; a grid of match cards (component:match-card): `ItemCard` with the "nowe" marker when `is_new`, and the reserved caption "Zarezerwowane przez Ciebie" (`reserved_by_me`), else "Twoja propozycja" (`proposed_by_me`), else "Zarezerwowane" (`reserved`). The intent pill keeps the labels `ItemCard` renders today (decided; the mockup's "Oddam" / "Zamiana" pills are not copied). Opening a card fires the "opened" POST without blocking navigation; its failure is ignored.
- **FR-F-35** Active actions: "Ważne jeszcze N dni"; "Znalezione — zamknij" (close as `FULFILLED`), "Przedłuż" (extend), "Wycofaj" (opens the confirmation). No-match state: bell icon, "Jeszcze nic nie pasuje", "Damy znać, gdy ktoś doda pasującą rzecz.", actions "Przedłuż o 90 dni", "Znalezione", "Wycofaj". Defaults (OQ5): "Przedłuż o 90 dni" is the primary action when 7 days or fewer remain, otherwise "Znalezione — zamknij"; after "Znalezione" the page stays and shows the fulfilled state.
- **FR-F-36** Withdraw confirmation through `ConfirmDeleteDialog`: title "Wycofać poszukiwanie?", body "„{name}” zniknie z listy razem z dopasowaniami. Nie damy już znać o nowych rzeczach.", confirm "Wycofaj", cancel "Anuluj"; after success navigate to `/wanted`; an error stays inline in the open dialog.
- **FR-F-37** Expired state: "To poszukiwanie wygasło N dni temu. Nie szukamy już nowych rzeczy. Zniknie z listy za M dni.", action "Wznów na 90 dni", the stored matches below; no "Edytuj", no toggle. Own not-found state (not the shared panel one): "Nie ma takiego poszukiwania", "Mogło zostać wycofane albo usunięte po zakończeniu.", link "Wróć do listy „Szukam”" to `/wanted`.
- **FR-F-38** Fulfilled state (no mockup; default, OQ5): as the expired state with "Oznaczone jako znalezione N dni temu. Nie szukamy już nowych rzeczy. Zniknie z listy za M dni." and the action "Szukam znowu" (wording to confirm).
- **FR-F-39** A failed extend, close, resume or toggle (on the list and on the match page) shows the server's message verbatim in an inline `role="alert"` next to the action that failed; no toast. A failed toggle reverts to its previous position.

**Entry points (component:entry-points)** - exactly three
- **FR-F-40** `/add` tile "Szukam rzeczy" / "Damy znać, gdy ktoś doda pasującą" links to `/add/wanted` and shows the pill "N nowe" when the sum of `new_match_count` is above 0. The count is a prop passed by `AddView` only; the shared `AddTiles` and `PublicAddView` do not call `useWants`.
- **FR-F-41** "Konto" row "Szukam" links to `/wanted` with real counts: "N rzeczy · M nowe dopasowania"; the second part only when M > 0; "brak" at zero, as the neighbouring rows. Default (OQ5): N is the number of `ACTIVE` wants.
- **FR-F-42** Empty-search prompt: only the prompt block of the existing empty state changes (decided): the sentence "Damy znać, gdy ktoś doda pasującą rzecz." and the link "Dodaj do listy „Szukam”" to `/add/wanted` with `name` (the query), `category`, `offer_type`, `locality`, `radius` for each value that is set. The existing heading stays as it is, and so does today's scope-"mine" suffix of the prompt sentence (" Możesz też szukać wszędzie."); the mockup's heading, body and "Szukaj wszędzie" button are not built. Condition and scope are dropped from the link. The link stays server-safe.
- **FR-F-43** A guest following the prompt goes through login or registration and lands on `/add/wanted` with the whole query string (`returnTo` keeps path and query).

**Closing prompt (component:close-want-sheet)**
- **FR-F-50** `useItemTake` returns one more field: the item id of the last successful take, set after a personal take and after a term / event take, never after a swap proposal.
- **FR-F-51** `ItemPickupActions` owns the prompt: when that field is set and the viewer is logged in, it asks `GET /api/wants?matched_item_id=`. The sheet opens only when at least one want is returned.
- **FR-F-52** Two `ModalSheet`s never stack: after a term / event take the prompt opens only once `TakeSuccessSheet` is closed; after a personal take (toast only) it opens when the lookup answers. The "Zobacz rzecz" link of `TakeSuccessSheet` (which points at the current item page and does not call `onClose` today) also closes the sheet, so the prompt can open.
- **FR-F-53** Sheet (`ModalSheet`, registered with `useRegisterOpenSheet`): title "Znalezione?", `ariaLabel` "Zamknąć poszukiwanie?"; one want: "Ta rzecz pasuje do Twojego poszukiwania:", „{name}”, "Zamknij poszukiwanie", "Szukam dalej", "Zamknięte poszukiwanie możesz wznowić przez 30 dni."; several wants: "Ta rzecz pasuje do Twoich poszukiwań:", the list of names, "Zamknij oba poszukiwania" for two (default, OQ5: "Zamknij wszystkie poszukiwania" for three or more), "Szukam dalej", "Zamknięte poszukiwania możesz wznowić przez 30 dni."
- **FR-F-54** "Zamknij ..." closes every returned want as `FULFILLED`; a failure is shown inline and the sheet stays open. On a retry a 409 "already closed" and a 404 count as done for that want, so a partial failure can be completed. "Szukam dalej", ✕ and Esc close the sheet with no request; the prompt is not shown again for that take.
- **FR-F-55** The prompt appears only on the item page. The match list page shows the caption and its own "Znalezione" action.

**Shared-component changes and extractions**
- **FR-F-60** `ItemCard`: one optional prop for a marker ("nowe"); existing callers unchanged.
- **FR-F-61** `CategoryTreePicker`: one optional prop for the label of the clear option, default unchanged ("Kategoria główna (brak)"); the want form passes "Dowolna kategoria".
- **FR-F-62** `BottomNav`: "Konto" is highlighted on every account sub-view by prefix (exact path or path + "/..."), for all `ACCOUNT_SUBVIEWS`, including `/wanted/:id`, `/wanted/:id/edit`, `/places/...`.
- **FR-F-63** Only the radius chips ("Tylko tu", "+10 km", "+25 km", "+50 km") and the chip style constants are extracted from `features/search/SearchFilters.tsx` into shared code, as a first, separate step. The rest of the search location section (heading, "Ostatnio" chip, `MajorTownPicker`, its +10 km default on pick) and search's offer toggles stay in `SearchFilters.tsx` unchanged; `test/SearchView.test.tsx` L134-210 is green before and after.
- **FR-F-64** `api/notifications.ts`: the `NotificationKind` union gains `WANT_MATCH_FOUND` and `WANT_EXPIRING`; the stale `PLEDGE_ITEM_REGISTERED` member is removed where its test (`test/MyItemsViewCategory.test.tsx:508-526`) is rewritten. The bell's behaviour does not change.
- **FR-F-65** `LocalityCombobox`: one optional `placeholder` prop, default unchanged ("Nazwa lub kod pocztowy"); the want form passes "Cała Polska — wpisz, aby zawęzić".
- **FR-F-66** `TakeSuccessSheet`: "Zobacz rzecz" also calls `onClose` (FR-F-52).

**Removed**
- **FR-F-70** `features/search/WantedView.tsx`, `features/add/HuntingCreateView.tsx`, `MockWant` and `MOCK_WANTS` in `utils/mocks.ts` (and its header comment), `app/(site)/(panel)/add/hunting/`, `test/HuntingCreateView.test.tsx` (rewritten for the new form).

### Changes to existing backend modules (each as small as stated)

| # | File | Change |
|---|---|---|
| FR-X-10 | `app/main.py` | Include the wants router before `system_router`; interval constant, job wrapper (with the `StaleDataError` catch) and `add_job` for the scan |
| FR-X-11 | `app/core/authorization_matrix.py` | Two rows (FR-A-14) |
| FR-X-12 | `app/groups/infrastructure/visibility.py` | Annotations only: `other_party` of `parties_share_group` and `viewer` of `owner_shares_group_with` widened to `Parties`; docstrings updated. No runtime change, no facade change |
| FR-X-13 | `app/moderation/text_guard.py` | `TextField.WANT_NAME`, `TextField.WANT_NOTE` and their `MESSAGES` entries (FR-W-08) |
| FR-X-14 | `app/notifications/models.py`, `service.py` | Two kinds (and the docstring); the batch writer (FR-N-02) and the delete-only function (FR-N-09) |
| FR-X-15 | `tests/test_module_boundaries.py`, `tests/test_domain_clock_guard.py`, `tests/test_authorization_matrix.py` | `"wants"` in `MODULES` + `product_path` parity test against `app.search.domain.links.product_path`; `app/wants` in `_GUARDED_DIRS`; rows for the two wants rows and the mcp-token 403 / login-token 200 pair |

No change in `app/inventory`, `app/product`, `app/category`, `app/locations`, `app/users`, `app/organizations`, `app/search`, the listing write paths, reservations, messaging or needed items.

### Documentation
- **FR-D-10** `.maister/docs/project/architecture.md`: a Wants section (module, tables, match statement, scan, notification rules, lifecycle, API); the package tree; the guarded-module sentences; removal of the `HuntingCreateView` mention; the 0099 runbook (FR-D-07); a note that account deletion, when built, must handle `wants.seeker_party_id`; and the release gate (FR-D-12).
- **FR-D-11** `.maister/docs/INDEX.md`: the architecture entry extended with the wants summary.
- **FR-D-12** Release gate, written in `architecture.md`: there is no feature switch; the feature must not be deployed until the labelled Polish sample (at least 200 pairs, follow-up task) is scored and the thresholds are set from it.
- **FR-D-13** `.maister/tasks/development/2026-11-12-global-search-group-description/documentation/user-guide.md` (L8, L12, L143-152): the demo warning is removed and the steps corrected; a pointer to the new guide is added, and the screenshot replaced, only if this workflow produces user documentation.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group; test verification for a step group runs only its new tests, not the entire suite.
- **FR-T-01 Baseline first**: before the first change, run and record in the task folder a backend baseline (`uv run python -m pytest`, `mypy`, `ruff` from `src/backend`) and a frontend baseline (Vitest, `typecheck`). The task adds no new failure; an old failure is fixed only where this task rewrites the failing test.
- The rows below list what must be pinned, not one test per pin. Several rows (FR-T-11, FR-T-15 in particular) carry 16-18 pins; the planner groups them into 2-8 scenario tests per feature file, per the backend testing standard.
- The two run-only checks (generated `tsquery` column; `EXPLAIN`) come before the matcher is built on them. O1 is proven by the migration round trip (FR-T-10) plus one create-and-match test that inserts a want through the ORM over asyncpg and matches with its generated columns (FR-T-15).

Backend (`tests/test_<feature>.py`, flat; real PostgreSQL; `db_session` / `client`; exact key sets; categories via `leaf_category_ids` per test; scan and sweep tests pass `now` and date rows by setting columns directly):

| # | File | Pins |
|---|---|---|
| FR-T-10 | `tests/test_wants_migration.py` | Downgrade to 0098 then upgrade head; the generated `name_folded` and `name_query` columns exist and are filled (the first half of O1; the second is the create-and-match test of FR-T-15); CHECKs reject radius 0, radius 101, radius without a locality, and `closed_at` not matching the status |
| FR-T-11 | `tests/test_wants_matcher.py` | Full-text hit; trigram hit at 0.70 without and 0.60 with a category; short-word rule ("TV LG 43" case, and a hyphenated / numeric name such as "kurtka 3-5 lat" that matches an identical product name); several rows inserted by one statement get distinct ids; stored pairs are excluded before the top 20 (a resume adds pairs not stored yet); category subtree narrows and never matches alone; offer mode; same locality, radius hit and miss with the known distances (KETY / ANDRYCHOW 8.8 km / BIELSKO 14.4 km / LODZ 209 km), null-point fallback; must-not-match: own item, PRIVATE without a shared live PRIVATE group, reserved, pending proposal, deleted place; top-20 cap and order; forward and reverse give the same pairs |
| FR-T-12 | `tests/test_wants_scan.py` | New listing gives one pair and one bell row; a second run over the same window adds nothing; first run without a marker (window of 15 + 5 minutes); overlap; the register insert path; switch off stores pairs without a row and leaves pointer and bell count untouched; one race test: a want loaded through the ORM before a scan run that updates it gets `StaleDataError` (409) on its write, because the scan set `updated_at`; a lost first-run race (`IntegrityError` on the marker) is caught like `StaleDataError`; statement count constant with one and several wants / listings (target at most 16); one log line; the job wrapper swallows `StaleDataError` and rolls back |
| FR-T-13 | `tests/test_wants_notifications.py` | Count 1 names the item and links to it; count 2+ gives the count and links to `/wanted/{id}`; an unread row is deleted and replaced with the summed count; a read row is left and a new row starts from the run's count; the writer's two statements and distinct ids for several rows; the delete-only function removes unread rows only, in one statement; unread row deleted on withdraw and on edit-reset through it; other rows kept |
| FR-T-14 | `tests/test_wants_lifecycle.py` | Expire sets `closed_at = expires_at`; reminder once per period and regardless of the switch, again after an extension; purge at 30 days with cascade, active never purged; extend, close, resume, reopen rules and their 409s; auto-extension inside "seen" only in the last 30 days; only `ACTIVE` unexpired wants are matched |
| FR-T-15 | `tests/test_wants_api.py` | Create 201 with forward matches born seen and no notification (the create-and-match test of O1); exact key sets including `category_name` and `category_path`; validation 400s (length, no letter or digit, radius rules, radius 0 stored as null); a PATCH clearing the locality clears the radius without a 400; contact details and classifier 400, outage 503 with nothing saved; cap 409 on create and resume; forward timeout 503 (monkeypatched sqlstate 57014) with nothing saved; foreign and withdrawn want 404; edit of a non-`ACTIVE` want 409; note-only and switch-only PATCH keep matches, a matching-field PATCH resets them; statement count of create and list constant |
| FR-T-16 | `tests/test_wants_matches_api.py` | Card key set; available first; `is_new`; `reserved`, `reserved_by_me`, `proposed_by_me` (own proposal that is not the oldest); unlisted or no-longer-visible items left out and not counted; an item the seeker now owns and lists again left out and not counted; `match_count` / `new_match_count` agree with the list; `matched_item_id` returns only `ACTIVE` wants holding the item; "seen" resets the counter; "opened" set once; statement count of the match list constant |
| FR-T-17 | `tests/test_visible_to.py` (or a new file beside it) | Column form of `parties_share_group`: shared live PRIVATE group true; soft-deleted group false; PUBLIC-only shared group false with `private_only` |
| FR-T-18 | Guard tests | `tests/test_module_boundaries.py` (wants guarded; `product_path` parity with `app.search.domain.links.product_path`, the pure copy), `tests/test_domain_clock_guard.py` (`app/wants`), `tests/test_authorization_matrix.py` (two rows; mcp token 403, login token 200), `tests/test_membership_definition_guard.py` stays green (no own shares-a-group SQL in `app/wants`) |

Frontend (Vitest in `src/test/`, explicit Vitest imports, `renderWithRoute`, `createQueryWrapper`, `vi.mock("../api/wants")` factories, a typed fixture factory `test/fixtures/wants.ts` with no casts, pinned clock for day counts):

| # | Test | Pins |
|---|---|---|
| FR-T-20 | View-state tables (`it.each`) for list, form and match list | Every `kind`, including stale / refresh-error rows and not-found |
| FR-T-21 | `useWants`, `useWantMatches` | Token in the key; disabled without a token; mutations invalidate the prefix and pass server messages through; not-found flag |
| FR-T-22 | Form (replaces `HuntingCreateView.test.tsx`) | Field order and copy; disclosure state and ARIA; prefill from the query; out-of-range prefilled name shown as typed with the inline error and blocked submit; `aria-disabled` + hint; clear label "Dowolna kategoria"; "Obojętnie" sends null and the three chips are exclusive; picking a locality selects "Tylko tu", which sends null; no `MajorTownPicker` or "Ostatnio" chip, and the remembered search locality is neither read nor written; server error block and the 409 link; `replace` to `wantPath(id)` after save; edit hint and "Anuluj" |
| FR-T-23 | List | Cards, summary line variants, "N nowe", expiry hint and "Przedłuż", expired / fulfilled rows and actions, empty state, "+ Dodaj" |
| FR-T-24 | Match list | Header with `category_path`, note, toggle PATCH, a failed toggle reverts and shows the inline alert, "seen" called once across re-renders (ref guard), "nowe" markers still shown after the refetch that follows "seen" (ids kept in page state), three captions, "opened" on card open, actions, withdraw dialog, expired state, own not-found state |
| FR-T-25 | Closing prompt (`ItemDetailPage.test.tsx`, `useItemTake.test.tsx`, sheet test) | Shown after a personal and after a term / event take, not after a swap proposal; only after `TakeSuccessSheet` closes; one and several wants; "Zamknij" closes all; a retry after a partial failure treats 409 and 404 as done; "Szukam dalej" closes none; no lookup for a guest; "Zobacz rzecz" closes `TakeSuccessSheet` and the prompt opens; `ariaLabel` of the sheet |
| FR-T-26 | Entry points (`addRoute.test.tsx`, `AppPage.test.tsx`, `SearchView.test.tsx`) | Tile link and count (and none on `PublicAddView`); "Konto" row counts; empty-search link with all five parameters, condition and scope dropped |
| FR-T-27 | `routeManifest.test.ts`, `panelPages.ts` / `panelPages.test.ts` | `/add/wanted`, `/wanted/:id`, `/wanted/:id/edit` present; `/add/hunting` gone; no redirect page |
| FR-T-28 | `auth.test.tsx` | Registration (not only login) follows a `returnTo` that carries a multi-parameter query |
| FR-T-29 | Shared pieces | `BottomNav` prefix highlight for `/wanted/:id` and `/places/new`; `CategoryTreePicker` label prop default unchanged; `LocalityCombobox` placeholder prop default unchanged; `ItemCard` marker; a pending-actions row showing the two new kinds create no blocking sheet; `MyItemsViewCategory` kind list; `ssrSafety.test.tsx` green |

**FR-T-30 Measurement (`EXPLAIN ANALYZE`, in scope)**: seed and `EXPLAIN` scripts live in the task folder, not in `src/`; results are recorded in the task folder.
- Database: a disposable PostgreSQL 18 brought to head with `alembic upgrade head`, never a developer or shared database. No connection string or other secret is printed or written into the results (secrets rule).
- Names: product and want names are drawn from realistic Polish product names (inflection, sizes, brands), not random strings; random names make the trigram selectivity meaningless.
- Data sizes: 5,000 and 20,000 listed items; 1,000 and 10,000 active wants, half with a category, a third with a locality.
- Runs: `EXPLAIN (ANALYZE, BUFFERS)` of the reverse statement for windows of 20 and 500 new listings, and of the forward statement for one want.
- Budgets: forward under 300 ms; reverse under 2 s at the largest point.
- Checks: at the 20,000-item size the forward plan uses `ix_products_name_trgm` and the full-text index (at 5,000 a sequential scan can be the right plan and is not a failure); whether `item_listing_preferences.created_at` needs an index (decision recorded; if yes, FR-D-06).
- If the reverse budget fails, the first lever (a lever, not a requirement) is to fold product names once per listing, for example a materialised CTE of the window's listings, while the predicates stay shared between the two directions; then tighten plain-column pre-filters; then report; a longer interval or the outbox fallback (4.1C) is a decision for the user, not for this task.

### Standards Compliance

| Standard | Governs |
|---|---|
| `standards/backend/models.md` | The three tables: `BaseEntity`, string-backed enums, plain FK-id columns for cross-module references, loose item pointer, one ACL per foreign module, safe-by-default PRIVATE inclusion |
| `standards/backend/migrations.md` | 0099: hand-written, `lock_timeout`, explicit `pk_` / `fk_` / `ix_` / `uq_` / `ck_` names, reverse-order downgrade, round-trip test, concurrent index in a separate revision |
| `standards/backend/queries.md`, `standards/backend/jooq.md` | Bind parameters, set-based statements, pinned statement counts, EXISTS over COUNT, enforced LIMIT (top 20), no incidental DISTINCT |
| `standards/backend/security.md` | `require_any` per route, matrix rows, login token only, side-effect-free GETs |
| `standards/backend/api.md` | Plural resource, action sub-routes, limited nesting |
| `standards/backend/time.md` | Naive UTC for audit / deadline columns; `clock.fit_notification_message`; clock guard |
| `standards/global/validation.md`, `error-handling.md` | Server-side validation with specific Polish messages; inline `role="alert"` errors; typed exceptions; 400 / 404 / 409 / 503 mapping |
| `standards/global/minimal-implementation.md`, `commenting.md`, `conventions.md`, `coding-style.md` | Constants not settings; no feature switch; scripts kept out of `src/`; no speculative methods |
| `standards/frontend/components.md` | Thin route files, `features/wanted/`, routing facade, one `resolve...View()` per page, server-safe rendering, no redirect page |
| `standards/frontend/accessibility.md` | `aria-disabled` + hint, `ModalSheet` + `useRegisterOpenSheet`, `ConfirmDeleteDialog`, picker inside a form, disclosure button, `sr-only` spacing |
| `standards/frontend/data-fetching.md` | Hooks in `src/hooks/` over `src/api/`, array keys with a prefix constant, awaited invalidation, messages passed through, `dayjs` from `utils/dayjs.ts` |
| `standards/frontend/css.md`, `responsive.md` | Tailwind tokens of `globals.css`, mobile-first |
| `standards/testing/backend-testing.md`, `frontend-testing.md` | Test placement, naming, fixtures, `count_queries`, exact key sets, typed factories, view-state tables |

Project rules: commands via `uv run python -m pytest|mypy|ruff` from `src/backend`; no commits without asking; never print secret values (no `env`, `printenv` or `.env` dumps; presence checks only).

## Out of Scope
- The owner signal (1B), the "mam to" relay, group or public wants, want-anchored conversations, abuse reporting.
- E-mail, push, digests, a notification settings screen; a bell redesign.
- Released reservations, item edits and visibility changes as matching signals; lemmatisation; embeddings.
- Condition and photos on a want; a saved-search feature; search relevance work.
- Automatic closing through a reservation origin field; a closing prompt after a swap proposal or on the match list page.
- A feature switch.
- The labelled Polish sample and threshold tuning (follow-up task; release gate).
- Needed items; the `PUT /api/products/{id}` ownership question; account deletion and data export for wants.
- A redirect from `/add/hunting`; an inline quick-add on the list; a DELETE route; a public wants route.
- Fixing pre-existing test failures outside the tests this task rewrites.

## Success Criteria

Acceptance criteria (testable; requirement ids in brackets):

| # | Criterion |
|---|---|
| AC-01 | Creating a want with two matching public available items returns 201; `/wanted/:id` lists both; `new_match_count` is 0; no notification row is written. [FR-L-01, FR-M-01, FR-A-02] |
| AC-02 | A matching item listed after the want exists gives, after one scan run, exactly one `want_matches` row, one `WANT_MATCH_FOUND` row naming the item and linking to its page, and `new_match_count` 1. [FR-S-02, FR-N-03, FR-N-04] |
| AC-03 | A second matching item before the bell row is read leaves one unread row for the want, saying "2 nowe pasujące rzeczy" and linking to `/wanted/:id`. [FR-N-02, FR-N-03] |
| AC-04 | Running the scan twice over the same window stores no second pair and writes no second notification. [FR-S-03] |
| AC-05 | No pair is stored for an own item, a PRIVATE item without a shared live PRIVATE group, a reserved item, an item with a pending proposal, or an item with a deleted place. [FR-M-03, FR-M-05] |
| AC-06 | A category alone never matches; a word of up to 3 characters never matches by trigram alone. [FR-M-03] |
| AC-07 | The trigram branch contains the `<%` operator as well as the `word_similarity` cut-off, and the forward plan measured at the 20,000-item size uses the product name trigram index. [FR-M-03, FR-T-30] |
| AC-08 | A want with a locality and radius matches an item 8.8 km away at radius 10 and not at "Tylko tu"; radius 0 sent to the API is stored as null. [FR-M-03, FR-W-02] |
| AC-09 | The statement counts of create, scan, list and match list do not grow with the number of wants, listings or matches. [FR-S-06, FR-T-12, FR-T-15, FR-T-16] |
| AC-10 | A 31st active want, and resuming with 30 active, answer 409 with the cap message and write nothing. [FR-L-10, FR-W-07] |
| AC-11 | Contact details or a classifier rejection in name or note answer 400; a classifier outage answers 503; nothing is saved; on create no database statement runs before the checks. [FR-W-03] |
| AC-12 | A forward-match timeout answers 503 and nothing is saved. [FR-M-06] |
| AC-13 | A foreign want and a withdrawn want answer 404 on every `/{id}` route; editing a non-`ACTIVE` want answers 409. [FR-A, FR-L-09] |
| AC-14 | Changing name, category, offer mode, locality or radius deletes the stored matches and the unread match bell row and stores fresh forward matches; changing only the note or the switch does not. [FR-W-06, FR-N-06] |
| AC-15 | Withdrawing deletes the want's unread match bell row and hides the want from the list. [FR-L-04, FR-N-06] |
| AC-16 | A want past `expires_at` becomes `EXPIRED` in the next run; 7 days before the end one `WANT_EXPIRING` row is written, once per period, also with the switch off. [FR-S-02, FR-N-05] |
| AC-17 | A closed want and its matches are gone 30 days after `closed_at`; an `ACTIVE` want is never deleted. [FR-L-07] |
| AC-18 | Opening the match list of an `ACTIVE` want in its last 30 days renews the period; outside them it does not. [FR-L-02, FR-A-09] |
| AC-19 | `match_count` and `new_match_count` equal what the match list shows; an item that is no longer listed or visible is neither listed nor counted. [FR-A-11, FR-M-07] |
| AC-20 | A match card shows "Zarezerwowane przez Ciebie" for the caller's reservation and "Twoja propozycja" for the caller's pending proposal even when it is not the oldest. [FR-A-12, FR-F-34] |
| AC-21 | An OAuth token with only `mcp:*` scopes gets 403 on `/api/wants`; a login token gets 200. [FR-A-14] |
| AC-22 | Migration 0099 survives downgrade-then-upgrade; the generated columns exist; the CHECKs hold. [FR-D-04, FR-T-10] |
| AC-23 | `app/wants` passes the module-boundary, membership-definition and domain-clock guards; `product_path` parity holds. [FR-X-01, FR-T-18] |
| AC-24 | The column form of the group-sharing predicate is true for a shared live PRIVATE group and false for a soft-deleted or PUBLIC-only one. [FR-X-12, FR-T-17] |
| AC-25 | The scheduler job survives a lost marker race: it logs, rolls back and the next run works. [FR-S-04] |
| AC-26 | `/wanted`, `/wanted/:id`, `/wanted/:id/edit` and `/add/wanted` render the states and copy of the mockups; `/add/hunting` no longer exists; no redirect page is added. [FR-F-01..38] |
| AC-27 | A name prefilled from search outside 3-80 characters is shown as typed with the inline error and a blocked submit. [FR-F-24] |
| AC-28 | The empty-search link carries `name`, `category`, `offer_type`, `locality` and `radius`; a guest reaches the prefilled form through login and through registration. [FR-F-42, FR-F-43] |
| AC-29 | After a personal or term / event take of a matched item the closing sheet appears (after `TakeSuccessSheet` closes, when there is one), names every matching active want, and "Zamknij" closes all of them; after a swap proposal no sheet appears. [FR-F-50..55] |
| AC-30 | The `/add` tile and the "Konto" row show real counts; `PublicAddView` and server render run no wants query. [FR-F-40, FR-F-41, FR-F-05] |
| AC-31 | The notification toggle saves at once and does not re-run matching. [FR-F-32, FR-W-06] |
| AC-32 | "Konto" is highlighted on `/wanted/:id`, its edit page and the other account sub-pages. [FR-F-62] |
| AC-33 | `test/SearchView.test.tsx` L134-210 is green before and after the extraction; the search filter sheet behaves as before. [FR-F-63] |
| AC-34 | The two new kinds create no pending action. [FR-N-07] |
| AC-35 | The backend and frontend suites show no failure that is not in the recorded baseline. [FR-T-01] |
| AC-36 | The `EXPLAIN ANALYZE` results, the budgets met or missed, and the index decision are recorded in the task folder. [FR-T-30] |
| AC-37 | `architecture.md` holds the Wants section, the 0099 runbook and the release gate; `INDEX.md` and the old search user guide are updated. [FR-D-10..13] |
| AC-38 | A want "kurtka 3-5 lat" matches a product with the identical name: `short_words_query` holds the parser's own tokens. [FR-W-10, FR-T-11] |
| AC-39 | A want loaded before a scan run that updates it (expire, remind, pointer) answers 409 on the seeker's write; no bell row is orphaned. [FR-S-07, FR-T-12] |
| AC-40 | One match statement that stores several pairs, and one writer call that inserts several bell rows, give each row its own id. [FR-M-01, FR-N-02] |
| AC-41 | Resuming a want that already holds 20 stored matches stores further matching items that were not stored yet. [FR-M-04] |
| AC-42 | An item the seeker now owns is neither listed nor counted for their want. [FR-M-07] |
| AC-43 | Pairs stored while a want is muted raise `new_match_count` only; the first bell row after re-enabling counts only the pairs of that run. [FR-N-08] |
| AC-44 | The "nowe" markers stay on the match page after the "seen" call and its refetch; "seen" is sent once per visit. [FR-F-33] |
| AC-45 | The want response carries `category_name` and `category_path`; the list card shows the node name and the match page the full path without loading the category tree; the list endpoint's statement count stays constant. [FR-A-11, FR-F-12, FR-F-15, FR-F-31] |
| AC-46 | The want form shows the locality field with the placeholder "Cała Polska — wpisz, aby zawęzić" and, after a pick, the radius chips with "Tylko tu" selected; it shows no major-town picker or "Ostatnio" chip and does not touch the remembered search locality. [FR-F-21, FR-F-65] |
| AC-47 | Clearing the locality in a PATCH clears the radius and answers 200. [FR-W-02] |
| AC-48 | A closing-sheet retry after a partial failure completes: wants already closed (409) or gone (404) count as done. [FR-F-54] |
| AC-49 | A failed extend, close, resume or toggle shows the server message in an inline alert by the action; a failed toggle reverts. [FR-F-39] |
| AC-50 | Two scan processes racing on the first run leave one marker row; the loser logs and rolls back. [FR-S-04] |

The 8 success criteria of the high-level design, adapted to the corrections:
1. A new want shows its existing matches in the same navigation, with no notification written (AC-01).
2. A matching item listed after the want was created produces exactly one stored pair and at most one unread bell row per want, within one interval plus the run time; a further match replaces the unread row by delete-and-insert (AC-02, AC-03).
3. Running the scan twice over the same window stores no second pair and writes no second notification (AC-04).
4. No pair is ever stored for an own item, an invisible PRIVATE item or an item that cannot be taken at match time (AC-05).
5. The number of SQL statements of create, scan, list and match list does not grow with the number of wants, listings or matches (AC-09).
6. The match statement meets its budgets at the measured data sizes (forward under 300 ms, reverse under 2 s) with the indexable `<%` pre-filter; setting the thresholds from the labelled sample is the release gate, outside this task (AC-07, AC-36).
7. Closed wants and their matches are gone 30 days after closing; an active want is never deleted (AC-17).
8. The inventory and groups write paths, `app/search` and reservations have no functional change; the groups change is annotations only (AC-23, AC-24, AC-33).

### Requirement coverage against `analysis/requirements.md`

| Requirements section | Covered by |
|---|---|
| Phase 1 answers (P1-P13, bell row, prompt trigger, measurement) | FR-X-01..04, FR-N-02..03, FR-F-50, FR-T-30; P7 FR-S-02; P8 FR-L-02; P9 FR-A-01; P10 FR-W-06; P11 FR-A-14; P12 FR-F-01; P13 FR-X-15 |
| Phase 2: C1 | FR-F-32 |
| I1 | FR-D-01, FR-W-02 |
| I2 | FR-A-12, FR-F-34 |
| I3 | FR-A-11 |
| I4 | FR-N-06, FR-L-04 |
| I5 | FR-F-11, FR-F-14, FR-F-31 |
| I6, I7 | FR-F-53..55 |
| I8 | FR-F-24 |
| I9 | FR-F-37 |
| I10 | FR-F-61 |
| I11 | FR-F-62 |
| I12 | FR-T-01 |
| I13 | FR-D-12 |
| I14 | FR-D-13 |
| Specification rules (no letter or digit; non-ACTIVE edit 409; scripts in the task folder) | FR-W-01, FR-L-09, FR-T-30 |
| Phase 5 (three entry points; reuse templates; mockups binding) | FR-F-40..43; "Reusable Components"; "Visual Design" |
| Want (fields, statuses, cap, text checks, actions, edit reset) | FR-D-01, FR-W-01..09, FR-L-01..10 |
| Matching | FR-M-01..07 |
| Scan job | FR-S-01..06 |
| Notifications | FR-N-01..08 |
| API | FR-A-01..20 |
| Frontend | FR-F-01..70 |
| Scope boundaries: in scope | FR-D-04..13, FR-T-10..30, FR-X-15 |
| Scope boundaries: out of scope | "Out of Scope" |
| Technical considerations (standards, naive UTC, guards, statement counts, commands, secrets) | "Standards Compliance", FR-X-04, FR-T-18, FR-S-06 |
| Open questions of the requirements (thresholds, unrun checks, baseline) | "Open Questions / Risks", FR-D-01 fallback, FR-T-01, FR-T-30 |

### Audit coverage (`verification/spec-audit.md`, all findings applied)

| Finding | Applied in |
|---|---|
| H1 | FR-D-01 (`short_words_query`), FR-W-10, FR-T-11, AC-38 |
| H2 | FR-S-07, Risks, FR-T-12, AC-39 |
| H3 | Data model (set-based insert rule), FR-M-01, FR-N-02, AC-40 |
| M1 | FR-M-04, FR-M-05, AC-41 |
| M2 | FR-N-09, FR-N-06, FR-X-14, FR-T-13 |
| M3 | FR-M-07, FR-T-16, AC-42 |
| M4 | FR-X-02 |
| M5 | FR-F-33, FR-T-24, AC-44 |
| M6 | Key Decisions, FR-F-21, FR-F-63, FR-T-22, AC-46 |
| M7 | FR-F-65, FR-T-29 |
| M8 | Key Decisions, want response fields, FR-A-11, FR-F-12, FR-F-15, FR-F-31, AC-45 |
| M9 | FR-F-54, FR-T-25, AC-48 |
| M10, M11, L14 | FR-T-30, AC-07 |
| M12 | FR-N-08, AC-43 |
| L1, L2 | Key Decisions, FR-A-20, FR-F-34, FR-F-42 |
| L3 | FR-S-02 step 4, FR-S-04, AC-50 |
| L4 | FR-W-04 |
| L5 | FR-X-03 |
| L6 | FR-A-08, Risks |
| L7 | FR-W-02, AC-47 |
| L8 | FR-A-20 |
| L9 | FR-F-32, FR-F-39, AC-49 |
| L10 | FR-F-53 |
| L11 | FR-F-52, FR-F-66 |
| L12 | FR-X-15, FR-T-18 |
| L13 | Testing Approach, FR-T-10, FR-T-15 |
| L15 | Testing Approach |
| L16 | FR-S-08, Risks |
| L17 | FR-D-13 |
| Audit risks (prepositions, reverse-scan cost, stale pairs) | Risks |
