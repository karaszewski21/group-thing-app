# Specification: Edit / soft-delete for Term, Group, NeededItem, InventoryItem

Date: 2026-09-09
Task: `2026-09-09-crud-terms-groups-items`
Characteristics: modifies_existing_code, involves_data_operations, ui_heavy. risk_level: low-medium. change_type: additive.

Authority order on any conflict: `analysis/requirements.md` > `analysis/clarifications.md` > `analysis/scope-clarifications.md` > this spec > `analysis/gap-analysis.md` > `analysis/codebase-analysis.md`. `codebase-analysis.md` predates the revised scope (it assumes `Term.deleted_at` + a term-delete endpoint); those parts are void — Term is PATCH-only with no `deleted_at`.

---

## 1. Overview

Term, Group (circle), NeededItem, and InventoryItem currently support create + read only; existing rows cannot be modified. This task adds the missing edit operations (PATCH on all four) and soft-delete (DELETE on NeededItem and InventoryItem only), closely templated on the just-shipped `rename_family` / `update_organization` PATCH precedents. Soft-delete is net-new to this codebase: it introduces a nullable `deleted_at` column on `needed_items` and `inventory_items` (migration 0017) plus explicit read-site filtering (SQLAlchemy has no global query filter). Two delete-time 409 guards protect referential/domain integrity. Frontend adds inline edit/delete affordances to `PanelPage.tsx` for organizers and item owners; public krąg pages stay read-only.

### Goal
Give organizers and item owners in-app edit and remove controls for their terms, circles, needed items, and inventory items, without exposing any mutation to public visitors and without disturbing fulfilled pledges or active reservations.

---

## 2. User Stories

- As an **organizer**, I want to fix a term's date or description inline from any of my panel term views, so that I don't have to delete and recreate a term to correct a typo.
- As an **organizer**, I want to add, edit, and remove the needed items on a term inline, so that the "what to bring" list stays accurate as plans change.
- As an **organizer**, when I remove a needed item that a parent already pledged for, I want the pledge quietly withdrawn (with a marker where a notification would later go), so that the parent is no longer on the hook — unless the item was already delivered, in which case I'm told I can't remove it.
- As an **organizer**, I want to rename my circle inline, so that the circle name can evolve.
- As an **item owner**, I want to change an item's condition or remove an item I no longer have, so that my "Moje rzeczy" list reflects reality — but I want to be blocked (with a message) if the item is currently reserved or lent.
- As a **public visitor**, I should never see an edit or delete control on a krąg page.

---

## 3. Requirements

### R1 — Term: `PATCH /api/terms/{term_id}` (edit only)

`UpdateTermRequest`: `occurs_on: date | None = None`, `description: str | None = Field(default=None, max_length=2000)`. Partial-apply (`if data.f is not None: term.f = data.f`).

Service `update_term(db, term_id, caller_party_id, data)`: `term = await get_term(db, term_id)` (404) → `await _require_active_organizer(db, term.circle_group_id, caller_party_id)` (403) → apply fields → `commit` / `refresh` → return `Term`. Router resolves `profile = await get_profile_by_principal(db, principal)` and passes `profile.party_id`. Response: existing `TermResponse`, 200.

**Out:** no DELETE endpoint, no `deleted_at` on `terms`, no term read-site filtering.

**Acceptance criteria**
- Active organizer PATCHes `occurs_on` only → 200, row updated in place, `description` unchanged, `updated_at` bumped by `version_id_generator`.
- Non-organizer (or ended leadership) → 403.
- Unknown `term_id` → 404.
- Malformed body (e.g. non-date `occurs_on`, `description` over 2000 chars) → 400.
- Empty body `{}` → 200, no-op.

### R2 — NeededItem: `PATCH` + soft-`DELETE /api/needed-items/{needed_item_id}`

New nullable column `needed_items.deleted_at` (migration 0017).

`UpdateNeededItemRequest`: `category: NeededItemCategory | None = None` (it is a `StrEnum` — constrained, not free text), `description: str | None = Field(default=None, max_length=<match CreateNeededItemRequest>)`. Partial-apply.

Ownership gate (PATCH and DELETE): `ni = await get_needed_item(db, needed_item_id)` (404, incl. soft-deleted — see R2 read filter) → `term = await get_term(db, ni.term_id)` → `await _require_active_organizer(db, term.circle_group_id, caller_party_id)` (403).

`update_needed_item`: gate → partial-apply → `commit` / `refresh` → return `NeededItem`, 200, `NeededItemResponse`.

`soft_delete_needed_item` (one transaction):
1. Load this needed item's pledges (`list_pledges` internal / direct `select(Pledge).where(Pledge.needed_item_id == ni.id)`).
2. If **any** pledge has `status == FULFILLED` (equivalently `resolved_reservation_id is not None`) → raise `BusinessConflictException` ("Nie można usunąć — rzecz została już dostarczona"), commit nothing. → 409.
3. Otherwise: for every pledge with `status in (OPEN, CLAIMED)`, set `pledge.status = PledgeStatus.WITHDRAWN` (reuse the **transition line** from `withdraw_pledge`, not the guarded public function — the organizer is not the pledging party, so `_require_pledging_party` must not run). Leave a `# TODO: notify pledger that the organizer no longer needs this item` comment at the withdraw point. No notification system is built (none exists in `src/backend/app`).
4. Set `ni.deleted_at = datetime.utcnow()`.
5. `commit`. Router returns `204 No Content`.

**Read-site filter** — a soft-deleted needed item must be invisible to every read:
- `list_needed_items` — add `.where(NeededItem.deleted_at.is_(None))` (central filter; covers `get_public_circle_view`'s needed-items branch and any explicit-term branch that calls it).
- `get_needed_item` — currently `db.get`; after load, if `needed_item.deleted_at is not None` raise `EntityNotFoundException("NeededItem", id)` → 404. This propagates automatically to `create_pledge`, `fulfill_pledge`, and router `GET /api/needed-items/{id}`.
- `list_pledges` — add a `await get_needed_item(db, needed_item_id)` guard at the top so `GET /api/needed-items/{id}/pledges` returns 404 once the parent is soft-deleted (consistency with `get_needed_item`). `get_pledge` and pledge-lifecycle reads are left untouched (WITHDRAWN pledges are terminal).
- `get_public_circle_view` needed-items branch — verify the filter reaches it (inherits if it goes through `list_needed_items`; add an explicit `.where(...)` if it has its own `select`).

**Acceptance criteria**
- Organizer PATCHes `category` → 200, in place; non-organizer → 403; unknown id → 404; bad body (invalid enum value, over-long description) → 400.
- Organizer DELETEs a needed item with no pledges → 204; it disappears from `list_needed_items` and the public circle view; `get_needed_item` → 404.
- DELETE with OPEN + CLAIMED pledges → 204; those pledges are now `WITHDRAWN`; `deleted_at` set.
- DELETE with any FULFILLED pledge → 409; needed item unchanged, no pledge touched.
- Non-organizer DELETE → 403; unknown id DELETE → 404.

### R3 — Group (circle): `PATCH /api/groups/{group_id}` (rename only)

`UpdateGroupRequest` (a.k.a. `UpdateCircleRequest`): **required** `name: str` with `min_length=1, max_length=255` + a blank-rejecting `field_validator` mirroring `UpdateFamilyRequest._reject_blank_name` (Group has only `name` + `party_id`, so rename is the sole operation — required field, not partial-apply).

Service `update_group(db, group_id, caller_party_id, name)`: `group = await get_group(db, group_id)` (404) → `await _require_active_organizer(db, group_id, caller_party_id)` (403) → `group.name = name` → `commit` / `refresh`. Response: `GroupResponse`, 200.

**Route registration:** the `PATCH /api/groups/{group_id}` route (and its matrix row) must be declared **after** `/api/groups/mine` and `/api/groups/public/...`, **before** the `GET /{group_id}` route, so path resolution and first-match matrix eval stay correct.

**Out:** no DELETE (circle removal is already modelled as `end_leadership`), no `deleted_at` on `groups`.

**Acceptance criteria**
- Active organizer PATCHes `name` → 200, in place.
- Non-organizer → 403; unknown id → 404; blank / whitespace-only `name` → 400.

### R4 — InventoryItem ("rzecz"): `PATCH` + soft-`DELETE /api/inventory-items/{item_id}`

New nullable column `inventory_items.deleted_at` (migration 0017).

`UpdateInventoryItemRequest`: `condition: ItemCondition | None = None` **only**. Name/category live on `Product` and are not editable here.

Ownership gate (PATCH and DELETE) — circulation uses raw `users.id`, **not** `party_id`:
`acting_user_id = await get_user_id_by_principal(db, principal)` → `item = await get_item(db, item_id)` (404, incl. soft-deleted) → `inv = await get_inventory(db, item.inventory_id)` → `if inv.owner_user_id != acting_user_id: raise AccessDeniedException` (403).

`update_item`: gate → `if data.condition is not None: item.condition = data.condition` → `commit` / `refresh` → 200, `InventoryItemResponse`. **PATCH is allowed regardless of balance status.**

`soft_delete_item`: gate → `balance = await get_item_balance(db, item_id)` → `if balance.status != BalanceStatus.AVAILABLE: raise BusinessConflictException` ("Nie można usunąć — rzecz jest zarezerwowana lub wypożyczona") → 409. Otherwise `item.deleted_at = datetime.utcnow()` → `commit` → 204. The 1:1 `InventoryBalance` row is left as-is (harmless once the item is filtered from reads).

**Read-site filter:**
- `list_items` — add `.where(InventoryItem.deleted_at.is_(None))`.
- `get_item` — after load, if `item.deleted_at is not None` raise `EntityNotFoundException("InventoryItem", id)` → 404. Reservation-lifecycle callers (`create_reservation`, `create_swap`, confirm/cancel/fulfill, `_current_holder_user_id`, cross-BC `fulfill_pledge`) inherit the 404 — a soft-deleted item cannot be newly reserved or swapped, which is the desired behaviour.

**Acceptance criteria**
- Owner PATCHes `condition` → 200, in place, even when balance is RESERVED/LENT.
- Non-owner PATCH/DELETE → 403; unknown id → 404.
- Owner DELETEs an AVAILABLE item → 204; excluded from `list_items`; `get_item` → 404.
- Owner DELETEs a RESERVED or LENT item → 409; item unchanged.

### R5 — Migration 0017

- File `src/backend/alembic/versions/0017_needed_item_inventory_item_soft_delete.py`. `revision = "0017"`, `down_revision = "0016"` (current head).
- `upgrade()`: `op.add_column("needed_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))` and the same for `inventory_items`.
- `downgrade()`: `op.drop_column` both.
- Additive nullable, one logical change, reversible. **No** partial index (lists are small and scoped; add later only if a query plan shows a need). No new sequence. No app-code import.
- Models: `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)` on `NeededItem` (`groups/models.py`) and `InventoryItem` (`circulation/models.py`). **Not** on `BaseEntity`. `BaseEntity.updated_at` (the `version_id_col`) auto-bumps on the soft-delete UPDATE.

**Acceptance criteria**: `alembic upgrade head` then `alembic downgrade -1` round-trips cleanly against the test container.

### R6 — AUTHORIZATION_MATRIX rows

In `app/core/auth_deps.py` `_RAW_MATRIX`, add combined `_methods(...)` rows **ahead of the blanket rows** (first-match-wins). Same `("EDIT", "mcp:edit")` tuple used by the existing `families` / `organizations` PATCH idiom:

- `(_methods("PATCH"), r"^/api/terms/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH", "DELETE"), r"^/api/needed-items/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH"), r"^/api/groups/[^/]+$", ("EDIT", "mcp:edit"))` — positioned after the `/api/groups/mine` and `/api/groups/public/...` rows
- `(_methods("PATCH", "DELETE"), r"^/api/inventory-items/[^/]+$", ("EDIT", "mcp:edit"))`

Update the `auth_deps` matrix test to expect the four new rows (route → method → resolved permission).

**Acceptance criteria**: the matrix test enumerates the new (method, path, permission) entries and passes; no existing entry regresses.

### R7 — Frontend (`PanelPage.tsx` + api modules)

**API functions** (thin wrappers over the existing `api.patch` / `api.delete` in `client.ts` — no client change; `request()` already maps 204 → `undefined`):
- `api/terms.ts`: `UpdateTermRequest` type + `updateTerm(id, req)` → `api.patch("/terms/{id}")`.
- `api/groups.ts`: `updateCircle(id, { name })` → `api.patch("/groups/{id}")`.
- needed-items: `updateNeededItem(id, req)` + `deleteNeededItem(id)` (extend `terms.ts` or a new `api/neededItems.ts` — implementer's call, follow existing module granularity).
- `api/inventories.ts`: `updateInventoryItem(id, { condition })` + `deleteInventoryItem(id)`.

**Term edit — per-field inline editors.** Follow the family-rename template: `editing<Field>` / `<field>Draft` / `<field>Error` state trio, `PencilIcon` affordance, `await load({ silent: true })` after a successful save, catch → inline error, early-return on unchanged. `occurs_on` (date input) and `description` (text input) are editable **independently** (separate save each). The pencil affordance appears **wherever a term renders for the organizer**: home "Najbliższe terminy", the "Terminy" view, and the "Spotkania" view. Public krąg views (`PublicKragGrupyView`, `usePublicKragGrupy`) stay read-only — no new controls.

**NeededItem sub-CRUD** — inline within a term's needed-items list in the organizer surface:
- An inline **add row** (reuse the existing add-needed-item form / `Field` export).
- A `PencilIcon` per row → inline edit (`category` select + `description` input).
- A `TrashIcon` per row → **optimistic removal** from the list + toast `"Usunięto"`. On server error (409 for a FULFILLED-pledge item, or any failure) → **restore the row in place** and show an inline / toast error. No `ConfirmDialog`. No undo button.

**InventoryItem edit/delete** — in the "Moje rzeczy" view:
- `condition` inline editor per item.
- `TrashIcon` per item → optimistic removal + toast. On 409 (reserved/lent) or any error → restore row + message. No `ConfirmDialog`.

**Circle rename** — inline editor on the organizer's circle name (same family-rename pattern), in the circle / "Grupy" section of the organizer view.

**Cleanup:** remove the `PanelPage.tsx` L60-66 `"Termin / rzecz … przycisk celowo pominięty"` comment block.

**Out:** no restore/undo control anywhere; no restore endpoint; no `ConfirmDialog`; no changes to public krąg views beyond what the filtered API already delivers.

**Acceptance criteria**
- Editing a term's date calls `updateTerm` with only `{ occurs_on }`, updates the tile in place after `load({ silent: true })`; a rejected save shows an inline error and leaves the original value.
- Adding / editing / deleting a needed item works inline; delete removes the row immediately and a 409 restores it with an error toast.
- Editing an item's condition and deleting an item work inline in "Moje rzeczy"; a 409 restores the row.
- Renaming the circle updates in place.
- Public krąg page renders no edit/delete controls (existing test still green).

---

## 4. API Contract

Base path `/api`. All six endpoints require the `EDIT` / `mcp:edit` permission (matrix) plus a service-layer ownership check. All are **idempotent** in effect (repeating a PATCH with the same body is a no-op; a second DELETE on a soft-deleted row → 404). Error envelope is the global flat `{status, error, message}` (`app/main.py` handlers); routers never catch.

| # | Method | Path | Auth (matrix + service) | Request body | Success | Error statuses |
|---|--------|------|-------------------------|--------------|---------|----------------|
| 1 | PATCH | `/api/terms/{term_id}` | EDIT + active organizer of `term.circle_group_id` | `UpdateTermRequest` `{ occurs_on?: date, description?: string(≤2000) }` | 200 `TermResponse` | 400 bad body · 403 not organizer · 404 unknown term |
| 2 | PATCH | `/api/needed-items/{needed_item_id}` | EDIT + active organizer of the parent term's circle | `UpdateNeededItemRequest` `{ category?: NeededItemCategory, description?: string }` | 200 `NeededItemResponse` | 400 · 403 · 404 (unknown or soft-deleted) |
| 3 | DELETE | `/api/needed-items/{needed_item_id}` | EDIT + active organizer of the parent term's circle | — | 204 No Content | 403 · 404 (unknown or soft-deleted) · 409 a FULFILLED pledge exists |
| 4 | PATCH | `/api/groups/{group_id}` | EDIT + active organizer of the group | `UpdateGroupRequest` `{ name: string(1..255, non-blank) }` | 200 `GroupResponse` | 400 blank/missing/over-long name · 403 · 404 |
| 5 | PATCH | `/api/inventory-items/{item_id}` | EDIT + `inventory.owner_user_id == acting user` | `UpdateInventoryItemRequest` `{ condition?: ItemCondition }` | 200 `InventoryItemResponse` | 400 invalid enum · 403 not owner · 404 (unknown or soft-deleted) |
| 6 | DELETE | `/api/inventory-items/{item_id}` | EDIT + `inventory.owner_user_id == acting user` | — | 204 No Content | 403 · 404 (unknown or soft-deleted) · 409 balance ≠ AVAILABLE |

Notes:
- Validation failures (Pydantic and validator `ValueError`) map to **HTTP 400** in this repo, not 422.
- Endpoint 3 side effects: OPEN/CLAIMED pledges on the item → `WITHDRAWN` in the same transaction.
- `GET /api/needed-items/{id}` and `GET /api/needed-items/{id}/pledges` return **404** once the item is soft-deleted (via `get_needed_item` / the new `list_pledges` guard). `GET /api/inventory-items/{id}` and `/balance` return **404** once the item is soft-deleted.

---

## 5. Data Lifecycle

### Soft-delete
- `deleted_at: TIMESTAMP NULL` on `needed_items` and `inventory_items` only. `NULL` = live, non-`NULL` = deleted (value = `datetime.utcnow()` at delete time; audit trail, never cleared).
- **No global filter** — SQLAlchemy has no `@Where` equivalent (`models.md` §169-170). Filter centrally in `list_*`; raise 404 in `get_*`. See the read-site checklist (§7).
- One-way from the UI: no restore endpoint, no undo. `deleted_at` remains for a future admin tool.
- `updated_at` (version_id_col) auto-bumps on the soft-delete UPDATE — no manual touch.

### NeededItem delete → pledge cascade (Phase 1 Q3 Option A)
| Pledge state on the item | Effect of DELETE |
|---|---|
| Any pledge `FULFILLED` (`resolved_reservation_id` set) | **Block** — 409, nothing changes. The resolved circulation `Reservation` / `InventoryItem` must never be disturbed. |
| Pledges `OPEN` / `CLAIMED` | Transition each to `WITHDRAWN` (terminal) in the same tx, then set `deleted_at`. `# TODO: notify pledger` marker left at the withdraw point. |
| Pledges already `WITHDRAWN` / terminal | Left as-is. |

### InventoryItem delete → balance guard
| `InventoryBalance.status` | Effect of DELETE |
|---|---|
| `AVAILABLE` | Set `deleted_at`, 204. The 1:1 balance row is left in place (harmless once filtered). |
| `RESERVED` / `LENT` / other non-AVAILABLE | **Block** — 409. |
PATCH of `condition` is unrestricted by balance status.

### Not touched
`terms` and `groups` get no `deleted_at`. RSVP / `TermAttendance` lifecycle unchanged. `Product` unchanged (item name/category not editable here).

---

## 6. Migration Spec

See R5. Single Alembic revision `0017`, `down_revision "0016"`, two `add_column` in `upgrade()`, two `drop_column` in `downgrade()`, `sa.TIMESTAMP()` to match existing migration style, no index, no sequence, no app import. Covered by the conftest `alembic upgrade head` at test-session start; add an explicit downgrade round-trip check if the test harness supports it.

---

## 7. Read-Site Filter Checklist

Each site below must exclude soft-deleted rows. Prefer the central `list_*` / `get_*` edit so downstream callers inherit it.

**needed_items**
- [ ] `groups/service.py::list_needed_items` — `.where(NeededItem.deleted_at.is_(None))`
- [ ] `groups/service.py::get_needed_item` — raise 404 when `deleted_at is not None` (covers `create_pledge`, `fulfill_pledge`, router `GET /api/needed-items/{id}`)
- [ ] `groups/service.py::list_pledges` — add a `get_needed_item` guard at the top (→ 404 when parent soft-deleted)
- [ ] `groups/service.py::get_public_circle_view` needed-items branch — confirm it routes through `list_needed_items`; add explicit `.where(...)` if it has its own `select`

**inventory_items**
- [ ] `circulation/service.py::list_items` — `.where(InventoryItem.deleted_at.is_(None))`
- [ ] `circulation/service.py::get_item` — raise 404 when `deleted_at is not None` (covers `create_reservation`, `create_swap`, confirm/cancel/fulfill, `_current_holder_user_id`, cross-BC `fulfill_pledge`)

**Not required:** any `terms` or `groups` read (no `deleted_at`); `get_pledge` and pledge-lifecycle reads (WITHDRAWN is terminal).

---

## 8. Reusable Components

### Existing code to leverage (no new abstraction needed)

| Need | Reuse | Location |
|---|---|---|
| Backend PATCH shape (get → ownership → partial-apply → commit/refresh) | `rename_family`, `update_organization` | `families/service.py:155-179`, `organizations/service.py:118-136` |
| Term / NeededItem / Group ownership gate | `_require_active_organizer(db, group_id, party_id)` | `groups/service.py:288-291` |
| Router principal → party_id | `get_profile_by_principal` | `users/service.py` |
| Pledge → WITHDRAWN transition (line, not the guarded fn) | `withdraw_pledge` body (`pledge.status = PledgeStatus.WITHDRAWN`) | `groups/service.py:478-486` |
| "not eligible → 409" guard pattern | `create_reservation` status guard | `circulation/service.py:261-265` |
| Circulation identity (raw users.id) + item/inventory/balance loaders | `get_user_id_by_principal`, `get_inventory`, `get_item`, `get_item_balance` | `circulation/service.py:66-75, 157-161, +get_inventory/get_item_balance` |
| Blank-name rejection on a required rename field | `UpdateFamilyRequest._reject_blank_name` | `families/schemas.py:43-49` |
| Error → HTTP status mapping | `AccessDeniedException`→403, `EntityNotFoundException`→404, `BusinessConflictException`→409, Pydantic/ValueError→400 | `core/errors.py`, `app/main.py` handlers |
| Combined-method matrix row idiom | `organizations` `_methods("POST","PATCH")` | `core/auth_deps.py` |
| `deleted_at` column + explicit `.where(...is_(None))` idiom | soft-delete pattern | `standards/backend/models.md:169-170` |
| Frontend inline editor (state trio + `load({silent:true})` + inline error) | family-rename: `renamingFamily` / `familyNameDraft` / `renameError` + `startRenameFamily` / `cancelRenameFamily` / `saveRenameFamily` | `PanelPage.tsx` (~L261-263, ~L615-650) |
| Icons / form primitives | `PencilIcon`, `TrashIcon`, `Field`, existing add-needed-item form | `PanelPage.tsx` |
| Item condition field | `ItemQuickAddForm.tsx` / `utils/itemQuickAdd.ts` | `components/shared/` |
| HTTP client | `api.patch`, `api.delete` (204 → `undefined`) | `api/client.ts` — no change |
| Backend PATCH test template (owner 200 / non-owner 403 / other-owner 403 / unknown 404 / blank 400) | `test_families.py`, `test_organizations.py` | `src/backend/tests/` |
| Frontend inline-edit test template | "Mój dom — inline family rename" block | `src/frontend/src/test/PanelPage.test.tsx:~909-954` |

### New components required (and why reuse is not possible)

| New | Why it can't reuse existing code |
|---|---|
| `UpdateTermRequest`, `UpdateNeededItemRequest`, `UpdateGroupRequest`/`UpdateCircleRequest`, `UpdateInventoryItemRequest` schemas | Field sets are entity-specific; each mirrors an existing `Update*Request` shape but no existing schema matches these fields. |
| `update_term`, `update_needed_item`, `soft_delete_needed_item`, `update_group`, `update_item`, `soft_delete_item` service fns | Per-entity ownership resolution + (for the two deletes) genuinely new domain logic — the pledge cascade / FULFILLED-pledge 409 and the balance-status 409. Copied structurally from `update_organization`; not literally reusable. |
| `deleted_at` columns on `NeededItem`, `InventoryItem` + migration 0017 | No `deleted_at` exists anywhere in the codebase today; first use of the pattern. |
| Read-site `.where(deleted_at.is_(None))` / 404 guards | Cross-cutting; must be added per read site (no global filter). |
| 4 `AUTHORIZATION_MATRIX` rows + matrix-test update | Additive security config; the routes do not exist yet. |
| Frontend API wrappers (`updateTerm`, `updateCircle`, `updateNeededItem`, `deleteNeededItem`, `updateInventoryItem`, `deleteInventoryItem`) | One-line wrappers per endpoint; follow the existing `api/*.ts` style. |
| `PanelPage.tsx` inline term field editors, needed-item sub-CRUD, item condition/delete, circle rename | New UI surface; structurally copies the family-rename editor but each binds different state/fields and the needed-item list adds optimistic add/edit/remove. |
| `src/backend/tests/test_circulation.py` | No circulation test file exists yet. |

No over-engineering: no new base classes, no generic "soft-delete mixin" (per `minimal-implementation.md` and the `models.md` guidance to add the column per concrete model), no `ConfirmDialog`, no notification infrastructure, no restore endpoint, no partial index, no term `deleted_at`.

---

## 9. Technical Approach

- **Order of work per entity**: matrix row first (first-match-wins), then route with `EditPrincipal = Annotated[Principal, Depends(require_any("EDIT","mcp:edit"))]`, then service fn with the ownership gate, then read-site filters, then tests.
- **Identity split**: `app.groups` works in `party_id` (via `get_profile_by_principal`); `app.circulation` works in raw `users.id` (via `get_user_id_by_principal`). Do not cross them.
- **Commit boundary**: service does `await db.commit(); await db.refresh(row); return row`. `soft_delete_needed_item` does the pledge writes + `deleted_at` in one `commit`.
- **`get_*` 404-on-soft-deleted**: `get_needed_item` and `get_item` currently use `db.get`; keep that, then check `deleted_at` and raise `EntityNotFoundException`. This is the single lever that makes every downstream lifecycle caller behave correctly.
- **Frontend data flow**: inline editor → `api/*` wrapper → PATCH/DELETE → on success `await load({ silent: true })` (term/group/needed-item edit) or optimistic list splice + toast (needed-item/item delete); on error restore + inline/toast message.
- **Public read path**: `get_public_circle_view` and `usePublicKragGrupy` inherit the needed-item filter through `list_needed_items`; verify no second `select` bypasses it. No public UI change.

---

## 10. Implementation Guidance

### Testing approach
2–8 focused tests per feature group. Test verification runs only the new/affected tests, not the whole suite. Backend naming `test_<camelCaseAction>_<condition>_<expectedResult>`, package-private, same package. Frontend: `describe` by feature, `vi.mock` factory per API module, `vi.resetAllMocks()` in `beforeEach`, `renderWithProviders`. Do not test framework-generated code, enum round-trips, or getters.

### Test plan

**`src/backend/tests/test_groups.py`** (extend)
- `test_patchTerm_activeOrganizer_updatesInPlace` (200, only sent field changes)
- `test_patchTerm_nonOrganizer_returns403`
- `test_patchTerm_unknownId_returns404`
- `test_patchTerm_invalidBody_returns400`
- `test_patchNeededItem_activeOrganizer_updatesCategory` (200)
- `test_patchNeededItem_nonOrganizer_returns403`
- `test_deleteNeededItem_noPledges_returns204AndExcludedFromList`
- `test_deleteNeededItem_openAndClaimedPledges_transitionsToWithdrawn` (204)
- `test_deleteNeededItem_fulfilledPledgeExists_returns409` (item + pledge unchanged)
- `test_deleteNeededItem_nonOrganizer_returns403`
- `test_deleteNeededItem_unknownId_returns404`
- `test_getNeededItemPledges_parentSoftDeleted_returns404`
- `test_patchGroup_activeOrganizer_renamesInPlace` (200)
- `test_patchGroup_nonOrganizer_returns403`
- `test_patchGroup_blankName_returns400`
- `test_patchGroup_unknownId_returns404`

**`src/backend/tests/test_public_term.py`** (extend) + **`test_my_attendances.py`** (verify)
- `test_getPublicCircle_softDeletedNeededItem_notReturned`
- `test_getPublicCircle_termWithNeededItems_unaffectedAfterSiblingDelete`
- confirm existing `test_my_attendances` assertions still hold (terms have no `deleted_at`)

**`src/backend/tests/test_circulation.py`** (new)
- `test_patchInventoryItem_owner_updatesCondition` (200)
- `test_patchInventoryItem_ownerWithReservedBalance_stillUpdatesCondition` (200 — PATCH unrestricted)
- `test_patchInventoryItem_nonOwner_returns403`
- `test_patchInventoryItem_unknownId_returns404`
- `test_deleteInventoryItem_availableItem_returns204AndExcludedFromList`
- `test_deleteInventoryItem_nonAvailableBalance_returns409`
- `test_deleteInventoryItem_nonOwner_returns403`
- `test_getInventoryItem_softDeleted_returns404`

**`auth_deps` matrix test** (extend)
- assert the four new (methods, path pattern, `("EDIT","mcp:edit")`) rows resolve; no regression on existing rows.

**`src/frontend/src/test/PanelPage.test.tsx`** (extend, mirroring the family-rename block)
- term inline edit: `updateTerm` called with the single changed field, tile updates after `load`, error path shows inline error + keeps original
- needed-item add / edit / delete: optimistic remove, restore + error toast on 409
- inventory item: condition edit, delete optimistic + restore on 409
- circle rename: in-place update, error path

**`src/frontend/src/test/PublicKragGrupyPage.test.tsx`** (verify)
- still asserts no edit/delete controls render on the public view

### Standards compliance
- `backend/api.md` — plural resource nouns, `PATCH`/`DELETE /api/<plural>/{id}`, limited nesting, fine-grained + `/mine` routes before `/{id}`.
- `backend/security.md` — matrix row added first (first-match-wins), coarse `Depends(require_any("EDIT","mcp:edit"))` on the route, fine-grained ownership in the service raising `AccessDeniedException`; routers resolve identity from `Principal`, never the body, and never catch domain exceptions.
- `backend/models.md` §169-170 — `deleted_at: Mapped[datetime | None]` per concrete model (not `BaseEntity`), explicit `.where(...is_(None))` at every query site; string-backed enums for `category` / `condition`.
- `backend/migrations.md` — autogenerate + hand-review, working `downgrade()`, one logical change, additive nullable column, sequential `NNNN_` name, no app import.
- `backend/queries.md` — parameterized via SQLAlchemy binding, select scoping, no N+1 (the pledge cascade loads the item's pledges in one query).
- `global/error-handling.md` / `global/validation.md` — typed exceptions, fail-fast server-side validation, specific messages (Polish user-facing text on the 409s), 400 for validation.
- `global/minimal-implementation.md` — no soft-delete mixin, no `ConfirmDialog`, no notification stub beyond the `# TODO` comment, no restore endpoint, no partial index, no term `deleted_at`.
- `global/commenting.md` — the single `# TODO: notify pledger…` comment is the only non-obvious marker; no change-log comments.
- `frontend/components.md` — reuse `Field`, `PencilIcon`, `TrashIcon`, `ItemQuickAddForm`; inline editors over modals; single-responsibility state trios.
- `frontend/accessibility.md` / `frontend/responsive.md` — edit/delete controls get accessible labels; inline inputs keyboard-operable.
- `testing/backend-testing.md` — 2-8 tests/feature, `action_condition_expectedResult` naming, integration-first, `@Transactional` rollback isolation, ownership/404/409/400 edge coverage.
- `testing/frontend-testing.md` — Vitest + jsdom, `@testing-library/react`, `vi.mock` factories, `describe` by feature, tests in `src/test/`.

### Standards evolution note
After implementation, consider `/maister:standards-update` to promote "soft-delete: `deleted_at` column, filter centrally in `list_*`, `get_*` raises 404 for soft-deleted rows, no restore" from the placeholder in `models.md` §169-170 into an active standard.

---

## 11. Assumptions

1. `UpdateGroupRequest` uses a **required** non-blank `name: str` (mirroring `UpdateFamilyRequest`) rather than partial-apply, since `name` is the only editable Group field.
2. The pledge cascade reuses only the **transition statement** from `withdraw_pledge`, not the public function (which enforces `_require_pledging_party` — wrong actor here). If the implementer prefers a small shared private helper `_withdraw_pledge_row(pledge)`, that is acceptable and arguably cleaner.
3. `FULFILLED` is detected via `Pledge.status == PledgeStatus.FULFILLED` (equivalently `resolved_reservation_id is not None`); both are treated as the same condition.
4. `get_needed_item` / `get_item` keep using `db.get(...)` then a `deleted_at` check (simplest); switching to a `select().where()` is an equivalent acceptable alternative.
5. `get_public_circle_view` reads needed items through `list_needed_items` (so it inherits the filter). The implementer must confirm this during Phase 7; if it has its own `select`, add the explicit `.where(...)`.
6. The needed-item description max length matches whatever `CreateNeededItemRequest` already enforces (keep them identical).
7. Frontend needed-item optimistic delete operates on the `TermWithNeeded` list already held in `PanelPage` state; a failed delete re-inserts the row at its original index.
8. `api.delete` returning `undefined` on 204 is sufficient — no response body is read for either DELETE.
9. No new permission scope is introduced; `EDIT` / `mcp:edit` already exist and are what `create_term` / `register_item` use.
10. Circle rename lives in the organizer's circle / "Grupy" section; if no such section renders a circle name today, the implementer adds the inline editor next to wherever the organizer's circle name first appears in `PanelPage`.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A read site is missed and leaks soft-deleted rows | Medium | Medium | Central filter in `list_*` / 404 in `get_*`; §7 checklist; explicit tests that a deleted row is absent from list + public view + `get_*` |
| `get_*` switching to 404-on-soft-deleted breaks a downstream lifecycle caller unexpectedly | Low | Medium | Intended behaviour (deleted item can't be pledged/reserved); one test per downstream path (`create_pledge`, `create_reservation`) |
| Pledge cascade accidentally touches a `FULFILLED` pledge / its reservation | Low | High | Guard checks FULFILLED **first** and aborts with 409 before any write; test asserts pledge + reservation unchanged on the 409 path |
| Matrix row placed after a blanket row → wrong permission / deny | Low | Medium | Rows added ahead of blanket rows; `groups` row explicitly after `/mine` + `/public`; matrix test covers all four |
| Optimistic frontend delete leaves the list inconsistent on error | Medium | Low | Restore-on-error with original index; explicit test for the 409 restore path |
| Migration 0017 not reversible | Low | Low | `downgrade()` drops both columns; conftest upgrade + explicit downgrade round-trip |
| `updated_at` version_id conflict during the multi-write soft-delete tx | Low | Low | Single `commit`; SQLAlchemy `version_id_generator` handles the bump; no concurrent-editor scenario in scope |

---

## 13. Scope

### In
PATCH for Term, Group, NeededItem, InventoryItem. Soft-DELETE for NeededItem and InventoryItem. Migration 0017 (`deleted_at` on `needed_items` + `inventory_items`). Read-site filtering for those two entities. NeededItem-delete pledge-withdraw cascade + FULFILLED-pledge 409. InventoryItem-delete balance 409. Four `AUTHORIZATION_MATRIX` rows + matrix-test update. All frontend inline edit/delete affordances in `PanelPage.tsx` + API wrapper functions. Affected backend test updates + new `test_circulation.py`. Frontend `PanelPage.test.tsx` updates. Removal of the `PanelPage.tsx` L60-66 comment.

### Out
Notifications / emails / events (no infrastructure exists — only a `# TODO` comment). Term delete. Group delete. Editing an item's name or category (those live on `Product`). Any restore / un-delete endpoint or undo UI. `deleted_at` on `terms` or `groups`. RSVP / `TermAttendance` lifecycle changes. `ConfirmDialog`. Partial indexes on `deleted_at`. Changes to public krąg read views beyond what the central read-filter already delivers. `get_pledge` / pledge-lifecycle read changes. Unifying the two circulation identity models.

---

## 14. Success Criteria

- All six endpoints exist, enforce the matrix `EDIT` permission plus a service-layer ownership check, and return the status codes in §4.
- A soft-deleted needed item / inventory item is absent from every list, public view, and `get_*` (→ 404), verified by tests.
- Deleting a needed item withdraws its OPEN/CLAIMED pledges and is blocked (409) when a FULFILLED pledge exists; deleting a non-AVAILABLE inventory item is blocked (409).
- Migration 0017 applies and reverses cleanly.
- Organizers can edit term date/description, needed-items, and circle name inline from the panel; item owners can edit condition and delete items in "Moje rzeczy"; deletes are optimistic with restore-on-error.
- Public krąg pages render no edit/delete controls and never surface soft-deleted rows.
- New/updated tests pass (2-8 per feature group); no regression in `test_groups.py`, `test_public_term.py`, `test_my_attendances.py`, `PanelPage.test.tsx`, `PublicKragGrupyPage.test.tsx`, or the `auth_deps` matrix test.
- All applicable standards in §10 are followed.

---

## 15. Self-Verification

| Check | Result |
|---|---|
| Requirements accuracy — R1-R7 and all Phase-1/Phase-2 decisions captured | pass — every clause of `requirements.md` R1-R7, the pledge-cascade Option A, the balance guard, the combined-matrix-row decision, per-field inline editors, all-organizer-views placement, optimistic-delete-no-ConfirmDialog, and no-restore are represented |
| Visual assets coverage | no_visuals — Phase 4 mockups skipped by user choice; UI is described in-prose in R7 + §9 |
| Spec quality — goal, stories, contract, criteria, test limits, gap-analysis consistency | pass — API contract table has all six endpoints with 400/403/404/409; test plan names concrete tests at 2-8 per group; read-site checklist matches gap analysis; `codebase-analysis.md`'s stale `Term.deleted_at` assumption explicitly overridden |
| Over-engineering check | pass — no soft-delete mixin (per-model column per `models.md`), no `ConfirmDialog`, no notification stub, no restore endpoint, no partial index, no term `deleted_at`, API wrappers are one-liners, service fns copy `update_organization` structurally; every new element justified in §8 |

Minor note carried forward (not blocking): Assumption 5 — whether `get_public_circle_view` has its own needed-item `select` must be confirmed at implementation time; the checklist covers both outcomes.
