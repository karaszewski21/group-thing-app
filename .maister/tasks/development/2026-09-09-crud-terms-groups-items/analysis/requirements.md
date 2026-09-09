# Requirements — Phase 5

Date: 2026-09-09
Task: CRUD (edit / soft-delete) for Term, Group (circle), NeededItem, InventoryItem

## Initial description
Currently only create + read exist for terms, circles, and inventory items ("rzeczy") — existing
records cannot be modified. Add the missing edit / delete operations, following the just-shipped
`rename_family` / `update_organization` PATCH precedents. Soft-delete only (`deleted_at`). Public
krąg pages must never expose edit/delete. Ownership checks in the service layer.

## Resolved scope (Phase 1 clarifications.md + Phase 2 scope-clarifications.md — both authoritative)

### R1 — Term: `PATCH /api/terms/{term_id}` (edit only, no delete)
- Body `UpdateTermRequest`: `occurs_on: date | None`, `description: str | None` — partial-apply
  (`if data.f is not None: term.f = data.f`).
- Auth: `EDIT` matrix row + service check `term = get_term(id)` (404) →
  `_require_active_organizer(db, term.circle_group_id, profile.party_id)` (403).
- Response: `TermResponse` (existing schema).
- NO delete endpoint, NO `deleted_at` on `terms`, NO term read-site filtering.

### R2 — NeededItem: `PATCH` + soft-`DELETE /api/needed-items/{needed_item_id}`
- New nullable column `needed_items.deleted_at: TIMESTAMP` (migration 0017).
- `UpdateNeededItemRequest`: `category: NeededItemCategory | None`, `description: str | None`,
  partial-apply. (`NeededItemCategory` is a `StrEnum`.)
- Auth (both PATCH and DELETE): `EDIT` matrix row + `ni = get_needed_item(id)` (404) →
  `term = get_term(ni.term_id)` → `_require_active_organizer(db, term.circle_group_id, profile.party_id)` (403).
- **DELETE semantics (soft + pledge cascade — Phase 1 Q3 Option A):**
  - If the needed item has any `Pledge` with `status == FULFILLED` (i.e. a `resolved_reservation_id`
    is set) → raise `BusinessConflictException` (409), do nothing.
  - Otherwise: in one transaction — set every `Pledge` on this needed item whose status is
    `OPEN` or `CLAIMED` to `WITHDRAWN` (reuse the `withdraw_pledge` transition logic), then set
    `needed_item.deleted_at = datetime.utcnow()`. Commit.
  - Leave a `# TODO: notify pledger that the organizer no longer needs this item` comment at the
    withdraw point. **No notification system is built** (none exists in `src/backend/app`).
  - Response: `204 No Content`.
- Read-site filter (`.where(NeededItem.deleted_at.is_(None))`): `list_needed_items`,
  `get_needed_item` (→ 404 when soft-deleted), `get_public_circle_view` needed-items branch,
  and a `get_needed_item` guard added to `list_pledges` (→ 404 when the parent is soft-deleted).
- `get_needed_item` also called by `create_pledge`, `fulfill_pledge`, router `GET /api/needed-items/{id}`
  — all inherit the 404 automatically.

### R3 — Group (circle): `PATCH /api/groups/{group_id}` (edit `name` only, no delete)
- Body `UpdateGroupRequest`: `name` — required `str` with `min_length=1, max_length=255` +
  blank-name rejection (mirror `UpdateFamilyRequest`), OR `name: str | None` partial-apply
  (spec-creator picks; Group has only `name`).
- Auth: `EDIT` matrix row (ahead of `/mine` and `/public` group rows in eval order) + service check
  `get_group(id)` (404) → `_require_active_organizer(db, group_id, profile.party_id)` (403).
- Response: `GroupResponse`.
- Route registered after `/api/groups/mine` and `/api/groups/public/...`, before `/{group_id}` GET.

### R4 — InventoryItem ("rzecz"): `PATCH` + soft-`DELETE /api/inventory-items/{item_id}`
- New nullable column `inventory_items.deleted_at: TIMESTAMP` (migration 0017).
- `UpdateInventoryItemRequest`: `condition: ItemCondition | None` ONLY. Name/category live on
  `Product` and are NOT editable here.
- Auth (both): `EDIT` matrix row + service check — circulation uses raw `users.id`:
  `acting_user_id = get_user_id_by_principal(db, principal)`; `item = get_item(id)` (404);
  `inv = get_inventory(item.inventory_id)`; `inv.owner_user_id != acting_user_id` →
  `AccessDeniedException` (403).
- **DELETE semantics:** if `get_item_balance(item_id).status != AVAILABLE`
  (RESERVED / LENT / ...) → `BusinessConflictException` (409). Otherwise set
  `item.deleted_at = datetime.utcnow()`, commit. Response `204`.
  (The 1:1 `InventoryBalance` row is left as-is — harmless once the item is filtered from reads.)
- PATCH is allowed regardless of balance status.
- Read-site filter (`.where(InventoryItem.deleted_at.is_(None))`): `list_items`, `get_item`
  (→ 404 when soft-deleted). The reservation-lifecycle `get_item` calls inherit the 404 — a
  soft-deleted item cannot be newly reserved/swapped, which is the desired behaviour.

### R5 — Migration 0017
- File `0017_needed_item_inventory_item_soft_delete.py`, `revision = "0017"`, `down_revision = "0016"`.
- `upgrade()`: `op.add_column("needed_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))`
  + same for `inventory_items`.
- `downgrade()`: drop both columns.
- Additive nullable, one logical change, reversible. NO partial index (add later if needed).
- Model: `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)` on
  `NeededItem` (`groups/models.py`) and `InventoryItem` (`circulation/models.py`). NOT on `BaseEntity`.
- `BaseEntity.updated_at` (the `version_id_col`) auto-bumps on the soft-delete UPDATE.

### R6 — AUTHORIZATION_MATRIX rows
Combined `_methods(...)` rows, ahead of the blanket rows (first-match-wins):
- `(_methods("PATCH"), r"^/api/terms/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH", "DELETE"), r"^/api/needed-items/[^/]+$", ("EDIT", "mcp:edit"))`
- `(_methods("PATCH"), r"^/api/groups/[^/]+$", ("EDIT", "mcp:edit"))`  (after `/mine`, `/public`)
- `(_methods("PATCH", "DELETE"), r"^/api/inventory-items/[^/]+$", ("EDIT", "mcp:edit"))`
- Update the `auth_deps` matrix test to expect the new rows.

### R7 — Frontend (PanelPage, organizer + item-owner surfaces)
- API: `api/terms.ts` `updateTerm(id, UpdateTermRequest)`; `api/groups.ts` `updateCircle(id, {name})`;
  new `api/neededItems.ts` (or extend `terms.ts`) `updateNeededItem(id, req)` + `deleteNeededItem(id)`;
  `api/inventories.ts` `updateInventoryItem(id, {condition})` + `deleteInventoryItem(id)`.
  `api.patch` / `api.delete` already exist in `client.ts` — no client change.
- **Term edit** — per-field inline editors (family-rename template: `editingTermField` /
  `termFieldDraft` / `termFieldError` state, `PencilIcon`, `load({ silent: true })` after save).
  `occurs_on` (date input) and `description` (text input) editable independently. Affordance shows
  **wherever a term renders for the organizer**: home "Najbliższe terminy", "Terminy" view,
  "Spotkania" view. Public krąg views unchanged (read-only).
- **NeededItem sub-CRUD** — within a term's needed-items list (organizer view): an inline add row
  (reuse the existing add-needed-item form / `Field`), a `PencilIcon` per row → inline edit
  (`category` select + `description` input), a `TrashIcon` per row → **optimistic remove + toast
  "Usunięto"**; on server error (409 etc.) restore the row + inline/toast error. No `ConfirmDialog`.
- **InventoryItem edit/delete** — in "Moje rzeczy" view: `condition` inline editor per item;
  `TrashIcon` per item → optimistic remove + toast; on 409 (reserved/lent) or error → restore row +
  message. No `ConfirmDialog`.
- **Circle rename** — inline editor on the organizer's circle name (same pattern as family rename);
  in the circle/"Grupy" section of the organizer view.
- Remove the `PanelPage.tsx` L60-66 "Termin / rzecz … przycisk celowo pominięty" comment.
- No restore/undo button anywhere; no restore endpoint.

## User journey
- **Organizer** opens their panel → "Terminy" / "Spotkania" → taps the pencil on a term's date or
  description → edits inline → saves. Taps pencil/trash on a needed item to fix or remove it
  (removing one that a parent pledged for silently withdraws the pledge; a TODO marks where a
  notification would go). Renames their circle inline.
- **Item owner** opens "Moje rzeczy" → changes an item's condition inline, or trashes an item they
  no longer have (blocked with a message if it's currently reserved/lent).
- **Public visitors** — no change; the public krąg page never shows any edit/delete control.

## Existing code to reuse
- `rename_family` (`families/service.py:155-179`) + `update_organization` (`organizations/service.py:118-136`)
  — the backend PATCH template (get → ownership → partial-apply → commit/refresh).
- `_require_active_organizer` (`groups/service.py:288`) — Term/NeededItem/Group ownership check.
- `withdraw_pledge` (`groups/service.py:478-486`) — the pledge → WITHDRAWN transition.
- `create_reservation` status guard (`circulation/service.py:261-265`) — the "not AVAILABLE → 409" pattern.
- `get_user_id_by_principal`, `get_inventory`, `get_item`, `get_item_balance` (`circulation/service.py`).
- `models.md:169-170` `deleted_at` + explicit `.where(...is_(None))` idiom.
- Frontend: family-rename inline editor in `PanelPage.tsx` (`renamingFamily`/`familyNameDraft`/
  `renameError` + start/cancel/save + `load({ silent: true })`); `PencilIcon`, `TrashIcon`,
  `Field` exports; the existing add-needed-item form in `handleAddTerm`; `ItemQuickAddForm` /
  `itemQuickAdd.ts` for the item condition field.
- `test_families.py` / `test_organizations.py` — PATCH test template (owner 200, non-owner 403,
  unknown id 404, bad body 400).

## Visual assets
None. Phase 4 mockups skipped by user choice; UI described in-prose above.

## Scope boundaries
IN: PATCH Term/Group/NeededItem/InventoryItem; soft-DELETE NeededItem/InventoryItem; migration 0017;
read-site filtering; pledge-withdraw cascade + 409 guards; matrix rows + test; all frontend inline
edit/delete affordances in PanelPage; API client fns; affected test updates + new `test_circulation.py`.

OUT: notifications/emails/events (no infra); Term delete; Group delete; editing an item's
name/category (Product); a restore/un-delete endpoint or undo UI; RSVP/TermAttendance lifecycle
changes; `ConfirmDialog`; partial indexes; touching the public krąg read views beyond what the
central read-filter already covers.

## Technical considerations
- `codebase-analysis.md` predates the revised scope (it still assumes `Term.deleted_at` + term
  delete). `clarifications.md` + `scope-clarifications.md` are authoritative.
- Validation errors return **HTTP 400** in this repo (Pydantic + validator `ValueError` both mapped
  in `app/core/errors.py`), NOT 422.
- Circulation vertical has NO `party_id` concept — it uses raw `users.id` via `get_user_id_by_principal`.
- `get_public_circle_view` picks `next_term` from `list_terms` and reads needed items — the needed-item
  filter must reach it (central filter in `list_needed_items` covers the common path; verify the
  explicit-term branch too).
- No `test_circulation*` file exists yet — create `src/backend/tests/test_circulation.py`.
