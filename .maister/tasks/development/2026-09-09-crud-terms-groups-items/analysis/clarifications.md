# Phase 1 — Clarifications

Date: 2026-09-09

## Revised scope (supersedes the pre-workflow AskUserQuestion answers)

### Q1 — Term: PATCH only, NO delete
**Decision:** A Term is **never deleted** — only modified (date `occurs_on`, `description`, and its
needed-items list). **No `deleted_at` column on `terms`, no term-delete endpoint, no term read-site
filtering.** This reverses the earlier "term: edit + delete".

### Q2 — NeededItem: full CRUD
**Decision:** POST (exists) + **PATCH** (edit `category`, `description`) + **soft-DELETE**.
The needed-items list is edited *as part of* the term-edit surface on the frontend.
- New nullable `deleted_at` column on `needed_items` + `.where(deleted_at IS NULL)` at every
  needed-item read site.

### Q3 — Deleting a NeededItem that has active Pledges → Option A
**Decision:**
- Open/claimed pledges (`Pledge.status IN (OPEN, CLAIMED)`) on that needed item → set to `WITHDRAWN`
  (reuse the `withdraw_pledge` transition) as part of the same transaction.
- A `FULFILLED` pledge (has `resolved_reservation_id` → a real circulation Reservation/InventoryItem)
  → **block the delete with 409 `BusinessConflictException`** ("nie można usunąć — rzecz już dostarczona").
- Leave a `# TODO: notify pledger that the organizer no longer needs this item` hook at the withdraw
  point. **No notification system is built in this task** — there is no notification/email/event
  infrastructure anywhere in `src/backend/app` today; that is a separate future `/maister:development`.

### Q4 — InventoryItem ("rzeczy"): PATCH (condition only) + soft-DELETE
**Decision:**
- **PATCH** edits **`condition` only** (the enum). Name/category live on `Product` and are NOT
  editable here — changing them = delete the item + add a new one. No `resolve_product` re-run.
- **soft-DELETE**: new nullable `deleted_at` column on `inventory_items` + `.where(deleted_at IS NULL)`
  at every inventory-item read site.
- **DELETE is blocked with 409** when the item's `InventoryBalance.status != AVAILABLE`
  (RESERVED / LENT / ...) — mirrors the `create_reservation` eligibility guard. PATCH stays allowed
  regardless of balance status.

### Q5 (from earlier) — Group (circle): PATCH only
**Decision:** `PATCH /api/groups/{id}` edits `name` only (Group has only `name` + `party_id`).
No delete — "removing a circle" is already modelled as `end_leadership` (the group row stays, the
leadership closes).

## Soft-delete mechanics (decided by orchestrator, low-risk)
- Column: `deleted_at: TIMESTAMP NULL` (matches model `DateTime()`; `sa.TIMESTAMP()` in the migration).
  Applied to **`needed_items`** and **`inventory_items`** only (NOT `terms`, NOT `groups`).
- One Alembic migration `0017_needed_item_inventory_item_soft_delete.py`, `down_revision = "0016"`,
  additive nullable columns, reversible `downgrade()`. One logical change ("add soft-delete").
- Model: `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)` on
  `NeededItem` and `InventoryItem` (not on `BaseEntity`).
- Read strategy: filter centrally in the `list_*` service functions; `get_*` helpers raise 404 for a
  soft-deleted row (treat as not-found).
- `BaseEntity.updated_at` (the `version_id_col`) auto-bumps on the soft-delete UPDATE — no manual touch.

## Ownership checks (service layer, per security.md)
- NeededItem PATCH/DELETE: `ni = get_needed_item(id)` (404) → `term = get_term(ni.term_id)` →
  `_require_active_organizer(db, term.circle_group_id, profile.party_id)` (403).
- Group PATCH: `get_group(id)` (404) → `_require_active_organizer(db, group_id, profile.party_id)` (403).
  (Consistent with `create_term`; alternative `get_own_circle().id != id` also acceptable.)
- InventoryItem PATCH/DELETE: `item = get_item(id)` (404) → `inv = get_inventory(item.inventory_id)` →
  `inv.owner_user_id != acting_user_id` → `AccessDeniedException` (403). `acting_user_id` from
  `circulation.service.get_user_id_by_principal` (circulation uses raw `users.id`, not `party_id`).

## Frontend
- Inline-edit pattern (family-rename template: `renamingX`/`xDraft`/`xError` trio +
  `load({ silent: true })`), NOT modals — except where the needed-items sub-list needs a small
  add/edit form (reuse `Field` from PanelPage).
- Term edit: date + description inline; needed-items add/edit/remove within the term's card/view.
- Item edit: `condition` change + delete in the "Moje rzeczy" view.
- Circle rename: inline, in the organizer's circle section.
- Public krąg pages (`PublicKragGrupyView`, `usePublicKragGrupy`) **never** show edit/delete controls.
- Remove the `PanelPage.tsx` L60-66 "przycisk celowo pominięty" comment once endpoints land.
- `api.patch` / `api.delete` already exist in `client.ts` — no client change.

## Out of scope
Notifications/emails; Term delete; Group delete; editing item name/category (=Product); RSVP/attendance
lifecycle changes; a confirm-dialog design overhaul (a simple confirm for destructive delete is fine).
