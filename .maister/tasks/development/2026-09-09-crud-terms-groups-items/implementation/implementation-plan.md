# Implementation Plan: Edit / soft-delete for Term, Group, NeededItem, InventoryItem

Date: 2026-09-09
Task: `2026-09-09-crud-terms-groups-items`
Source spec: `implementation/spec.md` (authoritative). `analysis/codebase-analysis.md` is STALE (assumes `Term.deleted_at` + term delete) — spec overrides.

## Overview

- Task Groups: 6
- Total Steps: 63 (leaf steps, excluding the `N.0` group parents)
- Expected Tests: 28-38 total (G1: 3, G2: 8, G3: 6, G4: 5, G5: 6, G6: ≤10)
- Testing group: yes (G6)
- Visual references / visual-coverage.md: N/A — no `analysis/design-context/`; Phase 4 mockups skipped by user. UI is specified in-prose in spec §R7 / §9.
- No TDD red/green gate (`has_reproducible_defect: false`).

### Dependency graph

```
G1 (migration + models + read-site filters)  ── foundation
 ├─> G2 (backend groups vertical: Term/NeededItem/Group PATCH+DELETE, matrix rows)
 ├─> G3 (backend circulation vertical: InventoryItem PATCH+DELETE, matrix rows)
 │      NOTE: G2 & G3 both edit app/core/auth_deps.py -> executor serializes them.
 │            The auth_deps matrix TEST update belongs to whichever of G2/G3 the
 │            executor runs second (default: G3).
 ├─> G4 (frontend api wrappers + term inline edit + circle rename)   depends on G2
 └─> G5 (frontend NeededItem sub-CRUD + InventoryItem edit/delete UI) depends on G2, G3, G4
G6 (test review & gap analysis) depends on G1-G5
```

Concurrency note for the executor: G2 and G3 are logically independent but share `app/core/auth_deps.py` (both add matrix rows) — run them sequentially. G4 may start once G2 lands; G5 needs G2+G3 backend and G4's api module scaffolding.

---

## Execution Order

1. G1 — Migration 0017 + models + soft-delete read filters (9 steps)
2. G2 — Backend groups vertical: Term/NeededItem/Group (16 steps, depends on G1)
3. G3 — Backend circulation vertical: InventoryItem (11 steps, depends on G1; serialized after G2 on `auth_deps.py`; owns the matrix-test update)
4. G4 — Frontend: api wrappers + term inline edit + circle rename (10 steps, depends on G2)
5. G5 — Frontend: NeededItem sub-CRUD + InventoryItem edit/delete UI (11 steps, depends on G2, G3, G4)
6. G6 — Test review & gap analysis (6 steps, depends on G1-G5)

---

## Implementation Steps

### Task Group 1: Migration 0017 + Models + Soft-Delete Read Filters

**Dependencies:** None
**Files to Modify:**
- `src/backend/alembic/versions/0017_needed_item_inventory_item_soft_delete.py` (new)
- `src/backend/app/groups/models.py` (`NeededItem.deleted_at`)
- `src/backend/app/circulation/models.py` (`InventoryItem.deleted_at`)
- `src/backend/app/groups/service.py` (`list_needed_items`, `get_needed_item`, `list_pledges`, `get_public_circle_view` needed-items branch)
- `src/backend/app/circulation/service.py` (`list_items`, `get_item`)
- `src/backend/tests/test_public_term.py` (extend)
**Estimated Steps:** 9

- [x] 1.0 Complete migration + models + read-site filter foundation
  - [x] 1.1 Write 3 focused tests
    - `src/backend/tests/test_public_term.py::test_getPublicCircle_softDeletedNeededItem_notReturned` — soft-delete a needed item directly (set `deleted_at`), assert it is absent from `GET /api/{slug}/grupa/{groupId}` public circle view.
    - `src/backend/tests/test_public_term.py::test_getPublicCircle_termWithNeededItems_unaffectedAfterSiblingDelete` — sibling needed items on the same term still returned.
    - `src/backend/tests/test_groups.py::test_getNeededItem_softDeleted_returns404` — `get_needed_item` / `GET /api/needed-items/{id}` returns 404 when `deleted_at` set.
    - These stay red until 1.2-1.7 land; run only these 3 (plus the migration check in 1.3).
  - [x] 1.2 Create `src/backend/alembic/versions/0017_needed_item_inventory_item_soft_delete.py`
    - `revision = "0017"`, `down_revision = "0016"` (confirm 0016 is current head first: `cd src/backend && uv run alembic heads`).
    - `upgrade()`: `op.add_column("needed_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))` + identical for `inventory_items`.
    - `downgrade()`: `op.drop_column("inventory_items", "deleted_at")` + `op.drop_column("needed_items", "deleted_at")`.
    - No partial index, no sequence, no app-code import. Follow `standards/backend/migrations.md` (one logical change, reversible, `NNNN_` naming).
  - [x] 1.3 Verify migration round-trips
    - `cd src/backend && uv run alembic upgrade head` then `uv run alembic downgrade -1` then `uv run alembic upgrade head` against the test container — clean each way.
  - [x] 1.4 Add `deleted_at` to models
    - `NeededItem` (`app/groups/models.py`): `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)`. NOT on `BaseEntity`.
    - `InventoryItem` (`app/circulation/models.py`): same.
    - `standards/backend/models.md` §169-170: per-concrete-model column, no soft-delete mixin.
  - [x] 1.5 Filter `needed_items` list read
    - `app/groups/service.py::list_needed_items` — add `.where(NeededItem.deleted_at.is_(None))` (central filter).
  - [x] 1.6 404-on-soft-deleted for `get_needed_item`
    - `app/groups/service.py::get_needed_item` — keep `db.get(...)`, then `if needed_item is not None and needed_item.deleted_at is not None: raise EntityNotFoundException("NeededItem", needed_item_id)`.
    - Propagates to `create_pledge`, `fulfill_pledge`, router `GET /api/needed-items/{id}`.
  - [x] 1.7 Guard `list_pledges` + verify public circle view
    - `app/groups/service.py::list_pledges` — add `await get_needed_item(db, needed_item_id)` guard at the top so `GET /api/needed-items/{id}/pledges` → 404 once parent is soft-deleted. Leave `get_pledge` / pledge-lifecycle reads untouched.
    - `get_public_circle_view` needed-items branch — CONFIRM it routes through `list_needed_items` (spec Assumption 5). If it has its own `select(NeededItem)`, add an explicit `.where(NeededItem.deleted_at.is_(None))`. Document which case was found in the work-log.
  - [x] 1.8 Filter `inventory_items` reads
    - `app/circulation/service.py::list_items` — add `.where(InventoryItem.deleted_at.is_(None))`.
    - `app/circulation/service.py::get_item` — keep `db.get(...)`, then `if item is not None and item.deleted_at is not None: raise EntityNotFoundException("InventoryItem", item_id)`. Propagates to `create_reservation`, `create_swap`, confirm/cancel/fulfill, `_current_holder_user_id`, cross-BC `fulfill_pledge`.
  - [x] 1.9 Ensure the 3 tests from 1.1 pass
    - Run only: `cd src/backend && uv run pytest tests/test_public_term.py tests/test_groups.py::test_getNeededItem_softDeleted_returns404 -q`. Do NOT run the full suite.

**Acceptance Criteria:**
- Migration 0017 applies and reverses cleanly against the test container.
- `NeededItem.deleted_at` and `InventoryItem.deleted_at` mapped as nullable `datetime | None`.
- Every read site in spec §7 checklist is covered: `list_needed_items`, `get_needed_item` (→404), `list_pledges` guard, `get_public_circle_view` needed-items branch, `list_items`, `get_item` (→404).
- The 3 tests pass; no full-suite run.

---

### Task Group 2: Backend Groups Vertical — Term / NeededItem / Group PATCH + DELETE

**Dependencies:** G1 (needs `NeededItem.deleted_at` column + read filters)
**Files to Modify:**
- `src/backend/app/groups/schemas.py` (`UpdateTermRequest`, `UpdateNeededItemRequest`, `UpdateGroupRequest`/`UpdateCircleRequest`)
- `src/backend/app/groups/service.py` (`update_term`, `update_needed_item`, `soft_delete_needed_item`, `update_group`)
- `src/backend/app/groups/router.py` (`PATCH /api/terms/{id}`, `PATCH`+`DELETE /api/needed-items/{id}`, `PATCH /api/groups/{id}`)
- `src/backend/app/core/auth_deps.py` (3 matrix rows — terms PATCH, needed-items PATCH+DELETE, groups PATCH) — SHARED with G3
- `src/backend/tests/test_groups.py` (extend)
**Estimated Steps:** 16

- [x] 2.0 Complete the groups-context edit/delete surface
  - [x] 2.1 Write 8 focused tests in `src/backend/tests/test_groups.py`
    - `test_patchTerm_activeOrganizer_updatesInPlace` — PATCH `occurs_on` only → 200, `description` unchanged, `updated_at` bumped.
    - `test_patchTerm_nonOrganizer_returns403`
    - `test_patchTerm_unknownId_returns404`
    - `test_patchTerm_invalidBody_returns400` — non-date `occurs_on` or `description` > 2000 chars.
    - `test_patchNeededItem_activeOrganizer_updatesCategory` — 200, in place.
    - `test_deleteNeededItem_openAndClaimedPledges_transitionsToWithdrawn` — 204, both pledges `WITHDRAWN`, `deleted_at` set, absent from `list_needed_items`.
    - `test_deleteNeededItem_fulfilledPledgeExists_returns409` — item + pledge + resolved reservation all unchanged.
    - `test_patchGroup_blankName_returns400` (plus assert `test_patchGroup_activeOrganizer_renamesInPlace` path inside same test or a 9th if needed; keep ≤8 — fold non-organizer/unknown-id term coverage is already above, so use the 8 slots as listed).
    - Additional lightweight asserts allowed inside these tests (e.g. non-organizer group PATCH → 403) without adding test functions.
  - [x] 2.2 Add schemas to `app/groups/schemas.py`
    - `UpdateTermRequest`: `occurs_on: date | None = None`, `description: str | None = Field(default=None, max_length=2000)`.
    - `UpdateNeededItemRequest`: `category: NeededItemCategory | None = None`, `description: str | None = Field(default=None, max_length=<match CreateNeededItemRequest>)`. Keep max_length identical to create.
    - `UpdateGroupRequest` (alias `UpdateCircleRequest`): required `name: str = Field(min_length=1, max_length=255)` + blank-rejecting `field_validator` mirroring `UpdateFamilyRequest._reject_blank_name` (`families/schemas.py:43-49`).
  - [x] 2.3 `update_term(db, term_id, caller_party_id, data)` in `app/groups/service.py`
    - `term = await get_term(db, term_id)` (404) → `await _require_active_organizer(db, term.circle_group_id, caller_party_id)` (403) → partial-apply (`if data.occurs_on is not None: ...`, `if data.description is not None: ...`) → `await db.commit(); await db.refresh(term); return term`.
    - Structural copy of `update_organization` (`organizations/service.py:118-136`).
  - [x] 2.4 `update_needed_item(db, needed_item_id, caller_party_id, data)`
    - Ownership gate: `ni = await get_needed_item(db, needed_item_id)` (404, incl. soft-deleted via G1) → `term = await get_term(db, ni.term_id)` → `await _require_active_organizer(db, term.circle_group_id, caller_party_id)` (403).
    - Partial-apply `category` / `description` → commit / refresh / return.
  - [x] 2.5 `soft_delete_needed_item(db, needed_item_id, caller_party_id)` — one transaction
    - Same ownership gate as 2.4.
    - Load pledges: `select(Pledge).where(Pledge.needed_item_id == ni.id)`.
    - If any `pledge.status == PledgeStatus.FULFILLED` (equiv. `resolved_reservation_id is not None`) → `raise BusinessConflictException("Nie można usunąć — rzecz została już dostarczona")` before any write → 409.
    - Else for every pledge with `status in (PledgeStatus.OPEN, PledgeStatus.CLAIMED)`: set `pledge.status = PledgeStatus.WITHDRAWN` — reuse the transition statement from `withdraw_pledge` (`groups/service.py:478-486`), NOT the guarded public fn (`_require_pledging_party` would reject the organizer). A small private helper `_withdraw_pledge_row(pledge)` is acceptable (spec Assumption 2).
    - At the withdraw point leave exactly: `# TODO: notify pledger that the organizer no longer needs this item`.
    - `ni.deleted_at = datetime.utcnow()`.
    - Single `await db.commit()`. Router returns 204.
  - [x] 2.6 `update_group(db, group_id, caller_party_id, name)`
    - `group = await get_group(db, group_id)` (404) → `await _require_active_organizer(db, group_id, caller_party_id)` (403) → `group.name = name` → commit / refresh / return.
  - [x] 2.7 Add matrix rows to `app/core/auth_deps.py` `_RAW_MATRIX` — ahead of blanket rows (first-match-wins)
    - `(_methods("PATCH"), r"^/api/terms/[^/]+$", ("EDIT", "mcp:edit"))`
    - `(_methods("PATCH", "DELETE"), r"^/api/needed-items/[^/]+$", ("EDIT", "mcp:edit"))`
    - `(_methods("PATCH"), r"^/api/groups/[^/]+$", ("EDIT", "mcp:edit"))` — MUST be positioned after the `/api/groups/mine` and `/api/groups/public/...` rows, before any blanket `^/api/groups` row.
    - Do NOT update the matrix test here — G3 owns it (auth_deps is serialized; G3 runs second).
  - [x] 2.8 Router: `PATCH /api/terms/{term_id}` in `app/groups/router.py`
    - `EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]`.
    - Resolve `profile = await get_profile_by_principal(db, principal)`, pass `profile.party_id`. Response `TermResponse`, 200. Never catch domain exceptions.
  - [x] 2.9 Router: `PATCH /api/needed-items/{needed_item_id}` → `NeededItemResponse`, 200.
  - [x] 2.10 Router: `DELETE /api/needed-items/{needed_item_id}` → 204 No Content (`status_code=204`, no body).
  - [x] 2.11 Router: `PATCH /api/groups/{group_id}` → `GroupResponse`, 200.
    - Register this route (and confirm 2.7 matrix row placement) AFTER `/api/groups/mine` and `/api/groups/public/...`, BEFORE `GET /api/groups/{group_id}`.
  - [x] 2.12 Wire router request bodies to the new schemas; confirm Pydantic/`ValueError` → HTTP 400 in this repo (not 422).
  - [x] 2.13 Confirm `datetime` import present in `groups/service.py` for `datetime.utcnow()`.
  - [x] 2.14 Add `test_getPublicCircle`-style regression check: existing `test_groups.py` term/needed-item read tests still green (quick scan, no full suite).
  - [x] 2.15 Self-review against `standards/backend/api.md` + `standards/backend/security.md` (matrix row first, coarse `require_any` on route, fine ownership in service, identity from `Principal` never body).
  - [x] 2.16 Ensure the 8 tests pass
    - Run only: `cd src/backend && uv run pytest tests/test_groups.py -q -k "patchTerm or patchNeededItem or deleteNeededItem or patchGroup or getNeededItemPledges"`.

**Acceptance Criteria:**
- `PATCH /api/terms/{id}`, `PATCH`+`DELETE /api/needed-items/{id}`, `PATCH /api/groups/{id}` exist, enforce matrix `EDIT` + service-layer active-organizer check, return status codes per spec §4.
- NeededItem DELETE: OPEN/CLAIMED pledges → WITHDRAWN in one tx; FULFILLED pledge → 409 with nothing changed; `# TODO: notify pledger` comment present at the withdraw point.
- `UpdateGroupRequest` rejects blank/whitespace name → 400.
- `groups` PATCH route + matrix row are after `/mine` and `/public`.
- The 8 tests pass; matrix-test update deferred to G3.

---

### Task Group 3: Backend Circulation Vertical — InventoryItem PATCH + DELETE

**Dependencies:** G1 (needs `InventoryItem.deleted_at` + read filters). Serialized after G2 on `app/core/auth_deps.py`. Owns the `auth_deps` matrix-test update.
**Files to Modify:**
- `src/backend/app/circulation/schemas.py` (`UpdateInventoryItemRequest`)
- `src/backend/app/circulation/service.py` (`update_item`, `soft_delete_item`)
- `src/backend/app/circulation/router.py` (`PATCH`+`DELETE /api/inventory-items/{id}`)
- `src/backend/app/core/auth_deps.py` (1 matrix row — inventory-items PATCH+DELETE) — SHARED with G2
- `src/backend/tests/test_circulation.py` (new)
- `src/backend/tests/<auth_deps matrix test file>` (extend — the 4 new rows from G2+G3)
**Estimated Steps:** 11

- [x] 3.0 Complete the circulation-context edit/delete surface
  - [x] 3.1 Write 6 focused tests in new `src/backend/tests/test_circulation.py`
    - `test_patchInventoryItem_owner_updatesCondition` — 200, in place.
    - `test_patchInventoryItem_ownerWithReservedBalance_stillUpdatesCondition` — 200 (PATCH unrestricted by balance).
    - `test_patchInventoryItem_nonOwner_returns403`
    - `test_deleteInventoryItem_availableItem_returns204AndExcludedFromList` — 204, absent from `list_items`, `get_item` → 404.
    - `test_deleteInventoryItem_nonAvailableBalance_returns409` — item unchanged.
    - `test_getInventoryItem_softDeleted_returns404`
    - Follow `standards/testing/backend-testing.md` — testcontainers PG18, `createAndSave*` helpers, `*Tests` conventions adapted to pytest, transaction-rollback isolation.
  - [x] 3.2 `UpdateInventoryItemRequest` in `app/circulation/schemas.py`: `condition: ItemCondition | None = None` only. Name/category live on `Product` — out of scope.
  - [x] 3.3 `update_item(db, item_id, principal, data)` in `app/circulation/service.py`
    - `acting_user_id = await get_user_id_by_principal(db, principal)` (raw `users.id`, NOT `party_id`).
    - `item = await get_item(db, item_id)` (404, incl. soft-deleted via G1) → `inv = await get_inventory(db, item.inventory_id)` → `if inv.owner_user_id != acting_user_id: raise AccessDeniedException(...)` (403).
    - `if data.condition is not None: item.condition = data.condition` → commit / refresh / return. Allowed regardless of balance status.
  - [x] 3.4 `soft_delete_item(db, item_id, principal)`
    - Same ownership gate as 3.3.
    - `balance = await get_item_balance(db, item_id)` → `if balance.status != BalanceStatus.AVAILABLE: raise BusinessConflictException("Nie można usunąć — rzecz jest zarezerwowana lub wypożyczona")` → 409.
    - Else `item.deleted_at = datetime.utcnow()` → `await db.commit()` → 204. Leave the 1:1 `InventoryBalance` row as-is.
    - Guard pattern precedent: `create_reservation` status guard (`circulation/service.py:261-265`).
  - [x] 3.5 Add matrix row to `app/core/auth_deps.py` `_RAW_MATRIX` ahead of blanket rows:
    - `(_methods("PATCH", "DELETE"), r"^/api/inventory-items/[^/]+$", ("EDIT", "mcp:edit"))`
  - [x] 3.6 Router: `PATCH /api/inventory-items/{item_id}` in `app/circulation/router.py`
    - `Depends(require_any("EDIT", "mcp:edit"))`; pass `Principal` to the service (circulation resolves `users.id` internally). Response `InventoryItemResponse`, 200. Cf. `confirm_reservation` router pattern (~156-162).
  - [x] 3.7 Router: `DELETE /api/inventory-items/{item_id}` → 204 No Content.
  - [x] 3.8 Confirm `datetime` import in `circulation/service.py`.
  - [x] 3.9 Update the `auth_deps` matrix test (extend) for ALL FOUR new rows added across G2+G3:
    - `PATCH ^/api/terms/[^/]+$` → `("EDIT","mcp:edit")`
    - `PATCH`+`DELETE ^/api/needed-items/[^/]+$` → `("EDIT","mcp:edit")`
    - `PATCH ^/api/groups/[^/]+$` → `("EDIT","mcp:edit")` (assert it resolves correctly and `/api/groups/mine`, `/api/groups/public/...` still resolve to their own rows — no regression)
    - `PATCH`+`DELETE ^/api/inventory-items/[^/]+$` → `("EDIT","mcp:edit")`
  - [x] 3.10 Self-review against `standards/backend/security.md` (identity split: circulation = raw `users.id` via `get_user_id_by_principal`, never cross with `party_id`) + `standards/global/minimal-implementation.md`.
  - [x] 3.11 Ensure the 6 tests + matrix test pass
    - Run only: `cd src/backend && uv run pytest tests/test_circulation.py <auth_deps matrix test path> -q`.

**Acceptance Criteria:**
- `PATCH`+`DELETE /api/inventory-items/{id}` exist; matrix `EDIT` + owner (`inventory.owner_user_id == acting user`) check; status codes per spec §4.
- PATCH `condition` works even with RESERVED/LENT balance; DELETE blocked (409) when balance ≠ AVAILABLE.
- `auth_deps` matrix test enumerates all 4 new rows and passes; no existing entry regresses.
- The 6 circulation tests pass.

---

### Task Group 4: Frontend — API Wrappers + Term Inline Edit + Circle Rename

**Dependencies:** G2 (backend Term + Group PATCH endpoints)
**Files to Modify:**
- `src/frontend/src/api/terms.ts` (`UpdateTermRequest` type, `updateTerm`)
- `src/frontend/src/api/groups.ts` (`updateCircle`)
- `src/frontend/src/api/neededItems.ts` OR `src/frontend/src/api/terms.ts` (`updateNeededItem`, `deleteNeededItem` — implementer's call per module granularity; used in G5, scaffolded here)
- `src/frontend/src/api/inventories.ts` (`updateInventoryItem`, `deleteInventoryItem` — scaffolded here, used in G5)
- `src/frontend/src/pages/panel/PanelPage.tsx` (term per-field inline editors; circle rename; remove L60-66 comment)
- `src/frontend/src/test/PanelPage.test.tsx` (extend)
**Estimated Steps:** 10

- [x] 4.0 Complete the api layer + term/circle inline editors
  - [x] 4.1 Write 5 focused tests in `src/frontend/src/test/PanelPage.test.tsx` (mirror the "Mój dom — inline family rename" block ~L909-954; `vi.mock` factory per api module, `vi.resetAllMocks()` in `beforeEach`, `renderWithProviders`)
    - `describe("PanelPage — term inline edit")`:
      - `calls updateTerm with only the changed occurs_on field and updates the tile after silent load`
      - `shows an inline error and keeps the original value when the save is rejected`
      - `early-returns without calling updateTerm when the value is unchanged`
    - `describe("PanelPage — circle rename")`:
      - `renames the circle in place on success`
      - `shows an inline error on a rejected rename`
  - [x] 4.2 `api/terms.ts`: add `UpdateTermRequest` (`{ occurs_on?: string; description?: string }`) + `updateTerm(id, req)` → `api.patch(\`/terms/${id}\`, req)`. Thin wrapper, no `client.ts` change (`request()` already maps 204 → `undefined`).
  - [x] 4.3 `api/groups.ts`: add `updateCircle(id, { name })` → `api.patch(\`/groups/${id}\`, { name })`.
  - [x] 4.4 Scaffold needed-item + inventory api wrappers (bodies used by G5):
    - `updateNeededItem(id, req)` + `deleteNeededItem(id)` → `api.patch`/`api.delete` on `/needed-items/{id}`.
    - `api/inventories.ts`: `updateInventoryItem(id, { condition })` + `deleteInventoryItem(id)` → `/inventory-items/{id}`.
  - [x] 4.5 Remove the `PanelPage.tsx` L60-66 comment block (`"Termin / rzecz … przycisk celowo pominięty"`).
  - [x] 4.6 Term per-field inline editors in `PanelPage.tsx` — follow family-rename template (`editing<Field>` / `<field>Draft` / `<field>Error` state trio, `PencilIcon` affordance, early-return on unchanged, `catch` → inline error, `await load({ silent: true })` after success).
    - `occurs_on` (date input) and `description` (text input) editable INDEPENDENTLY — separate save each, each sends only its own field.
  - [x] 4.7 Render the pencil affordance wherever a term renders for the organizer: home "Najbliższe terminy", the "Terminy" view, and the "Spotkania" view. Public views (`PublicKragGrupyView`, `usePublicKragGrupy`) get NO new controls.
  - [x] 4.8 Circle rename inline editor — same family-rename pattern — next to the organizer's circle name in the circle / "Grupy" section (spec Assumption 10: if no such section, place next to wherever the organizer's circle name first appears).
  - [x] 4.9 Accessible labels on all new edit controls; inline inputs keyboard-operable (`standards/frontend/accessibility.md`). Reuse `Field`, `PencilIcon` (`standards/frontend/components.md`).
  - [x] 4.10 Ensure the 5 tests pass
    - Run only: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx`.

**Acceptance Criteria:**
- Editing a term's date calls `updateTerm` with only `{ occurs_on }`, updates the tile in place after `load({ silent: true })`; a rejected save shows an inline error and leaves the original value.
- `occurs_on` and `description` are independently editable with separate saves.
- Renaming the circle updates in place; error path shows inline error.
- The L60-66 comment block is gone.
- No new controls in public krąg views.
- The 5 tests pass.

---

### Task Group 5: Frontend — NeededItem Sub-CRUD + InventoryItem Edit/Delete UI

**Dependencies:** G2 (NeededItem PATCH+DELETE), G3 (InventoryItem PATCH+DELETE), G4 (api wrappers + PanelPage editor scaffolding)
**Files to Modify:**
- `src/frontend/src/pages/panel/PanelPage.tsx` (needed-item add/edit/delete inline; inventory item condition edit + delete)
- `src/frontend/src/api/neededItems.ts` / `api/inventories.ts` (finalize wrapper bodies if left as stubs in G4)
- `src/frontend/src/test/PanelPage.test.tsx` (extend)
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx` (verify only — no change expected)
**Estimated Steps:** 11

- [x] 5.0 Complete needed-item and inventory-item inline CRUD
  - [x] 5.1 Write 6 focused tests in `src/frontend/src/test/PanelPage.test.tsx`
    - `describe("PanelPage — needed item sub-CRUD")`:
      - `adds a needed item inline via the add row`
      - `edits a needed item's category and description inline`
      - `optimistically removes a needed item row and shows the "Usunięto" toast`
      - `restores the row in place and shows an error toast when delete returns 409`
    - `describe("PanelPage — inventory item edit/delete")`:
      - `edits an item's condition inline in "Moje rzeczy"`
      - `optimistically deletes an item and restores it on a 409`
  - [x] 5.2 NeededItem inline add row within a term's needed-items list (organizer surface) — reuse the existing add-needed-item form / `Field` export.
  - [x] 5.3 `PencilIcon` per needed-item row → inline edit: `category` select + `description` input → `updateNeededItem` → `await load({ silent: true })` on success, inline error on failure.
  - [x] 5.4 `TrashIcon` per needed-item row → optimistic removal from the `TermWithNeeded` list held in `PanelPage` state + toast `"Usunięto"`. NO `ConfirmDialog`, NO undo button.
  - [x] 5.5 On `deleteNeededItem` error (409 for FULFILLED-pledge item, or any failure) → re-insert the row at its original index + inline/toast error message.
  - [x] 5.6 InventoryItem `condition` inline editor per item in the "Moje rzeczy" view → `updateInventoryItem`.
  - [x] 5.7 `TrashIcon` per inventory item → optimistic removal + toast; on 409 (reserved/lent) or any error → restore row at original index + message. NO `ConfirmDialog`.
  - [x] 5.8 Finalize `updateNeededItem` / `deleteNeededItem` / `updateInventoryItem` / `deleteInventoryItem` wrapper bodies if stubbed in G4.
  - [x] 5.9 Accessible labels + keyboard operability on all new row controls; reuse `TrashIcon`, `Field`, item-condition field from `ItemQuickAddForm.tsx` / `utils/itemQuickAdd.ts`.
  - [x] 5.10 Verify `src/frontend/src/test/PublicKragGrupyPage.test.tsx` still asserts NO edit/delete controls on the public view — run it, expect green with no change.
  - [x] 5.11 Ensure the 6 tests pass
    - Run only: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx`.

**Acceptance Criteria:**
- Adding / editing / deleting a needed item works inline; delete removes the row immediately and a 409 restores it at its original index with an error toast.
- Editing an item's condition and deleting an item work inline in "Moje rzeczy"; a 409 restores the row.
- No `ConfirmDialog` anywhere; no restore/undo control.
- `PublicKragGrupyPage.test.tsx` stays green unchanged.
- The 6 tests pass.

---

### Task Group 6: Test Review & Gap Analysis

**Dependencies:** G1, G2, G3, G4, G5
**Files to Modify:**
- `src/backend/tests/test_groups.py`, `src/backend/tests/test_circulation.py`, `src/backend/tests/test_public_term.py` (append gap-fill tests only)
- `src/frontend/src/test/PanelPage.test.tsx` (append gap-fill tests only)
**Estimated Steps:** 6

- [x] 6.0 Review and fill critical gaps for THIS feature only
  - [x] 6.1 Review the ~28 tests from G1-G5 for coverage of spec §14 success criteria.
  - [x] 6.2 Analyze gaps against spec §4 contract + §5 data lifecycle. Likely candidates (add only if genuinely missing):
    - `test_patchTerm_emptyBody_returns200Noop`
    - `test_deleteNeededItem_secondDelete_returns404` (idempotency)
    - `test_deleteNeededItem_nonOrganizer_returns403` / `test_deleteNeededItem_unknownId_returns404` (if not folded into 2.1)
    - `test_getPublicCircle_softDeletedNeededItem_notReturned` already in G1 — verify.
    - backend: soft-deleted item cannot be newly reserved (`create_reservation` → 404) — one downstream-path test.
    - `test_my_attendances.py` — confirm existing assertions still hold (terms have no `deleted_at`); no new test unless a regression appears.
  - [x] 6.3 Write up to 10 additional strategic tests total (backend + frontend combined). Do not exceed 10.
  - [x] 6.4 Run feature-affected backend tests: `cd src/backend && uv run pytest tests/test_groups.py tests/test_circulation.py tests/test_public_term.py tests/test_my_attendances.py <auth_deps matrix test path> -q`.
  - [x] 6.5 Run feature-affected frontend tests: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx`.
  - [x] 6.6 Confirm total feature tests land in the 28-38 range and all pass; record final count in the work-log.

**Acceptance Criteria:**
- All feature tests pass (~28-38 total across backend + frontend).
- No more than 10 additional tests added in this group.
- No regression in `test_groups.py`, `test_public_term.py`, `test_my_attendances.py`, `PanelPage.test.tsx`, `PublicKragGrupyPage.test.tsx`, or the `auth_deps` matrix test.

---

## Resolved Spec Open Items

| Spec item | Resolution baked into this plan |
|---|---|
| Gap-analysis decision 1 (matrix rows) | Option B — combined `_methods("PATCH"[,"DELETE"])` rows per entity path (2.7, 3.5). |
| Gap-analysis decision 2 (term-edit shape) | Spec R7 overrides gap analysis: **per-field independent inline editors** (4.6), not a single edit-mode card. |
| Gap-analysis decision 3 (which term views) | Spec R7: pencil affordance in **all organizer term views** — home "Najbliższe terminy", "Terminy", "Spotkania" (4.7). Public stays read-only. |
| Gap-analysis decision 4 (confirm UX) | Spec R7 overrides: **optimistic delete + toast + restore-on-error, NO `ConfirmDialog`** (5.4, 5.5, 5.7). |
| Gap-analysis decision 5 (pledge reads vs soft-deleted parent) | Option A — `list_pledges` gets a `get_needed_item` guard (1.7); `get_pledge` untouched. |
| Gap-analysis decision 6 (`category` typing) | Constrained `NeededItemCategory | None`, partial-apply (2.2). |
| Gap-analysis decision 7 (partial index) | Skipped for 0017 (1.2). Add later only on a query-plan need. |
| Spec Assumption 2 (`withdraw_pledge` reuse) | Reuse the transition statement; a private `_withdraw_pledge_row(pledge)` helper is acceptable (2.5). |
| Spec Assumption 5 (`get_public_circle_view` own select?) | Confirm at 1.7; add explicit `.where(...)` if it has its own `select`. Record finding in work-log. |
| Spec Assumption 6 (needed-item description max_length) | Match `CreateNeededItemRequest` exactly (2.2). |
| Spec Assumption 10 (circle rename location) | Circle / "Grupy" section; fallback = wherever the organizer's circle name first appears (4.8). |
| auth_deps matrix TEST ownership | G3 (runs second on the serialized `auth_deps.py`), covers all 4 rows (3.9). |

---

## Standards Compliance

Follow standards from `.maister/docs/standards/` (via `.maister/docs/INDEX.md`):
- `global/minimal-implementation.md` — no soft-delete mixin, no `ConfirmDialog`, no notification stub beyond the `# TODO` comment, no restore endpoint, no partial index, no `Term.deleted_at`.
- `global/error-handling.md` / `global/validation.md` — typed exceptions (`AccessDeniedException`→403, `EntityNotFoundException`→404, `BusinessConflictException`→409), fail-fast server-side validation, Polish user-facing text on the 409s, 400 for validation failures.
- `global/commenting.md` — the single `# TODO: notify pledger…` marker is the only non-obvious comment; no change-log comments.
- `backend/api.md` — plural resource nouns, `PATCH`/`DELETE /api/<plural>/{id}`, fine-grained + `/mine` routes before `/{id}`.
- `backend/security.md` — matrix row added first (first-match-wins), coarse `Depends(require_any("EDIT","mcp:edit"))` on the route, fine-grained ownership in the service; identity from `Principal`, never the body; routers never catch domain exceptions. Identity split: `app.groups` = `party_id`, `app.circulation` = raw `users.id`.
- `backend/models.md` §169-170 — `deleted_at: Mapped[datetime | None]` per concrete model (not `BaseEntity`), explicit `.where(...is_(None))` at every query site; string-backed enums.
- `backend/migrations.md` — `revision --autogenerate` + hand-review, working `downgrade()`, one logical change, additive nullable column, sequential `NNNN_` name, no app import.
- `backend/queries.md` — parameterized via SQLAlchemy binding, select scoping, no N+1 (pledge cascade loads pledges in one query).
- `frontend/components.md` — reuse `Field`, `PencilIcon`, `TrashIcon`, `ItemQuickAddForm`; inline editors over modals; single-responsibility state trios.
- `frontend/accessibility.md` / `frontend/responsive.md` — accessible labels on edit/delete controls; keyboard-operable inline inputs.
- `testing/backend-testing.md` — 2-8 tests/feature, `action_condition_expectedResult` naming, integration-first with testcontainers PG18, transaction-rollback isolation, ownership/404/409/400 edge coverage. Run only new/affected tests.
- `testing/frontend-testing.md` — Vitest + jsdom, `@testing-library/react`, `vi.mock` factories, `describe` by feature, tests in `src/test/`.

### Standards evolution note
After implementation, consider `/maister:standards-update` to promote the soft-delete pattern ("`deleted_at` column, filter centrally in `list_*`, `get_*` raises 404 for soft-deleted rows, no restore") from the `models.md` §169-170 placeholder into an active standard.

## Notes

- Test-Driven per group: each group starts with 2-8 tests (G6 adds ≤10).
- Run Incrementally: only the group's own new/affected tests after each group — never the full suite until G6, and even then only feature-affected files.
- Mark Progress: check off steps as completed; the markdown checkboxes are the resume source of truth.
- Reuse First: `update_organization` / `rename_family` for PATCH shape; `withdraw_pledge` transition line for the cascade; `UpdateFamilyRequest._reject_blank_name` for blank rejection; family-rename editor for the frontend.
- No design-context / mockups: UI behavior is specified in spec §R7 + §9; no Visual References, no `visual-coverage.md`.
