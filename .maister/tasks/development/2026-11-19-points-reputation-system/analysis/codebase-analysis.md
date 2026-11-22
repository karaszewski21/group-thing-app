# Codebase Analysis Report

**Date**: 2026-11-19
**Task**: Points & reputation system (System punktów i reputacji)
**Description**: Users earn non-transferable points for giving away, swapping and attending meetings, and spend them only on a few items offered "za punkty" (POINTS mode, max 5 active per user). Item value is 20/40/60, computed from `categories.size_class` x condition multiplier and snapped. Balance comes from an append-only double-entry ledger (`point_accounts`/`point_transactions`/`point_entries`). Reputation is a separate counter that is never spent. Anti-farming: per-pair 3/30 days and same-family = 0. Thresholds live in an admin-editable `points_config`. Visible only to the owner (own profile) and in the reservation window.
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

---

## TL;DR
- The codebase already has a full double-entry item ledger (`app/inventory`: `Account`/`InventoryTransaction`/`InventoryEntry`, `MOVEMENT_RULES`, flush-only `post_movement`). A `app/points` ledger can copy it almost one to one, using `point_` table names because `accounts` is taken. Migration 0004 was originally a points ledger.
- The spec assumes lifecycle steps the domain does not have: no receipt confirmation by the recipient with an objection window or 7-day auto-confirm, no swap confirmation by both parties (one confirm settles both legs), and no attendance check-in. Each one is either new domain work or a spec change.
- The natural commit point is `groups.confirm_transaction` (term_item_listings.py:1141-1175), which flushes and then commits inside `inventory.fulfill_exchange`. Points must be posted flush-only before that commit, through a new ACL from groups into points.
- A POINTS mode touches about 15 BE/FE enums and literals. The spend flow is not described in the spec (when the balance is debited, holds, refunds on cancel). This is the biggest open design gap.
- Overall: **Complex**, risk **Medium-High**. It changes the reservation core, adds a cross-module money-like ledger, and needs the first DB config table and a new scheduled job.

## Key Decisions
- **New bounded context `app/points`**, laid out like `app/wants`: models, domain, application, infrastructure/*_acl.py, router, schemas. Ledger tables `point_accounts` (one per party plus a singleton SYSTEM/emission account), `point_transactions` (type + source ref, unique `(type, source_type, source_id)` for idempotency) and `point_entries` (signed Integer amount, sum 0 per transaction, CHECK amount <> 0). A flush-only `post_points` checks `TRANSACTION_RULES` and the balance. Rationale: it mirrors the proven inventory ledger and its tests (`tests/ledger_assertions.py`).
- **Book points inside the same transaction as the item movement.** Groups calls a flush-only `award_*` through `groups/infrastructure/points_acl.py` in `confirm_transaction` before `inventory_bridge.fulfill_exchange` commits. Rationale: the spec says "w tym samym commicie". An outbox event would break that guarantee.
- **Serialise balance and the POINTS cap with a lock on the `point_accounts` row** (`SELECT … FOR UPDATE`, the `media/service.py::_lock_owner` precedent). Do not copy the wants cap, which counts without a lock and so has a race. Rationale: one lock covers both "balance never below 0" and "max 5 POINTS offers".
- **Store `points_value` on the item** (on `inventory_items`, or frozen on the listing preference when the POINTS offer is made). Compute it in `register_item`/`update_item` when condition or product (category) changes. Do not recompute it when `size_class` or the config changes. Rationale: spec section 1, "Przechowywanie".
- **Resolve `size_class` with an upward recursive CTE** (the `wants/application/reads.py::_category_paths` template with depth, `ORDER BY depth LIMIT 1` where it is not null, else MEDIUM). Write it with `join_from` per `queries.md` plus a linting compile test. Do not copy the comma-FROM form used in the existing wants/search CTEs.
- **Points and reputation come from a separate owner-only endpoint** (`GET /api/points/me`, `private, no-store`). The only other exposure is a field inside the reservation window response (`/actions`). Nothing goes into the `app/pages` public profile read, lists or search.

## Open Questions / Risks
Open product questions (for the orchestrator to ask the user in Polish):

1. **Potwierdzenie odbioru przy oddaniu (GIFT):** Dziś to odbiorca jednym „Potwierdź” kończy transakcję, a właściciel nie potwierdza nic. Nie ma kroku „sprzeciwu” ani auto-potwierdzenia po 7 dniach. Czy nagradzać przy obecnym potwierdzeniu odbiorcy? Czy budujemy nowy etap „przekazane → potwierdzone/sprzeciw/auto po 7 dniach” (nowy status, job w schedulerze, UI)? Jeśli tak, to od kiedy liczymy 7 dni (od `starts_at`/`occurs_on`, od potwierdzenia oddającego)?
2. **Wymiana „po potwierdzeniu przez obie strony”:** Dziś pierwsze potwierdzenie (dowolnej strony) realizuje obie nogi wymiany. Czy wystarczy to jedno potwierdzenie, czy wprowadzamy podwójne potwierdzenie?
3. **Obecność na terminie (+10):** Nie ma potwierdzania obecności, jest tylko RSVP (`TermAttendance`/`EventAttendance`). Kto ją potwierdza (organizator, check-in kodem, automatycznie przy zrealizowanej rezerwacji na terminie)? Czy dotyczy też wydarzeń (`events`), czy tylko terminów? Czy to wchodzi w zakres tego zadania (spec odsyła do „Otwartych pytań”)?
4. **Tryb POINTS — przepływ wydawania (brak w specyfikacji):** Kiedy pobieramy punkty: przy rezerwacji (blokada/hold), czy przy potwierdzeniu odbioru? Co, gdy saldo spadnie po rezerwacji, i jaki jest zwrot przy anulowaniu lub odrzuceniu? Czy POINTS jest jak GIFT (jedna noga) i czy oddający POINTS dostaje punkty i reputację? Czy POINTS działa w kontekście terminu, wydarzenia i odbioru osobistego?
5. **Komu punkty za oddanie:** Pierwotny dokument (`docs/system-wypozyczalni-inventory-accounting.md`) dawał 1 pkt oddającemu (obecnemu posiadaczowi). Spec daje oddającemu +points_value i reputację. Potwierdzić: odbiorca FREE nic nie traci ani nie zyskuje? A bonus „szukam” (+10) idzie do oddającego?
6. **Domyślna klasa kategorii:** Spec mówi „domyślnie MEDIUM” i jednocześnie „potomna bez ustawionej klasy dziedziczy”. To wymaga kolumny nullable (NULL = dziedzicz, korzeń bez wartości → MEDIUM). Czy migracja ustawia MEDIUM tylko korzeniom (żeby dziedziczenie działało), czy wszystkim kategoriom (wtedy dziedziczenie nic nie zmienia, dopóki admin nie wyczyści wartości)? Czy w panelu ma być opcja „dziedzicz”?
7. **Etykieta stanu FAIR:** W UI jest „Znośny”, w specyfikacji „Znoszony” (mnożnik 0.75). Czy zmieniamy etykietę w UI?
8. **Konfiguracja w bazie:** `points_config` byłaby pierwszą tabelą konfiguracyjną. Dotąd progi są stałymi w kodzie (`minimal-implementation.md`). Czy na pewno chcemy edycję w panelu admina (jedna tabela-wiersz + endpointy ADMIN + strona admina)? Które wartości mają być edytowalne (base, mnożniki, progi snap, START_BONUS, +10, limit 5, 3/30 dni)? Czy zmiana ma wpływ wyłącznie na przyszłe zdarzenia?
9. **Rodzina:** Czy „to samo konto rodzinne” oznacza aktywne członkostwo w tej samej rodzinie (`FamilyMembership`) dowolnej z ról, czy tylko relację opiekun–dziecko? Czy konta dzieci (bez `account_user_id`) w ogóle mają konto punktowe?
10. **Reputacja:** Czy reputacja to osobna księga (osobne konto lub typ zapisu), czy prosty licznik wyliczany z transakcji GIVE_FREE? Czy kiedykolwiek maleje (np. przy cofnięciu)?
11. **START_BONUS:** Czy liczy się też zapis organizatora lub zapis „w imieniu” dziecka przez opiekuna? Czy wypis i ponowny zapis nic nie zmienia (raz na konto)? Czy dotyczy kont osób, czy również Organizacji?
12. **Widoczność salda w oknie rezerwacji:** Czy pokazujemy tylko saldo oglądającego i cenę przedmiotu POINTS, czy też punkty, które oddający zyska przy GIFT?

Technical risks:
- `confirm_transaction` is the single hot path for all three contexts (term, event, personal). A bug there blocks every exchange.
- The module boundary guard (`tests/test_module_boundaries.py`) cannot simply list `points`, because groups (and events, for START_BONUS) must call it synchronously. A deliberate ACL direction (groups → points) is needed, plus a guard against points importing groups.
- Reservations are keyed by user ids (`giver_user_id`, `reserved_by_user_id`), while points accounts are per party. Each award must map user → party via `UserProfile.account_user_id`.
- A POINTS mode ripples through `ReservationType`, `MovementType`, `_OFFERABLE_RESERVATION_TYPES`, `ExchangeMode`, the search `offer_type` filter, organization stats (`Record<ExchangeMode, number>`), wants `offer_mode` and around 6 FE types. Missing one leaves silent UI holes.
- The 7-day auto-confirm (if chosen) needs its own scheduled query. `term_end_scan` only notifies, and personal pickups have no end-of-date scan.
- The append-only rule is held by convention only. There is no trigger or REVOKE precedent.

---

## Summary

All the building blocks exist: a balanced double-entry ledger with rules and tests, row-lock patterns for caps, outbox and APScheduler jobs, admin CRUD for categories, recursive category CTEs, and a family model. The points ledger, valuation and admin config are therefore mostly pattern copies. The hard part is that the spec's earning triggers (two-sided swap confirmation, recipient objection with 7-day auto-confirm, confirmed attendance) and the POINTS spend flow have no counterpart in the current reservation lifecycle. They have to be designed or the spec rescoped before planning.

---

## Files Identified

### Primary Files

**src/backend/app/inventory/models.py** (399 lines)
- `ItemCondition` (80-85), `ReservationType` (98-105), `MovementType` (~62), `InventoryItem` (184-236; no points/category column), `Reservation` (giver_user_id :294, ck context :266), and the ledger models `Account` (124-163), `InventoryTransaction` (329-357), `InventoryEntry` (360-399). These are the templates for the points models. `_enum_column` is at 44-54.

**src/backend/app/inventory/infrastructure/ledger.py** (276 lines)
- Contract docstring (1-28), `MovementRule`/`MOVEMENT_RULES` (65-122), `post_movement` (137-188, balance check 160-164, flush only). This is the template for `app/points/infrastructure/ledger.py::post_points`. POINTS needs a new rule entry shaped like GIFT.

**src/backend/app/inventory/application/reservation_transitions.py** (246 lines)
- `_fulfill` 114-143, `_post_fulfilment` 180-193 (`MovementType(reservation_type.value)` at 185), `fulfill_exchange` 205-230 (commits at 227), `cancel_exchange` 233-246, id-ordered batch locking 98-104. Uses `datetime.utcnow()`; the inventory module is not clock-guarded.

**src/backend/app/groups/application/term_item_listings.py** (1192 lines)
- `list_registered_item` 123-139 and `set_item_listing_preference` 142-198 (item FOR UPDATE; where the POINTS cap goes), `_take` 640-707, `take_item` 710, `propose_item_swap` 725 / `_propose` 765-858, `_may_confirm` 874-884, `accept_swap_proposal` 916-1020, reject 1023, `_resolve_transaction_reservations_for_action` 1066-1138, **`confirm_transaction` 1141-1175 (award hook before line ~1172)**, `cancel_transaction` 1178-1192.

**src/backend/app/groups/infrastructure/inventory_bridge.py** (303 lines)
- `fulfill_exchange` bridge (164-170). Model for a new `points_acl.py`.

**src/backend/app/groups/domain/confirm_race_rules.py** (36 lines)
- `_require_recipient_to_confirm_gift`. Encodes the "only the recipient confirms a gift" rule that conflicts with the spec.

**src/backend/app/groups/application/reservation_context.py**
- `TermContext` 62, `EventContext` 125, `PersonalContext` 188, union 244. `require_ended` at 77/142/206 (personal is always ended).

**src/backend/app/groups/models.py** (444 lines)
- `ItemListingPreference.mode` String(20) GIFT|SWAP (339-375), `SwapProposal` (378-429), `TermAttendance` (310-336), `GiveawayTermEndMarker` (432-444).

**src/backend/app/groups/schemas.py** (935 lines)
- `_OFFERABLE_RESERVATION_TYPES` :30, `ExchangeMode` Literal :431, `SetItemListingPreferenceRequest` ~588, `ItemPartyReservationResponse` 774, `ItemActionsResponse` 790 (where the reservation-window balance and price go).

**src/backend/app/groups/application/public_view.py** (461 lines)
- `create_rsvp` 403-461. Insert branch 446-452, commit 453: START_BONUS hook. Requires `account_user_id`.

**src/backend/app/events/service.py** (484 lines)
- `sign_up` 383-413 (savepoint + IntegrityError; insert branch 398-408, commit 409): START_BONUS hook. Withdraw 413.

**src/backend/app/category/models.py** (71 lines) / **category/service.py** (279 lines) / **category/router.py** / **category/schemas.py**
- Add nullable `size_class`. CRUD commits in the service. `_REFRESH_SUBTREE_PATH_TEXT` and the subtree CTE are at 37-55. `require_leaf_category` 156. Admin routes use `AdminPrincipal` (router :34).

**src/backend/app/inventory/application/inventory_items.py**
- `register_item` 43-97 (listing_mode via the on_registered hook 51-94) and `update_item` 260-283. Points value is computed and recomputed here. `inventory/schemas.py:98-104` currently says listing_mode "may only be SWAP or GIFT".

**src/backend/app/core/authorization_matrix.py** (270 lines)
- New rows 68+ (highest is 66-67), placed before the catch-all "# 25". Precedents: row 56 categories ADMIN, row 64 confirm/cancel EDIT, row 42 reservations.

**src/backend/app/main.py** (290 lines)
- Router includes (~271-290, before `system_router`), outbox `register()` in the lifespan, APScheduler jobs (76-88, 232-242). A 7-day job would go here.

**src/frontend/src/features/admin/CategoryFormPage.tsx** (166 lines), **CategoryListPage.tsx** (338 lines)
- Add a size_class select (with an "inherit" option). `api/categories.ts`, `hooks/useCategories.ts`.

**src/frontend/src/features/product/PartyReservationActions.tsx** (123 lines) and `blocks/ItemPickupActions.tsx` (ChooseActions 165), `ChooseContextSheet.tsx`, `PersonalPickupSheet.tsx`, `TakeSuccessSheet.tsx`, `useItemTake.ts` (performTake 109), `SwapProposeDialog.tsx`, `blocks/ItemStatus.tsx`
- The reservation window, where balance and price are shown and a POINTS take happens.

**src/frontend/src/features/profile-public/PartyProfilePage.tsx** (38 lines) and `blocks/ProfileHero.tsx` (:29 `is_me` gate), `ProfileStartHere.tsx`, `ProfileOrganizerInvite.tsx`, `PartyProfileContext.ts`, `layouts/registry.ts`, `ProfileLayoutRenderer.tsx`
- An owner-only points block gated on `is_me`, fed by a separate hook and endpoint. Alternative host: `features/account/AccountView.tsx`.

### Related Files

- **docs/system-wypozyczalni-inventory-accounting.md**: the original points design (accounts 100-100 "Saldo punktów użytkownika", 900-100 "Emisja punktów za obieg"; 1 point to the current holder/giver, not to `reservedBy`).
- **src/backend/alembic/versions/0102_item_owner_inventory.py**: head; next is 0103. `env.py` `target_metadata = None` means migrations are hand-written. 0004 was originally a points ledger, 0042 became the item ledger, 0084 renamed it.
- **src/backend/app/groups/application/term_end_scan.py**: `scan_for_term_ended` 294, DEFAULT_WINDOW 24h, TERM_END_GRACE 2h. Notifies only. A template for a scheduled job.
- **src/backend/app/wants/models.py**: `Want.seeker_party_id` 85, `WantMatch` 171-225 (tier MATCH/SUGGESTION/SIMILAR, unique (want_id,item_id)), `offer_mode` String(20) 98. Bonus check: a MATCH row for the item whose seeker = recipient party (MATCH-only lookup at `wants/application/reads.py:195-210`).
- **src/backend/app/wants/domain/limits.py**, **wants/application/writes.py:87**: the cap pattern (`MAX_ACTIVE_WANTS`, `CAP_REACHED_MESSAGE`). It has an unlocked count; do not copy the race.
- **src/backend/app/media/service.py:225-228**: `_lock_owner`, the lock-then-count precedent.
- **src/backend/app/families/models.py** (FamilyRoleType GUARDIAN/CHILD 38-45, FamilyMembership), **families/repository.py** (`list_families_for_guardian_party`), **families/guardians.py**, **groups/infrastructure/repository.py:393** `list_family_party_ids`, **groups/application/exchange_summary.py:95** `_resolve_family_guardians`.
- **src/backend/app/users/models.py** (UserProfile 45-74; `account_user_id` nullable for children, :64), **users/service.py** `get_profile_by_account_user_id`, **party/models.py** (Party PERSON/ORGANIZATION 40-54), **auth/models.py:26** ADMIN.
- **src/backend/app/search/application/search.py** (offer_type filter 115, 309; `_category_subtree` 230). POINTS items must be excluded or handled.
- **src/backend/app/groups/application/item_actions.py** (`get_item_actions` 54, `_party_reservation` 256).
- **src/backend/app/notifications/models.py** (`NotificationKind` :37; VARCHAR(30) without CHECK), **groups/infrastructure/notifications_bridge.py**, **notifications/outbox_listener.py**, **outbox/service.py** (`append`), **outbox/registry.py**.
- **src/backend/app/core/base_model.py**, **core/clock.py**, **core/errors.py**, **core/auth_deps.py**, **app/db.py** (TRANSACTION_CONFLICTS 40P01/40001 → 409).
- **src/backend/app/pages/application/owner_pages.py**, **pages/schemas.py** (`is_me`): do not put points here (public read).
- FE enum surface: `api/inventories.ts` (:8 condition, :115 MyItemsModeFilter), `api/itemListingPreferences.ts:4` ListingMode, `api/groups.ts:297` ExchangeMode, `api/reservations.ts:55`, `api/organizations.ts:87` OrganizationItemStats, `features/terms/components/termLabels.ts` (:5 LISTABLE_RESERVATION_TYPES, EXCHANGE_MODE_LABELS, INTENT_LABELS, EXCHANGE_MODE_TONE), `features/panel/AppDataContext.tsx` RESERVATION_TYPE_TO_ITEM_MODE, `utils/productCategory.ts:3-9` (condition labels, "Znośny"), `features/wanted/OfferModeChips.tsx`.
- FE item forms: `features/items/ItemCreateView.tsx` (submit(mode) :70, per-mode buttons 132/140), `blocks/ExchangeModeTabs.tsx`, `ItemEditView.tsx`, `features/product/ItemEditForm.tsx`, `MyItemsView.tsx`, `hooks/useCreateItem.ts`.
- FE admin shell: `app/admin/(shell)/layout.tsx`, `app/admin/(shell)/categories/*`, `components/layout/Sidebar.tsx:93-96`, `MobileDrawer.tsx:87`, `routing/paths.ts`, `src/test/routeManifest.test.ts:63-75`.

---

## Current Functionality

### Exchange lifecycle (as built)
- **Take (GIFT):** `_take` creates a PENDING reservation (takes on SWAP items are rejected). Confirm is allowed once the context has ended (term `occurs_on`, event `starts_at`, personal always). Only the **recipient** confirms a gift. `confirm_transaction` deletes the listing preferences, flushes, and calls `fulfill_exchange`, which confirms and fulfils each leg, posts the ledger movement (ownership transfer, pickup location cleared) and **commits**.
- **Swap:** `_propose` creates a proposal and confirms the proposer's leg at once. The owner accepts (pairing reservations, auto-rejecting competitors). Then the **first confirm from either party** fulfils both legs; later attempts get `TermAlreadyResolvedException`.
- **Cancel:** `cancel_transaction` → `cancel_exchange`.
- **No** objection window, **no** 7-day auto-confirm, **no** attendance confirmation. `Reservation.expires_at` is only copied to `due_date`. `term_end_scan` only sends `TERM_CONFIRMATION_NEEDED` notifications.
- **Attendance:** RSVP rows only (`TermAttendance` reused per party/term with `withdrawn_at`; `EventAttendance` with a partial unique index on active rows). Term organizers never sign up.

### Key Components/Functions
- **post_movement**: the only ledger writer. It validates the per-item sum with a Counter, raises `ValueError("Unbalanced…")` before writing, flushes and never commits.
- **MOVEMENT_RULES**: one rule per movement type, pinned by `test_movementRules_everyMovementType_hasRule`.
- **set_item_listing_preference**: one preference row per item (row exists ⇔ ACTIVE). This is where mode is chosen and the POINTS cap goes.
- **Category tree**: `parent_id` self-FK without `relationship()`, leaf-only products, `path_text`.
- **Valuation inputs**: `InventoryItem.condition` and `Product.category_id`. Category is indirect, so a value recompute must also run when an item's product changes and, if the spec requires, when a product's category changes.

### Data Flow (target)
confirm (router) → `groups.confirm_transaction` → [new] `points_acl.award_exchange(...)` flush-only (map user ids → parties, anti-farming checks, family check, wants MATCH bonus, lock the point account, `post_points`) → `inventory_bridge.fulfill_exchange` → single commit.

---

## Dependencies

### Imports (what `app/points` would depend on)
- `app.core` (BaseEntity, clock, errors, auth_deps), `app.db`
- ACLs: category (size_class resolution), inventory (item condition/product), users (user → party, child detection), families (same-family), wants (MATCH lookup), optionally groups/events (attendance)

### Consumers (what would call points)
- **groups/application/term_item_listings.py**: awards at confirm; POINTS cap and debit at listing/take
- **groups/application/public_view.py**: START_BONUS on the first term RSVP
- **events/service.py**: START_BONUS on the first event sign-up
- **inventory/application/inventory_items.py**: points_value on create/update
- **groups/application/item_actions.py**: balance and price in the reservation window
- **main.py**: router, possible scheduler job
- FE: profile block, reservation window, item forms, admin config page, category form

**Consumer Count**: about 6 BE modules, about 10 FE files
**Impact Scope**: High. It touches the shared exchange commit path and the offer-mode enum across BE, FE, search and wants.

---

## Test Coverage

### Test Files
- **tests/test_inventory_ledger.py**, **tests/ledger_assertions.py**: ledger shapes and balancing. Mirror these in `test_points_ledger.py` and `point_ledger_assertions.py`.
- **tests/test_inventory_ledger_tables_migration.py**, **tests/test_item_owner_inventory_migration.py**: migration downgrade/upgrade pattern (`_alembic` from `test_personal_pickup_migration`).
- **tests/test_term_end_scan.py**: scheduled job pattern.
- **tests/test_wants_api.py:334**, **test_wants_lifecycle.py:223**: cap tests.
- **tests/test_category_module.py**, **test_category_tree.py**, **test_category_path_text.py**: category CRUD and CTE.
- **tests/test_authorization_matrix.py**, **tests/test_module_boundaries.py**, **tests/test_domain_clock_guard.py**: guards to extend.
- **tests/conftest.py**: `db_session`, `client`, `freeze_local_now`, `count_queries`, `leaf_category_ids`, `create_location`, `seed_want_matches`.
- FE: `PartyProfilePage.test.tsx`, `partyProfileViewState.test.ts`, `ItemCreateView.test.tsx`, `ItemEditView.test.tsx`, `CategoryFormPage.test.tsx`, `CategoryListPage.test.tsx`, `useReservationSettlement.test.tsx`, `itemActionsViewState.test.ts`, `organizerKeyParity.test.ts`, `routeManifest.test.ts`, `NotificationBell.test.tsx`, `pendingActions.test.ts`.

### Coverage Assessment
- The exchange and ledger areas are well tested; new code can follow existing tests.
- **Gaps**: no tests for concurrent cap or balance (no precedent with a lock), no append-only enforcement tests, no double-confirm or auto-confirm tests (the feature does not exist). Known baseline failures exist (33 vitest, 2 stale backend); these are not regressions.

---

## Coding Patterns

### Naming Conventions
- **Tables/constraints**: plural snake_case; `pk_`/`fk_<table>_<col>_<ref>`/`ix_`/`uq_`/`ck_`; `point_` prefix (`accounts` is taken).
- **Enums**: `StrEnum` + VARCHAR via a per-module `_enum_column` (native_enum=False).
- **Functions**: flush-only helpers (`post_*`, `award_*`), one commit per use case in the application layer.
- **Tests**: flat `tests/test_points_*.py`, `test_<operation>_<scenario>_<expected>` camelCase, migration test `test_migration0103_downgradeUpgrade_…`.
- **FE**: `api/points.ts` snake_case interfaces, `hooks/usePoints.ts` with a prefix-constant key, features in `src/features/points/` or profile blocks.

### Architecture Patterns
- **Style**: layered BC (router → application → domain (pure) / infrastructure ACLs), cross-module FK-id columns, no cross-module `relationship()`, `lazy="raise"`.
- **Concurrency**: `updated_at` version column → StaleDataError 409; `FOR UPDATE` on the owning row before count or sum; 40P01/40001 → 409; idempotency via unique source key + IntegrityError.
- **Config**: module constants so far; `points_config` would be new (single-row table, defaults seeded in a separate data migration).
- **Time**: naive UTC audit via `datetime.utcnow()` passed from the router; `clock.local_now()` for term logic; add `app/points` to `_GUARDED_DIRS`.
- **FE state**: TanStack Query hooks, `private, no-store` owner reads, `ConfirmDeleteDialog`/`ModalSheet` for confirmations.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~25 BE + ~20 FE files touched; term_item_listings.py 1192 lines | High |
| Dependencies | points needs 5-6 ACLs | Medium |
| Consumers | ~6 BE modules + FE enum surface | High |
| Test Coverage | strong ledger/exchange tests to extend | Low (risk) |

### Overall: Complex
A new financial-style BC, plus a new offer mode that ripples through enums, plus missing lifecycle steps (confirmation and attendance), plus the first DB config with an admin UI. The ledger part is low-risk copying. The lifecycle and spend parts carry the design risk.

---

## Key Findings

### Strengths
- A proven double-entry ledger with rules, a balance check, flush-only writes and test assertions exists to copy.
- One commit point (`confirm_transaction` → `fulfill_exchange`) covers term, event and personal contexts.
- Lock-then-count precedent (`_lock_owner`) and unique-key idempotency patterns are in place.
- Category CTE templates (up and down) and admin category CRUD are ready to extend.
- Family, child and wants MATCH data needed for anti-farming and the bonus already exist.

### Concerns
- Spec/domain mismatches: two-sided swap confirmation, the GIFT objection and 7-day auto-confirm, attendance confirmation.
- The POINTS spend flow is not specified (debit timing, hold, refund on cancel, balance check under concurrency).
- `size_class` "default MEDIUM" and "inherit" contradict each other unless the column is nullable.
- FAIR label differs ("Znośny" in the UI vs "Znoszony" in the spec).
- Reservations are keyed by user, points by party, so user → party mapping is needed (children have no `account_user_id`).
- Module boundary guard: a synchronous groups → points call needs an explicit ACL direction.
- `points_config` departs from the constants convention (`minimal-implementation.md`); confirm with the user.
- The existing wants/search recursive CTEs break `queries.md` (comma-FROM); the new CTE must not copy them.
- Points must not leak into `app/pages`, search or lists.

### Opportunities
- Reuse the `term_end_scan` scheduler shape for an auto-confirm job if one is chosen.
- `uq_point_transactions_type_source` makes every award idempotent and retry-safe.
- One `point_accounts` row lock serialises both the balance and the POINTS cap.

---

## Impact Assessment

- **Primary changes**: new `app/points/*`; `groups/application/term_item_listings.py` (confirm awards, POINTS cap/take/debit), `groups/infrastructure/points_acl.py`, `groups/schemas.py`, `inventory/models.py` + `ledger.py` (POINTS reservation/movement type + rule, points_value), `inventory/application/inventory_items.py`, `category/*` (size_class), `public_view.py` + `events/service.py` (START_BONUS), `authorization_matrix.py`, `main.py`, migrations 0103+ (schema; seed config/system account separately).
- **Related changes**: `search/application/search.py`, organization stats, `wants` offer_mode, `item_actions.py`, notifications (optional kinds ≤30 chars), FE enums and labels, item forms, reservation window, profile block, admin config page + nav + route manifest, `architecture.md` + `INDEX.md`, root `CHANGELOG.md` (Polish bullets).
- **Test updates**: new points ledger/award/cap/anti-farming/valuation/migration tests; extend matrix, boundary and clock guards; FE tests for forms, profile, reservation window, admin.

### Risk Level: Medium-High
The work changes the shared exchange commit path and adds a balance that must never go negative under concurrency. It also widens a cross-stack enum and depends on lifecycle features that do not exist yet. The ledger itself is low-risk.

---

## Recommendations

**Creating new capability + modifying existing code:**

1. **Resolve the product questions first** (list above). Especially #1-#4: they decide whether this is a points feature or a points-plus-new-reservation-lifecycle feature. A sensible way to phase it:
   - Phase 1: ledger, valuation, START_BONUS, GIFT/SWAP awards at the existing confirm, anti-farming, owner-only display.
   - Phase 2: POINTS mode and spending.
   - Phase 3: objection with 7-day auto-confirm, attendance, double confirmation.
2. **Ledger**: copy `Account`/`InventoryTransaction`/`InventoryEntry` → `PointAccount`/`PointTransaction`/`PointEntry`. Add a SYSTEM emission account (partial unique, like EXTERNAL), `TRANSACTION_RULES` with a completeness test, Integer amounts, CHECK amount <> 0, unique `(type, source_type, source_id)`, history ordered by `(occurred_at, id)`, and `point_ledger_assertions.py`. Balance = `SUM(amount)` after locking the account row.
3. **Awards in `confirm_transaction`**: call flush-only `points_acl.award_for_exchange(...)` before `fulfill_exchange`. Map giver and recipient user ids → parties, skip children, apply the family check, then the pair 3/30-day count (under the account lock), then add the wants MATCH bonus. A zero-value award is either still recorded as a 0-point transaction for audit or skipped (decide).
4. **Valuation**: a pure function in `points/domain/valuation.py` (base x multiplier → snap), table-tested with the spec's examples. `size_class` resolved by a `join_from` recursive CTE plus a lint compile test. Store the value; recompute only on condition or product change.
5. **POINTS cap**: enforce in `set_item_listing_preference` and `list_registered_item` under a `point_accounts` (or Party) row lock. Count ACTIVE POINTS preferences of the owner party.
6. **Config**: if the user confirms DB config, add a single-row `points_config` (CHECK id singleton or fixed PK), seeded in a data migration, with ADMIN GET/PUT routes (new matrix rows) and an admin page + nav + route manifest. Otherwise use constants in `points/domain/rules.py`.
7. **START_BONUS**: hook only the insert branches of `create_rsvp` and `events.sign_up`. Idempotency comes from the unique source key `(START_BONUS, party)`. Skip child profiles.
8. **Exposure**: `GET /api/points/me` (EDIT/READ, `private, no-store`); viewer balance and item price added to `ItemActionsResponse` only for the logged-in viewer. Nothing goes into `app/pages`, lists or search.
9. **Boundaries**: allow groups/events/inventory → `points` only through their `infrastructure/points_acl.py`; points reaches others only through its own ACLs. Add a boundary test that points does not import groups. Add `app/points` to the clock guard.
10. **Migrations**: 0103 schema (point tables, `categories.size_class` nullable with `lock_timeout`, `points_value`), 0104 data (SYSTEM account, config defaults, root categories MEDIUM if chosen). Downgrade guarded once point entries exist, with the runbook in `architecture.md`.

---

## Next Steps
Invoke **gap-analyzer** with this report. Before specification, the orchestrator should ask the user the 12 open product questions above (in Polish), at minimum #1-#4, #6 and #8, and decide whether to phase the scope.
