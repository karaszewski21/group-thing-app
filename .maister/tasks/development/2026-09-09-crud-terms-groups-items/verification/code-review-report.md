# Code Review Report

**Date**: 2026-09-09
**Path**: `.maister/tasks/development/2026-09-09-crud-terms-groups-items` diff (`3a0c02a..HEAD` + working tree)
**Scope**: quality, security, performance (this task's diff)
**Status**: ⚠️ Issues Found

## Summary
- **Critical**: 0
- **Warnings**: 3
- **Info**: 5
- Files analyzed: 17 (backend service/router/schema/model/migration/tests, frontend api + PanelPage + tests)

---

## Priority-focus verdicts

| # | Focus | Verdict |
|---|-------|---------|
| 1 | Soft-delete read filters (spec §7) | PASS for the §7 checklist — see W1 for the `/balance` site §7 omits |
| 2 | `soft_delete_needed_item` FULFILLED guard / cascade | PASS |
| 3 | `soft_delete_item` balance guard / ownership | PASS |
| 4 | AUTHORIZATION_MATRIX ordering + test | PASS |
| 5 | Migration 0017 | PASS |
| 6 | update_* ownership + 404-before-ownership + partial-apply | PASS |
| 7 | Frontend optimistic delete / single-field / no XSS | Mostly PASS — see W2, W3, I2, I3 |

### Detail

**1 — read filters.** `groups/service.py`: `list_needed_items` adds `deleted_at.is_(None)` (L478); `get_needed_item` raises `EntityNotFoundException` on `deleted_at is not None` (L470-471); `list_pledges` gains a `get_needed_item` guard (L572); `get_public_circle_view` reads needed items through `list_needed_items` (L815) so it inherits the filter. `circulation/service.py`: `list_items` filtered (L173-176), `get_item` 404s on soft-deleted (L166-167). A codebase grep for `select(NeededItem|InventoryItem)` / `db.get(...)` / FK-column joins shows **no other read path** bypassing these helpers. Downstream lifecycle callers (`create_pledge`, `create_reservation`, `fulfill_pledge`, `_current_holder_user_id`) all go through `get_needed_item` / `get_item` and inherit the 404. `test_circulation.py::test_createReservation_softDeletedItem_returns404` confirms one downstream path.

**2 — `soft_delete_needed_item` (groups/service.py L518-543).** FULFILLED detection is `pledge.status == PledgeStatus.FULFILLED or pledge.resolved_reservation_id is not None`, evaluated in an `any(...)` that raises `BusinessConflictException` **before** any mutation — no partial state. OPEN/CLAIMED pledges go through `_withdraw_pledge_row` (L513-515), a new private helper that only sets `status = WITHDRAWN` — identical to `withdraw_pledge`'s transition line (verified L585-586) and correctly skips `_require_pledging_party`. Single `db.commit()` at L543. `# TODO: notify pledger…` comment present at L514.

**3 — `soft_delete_item` (circulation/service.py L206-217).** `_require_item_owner` resolves `acting_user_id` via `get_user_id_by_principal` and compares `inventory.owner_user_id` (raw `users.id`, never `party_id`). Balance guard raises `BusinessConflictException` before the write; `deleted_at` set then single `commit()`. Dangling 1:1 `InventoryBalance` row is left in place (spec-accepted) — see I1.

**4 — matrix (auth_deps.py).** `(_methods("PATCH"), r"^/api/groups/[^/]+$", EDIT)` at L242 sits after the `/api/groups/mine/...` (L226) and `/api/groups/public/...` (L231-237) rows and before the blanket `GET ^/api/groups(/.*)?$` (L248). The other three rows (`terms` L264, `needed-items` L267, `inventory-items` L278) precede their blanket GET/POST siblings. `test_authorization_matrix.py` asserts all six new (method, path) → `EDIT` resolutions **and** that `GET /api/groups/mine/attendances` → `READ` and `GET /api/groups/public/some-id` → `PUBLIC` do not regress.

**5 — migration 0017.** `revision="0017"`, `down_revision="0016"`, two additive `sa.TIMESTAMP()` nullable `add_column`s, `downgrade()` drops both (reverse order), no index, no sequence, no app-code import. Models add `deleted_at: Mapped[datetime | None]` to `NeededItem` and `InventoryItem` only (not `BaseEntity`).

**6 — ownership / ordering.** `update_term` (L432-448), `update_group` (L136-146), `update_needed_item` via `_require_needed_item_organizer` (L484-490), `update_item` via `_require_item_owner` — every one loads the entity (→404) *before* the ownership check, and every field apply is `if data.f is not None`.

**7 — frontend.** `updateTerm(term.id, { [field]: next })` sends exactly one field. `handleDeleteNeededItem` captures `entry`/`index`/`item` from current `terms` state **before** `setTerms`, restores via `splice(index, 0, item)`, and guards the re-insert with `t.neededItems.some(ni => ni.id === itemId)`. No `ConfirmDialog`, no restore-endpoint call. Public views (`KragGrupyPage` / `PublicKragGrupyView` / `usePublicKragGrupy`) are untouched. All rendered values go through JSX text nodes — no `dangerouslySetInnerHTML`, no XSS.

---

## Warnings

### W1 — `GET /api/inventory-items/{id}/balance` still returns 200 for a soft-deleted item
**Location**: `src/backend/app/circulation/service.py:181-186` (`get_item_balance`), router `GET /api/inventory-items/{item_id}/balance`
**Category**: security / correctness (spec-contract violation)
`get_item_balance` selects `InventoryBalance` directly by `item_id` and never consults the parent item's `deleted_at`. Spec §4 Notes state: "`GET /api/inventory-items/{id}` **and `/balance`** return 404 once the item is soft-deleted." The §7 checklist omitted this site, and the implementation followed §7, so the balance endpoint leaks the (status-only) record of a soft-deleted item to any caller holding `READ`. Low blast radius, but it is an uncovered read site and a contract deviation.
**Fix**: add `await get_item(db, item_id)` at the top of `get_item_balance` (mirrors the `list_pledges` guard pattern), or have the router call `get_item` first. Add `test_getInventoryItemBalance_softDeleted_returns404`.
**Fixable**: true

### W2 — Optimistic-delete restore re-inserts a successfully-deleted row on a double-fire
**Location**: `src/frontend/src/pages/panel/PanelPage.tsx` `handleDeleteNeededItem` (~L395-424) and `handleDeleteItem` (~L572-589)
**Category**: quality / UX correctness
The trash buttons are not disabled while a delete is in flight. Two quick clicks fire two `deleteNeededItem(id)` / `deleteInventoryItem(id)` calls: the first returns 204, the second returns **404** (row already soft-deleted), whose `catch` branch runs the restore — re-inserting a row that really is gone until the next full reload. `handleDeleteNeededItem`'s `.some()` guard only prevents a *double* insert, not this success-then-404 re-insert; `handleDeleteItem` has no guard at all (raw `splice(index, 0, removed)` inside the updater).
**Fix**: guard the handler against re-entry (e.g. a per-id in-flight set, or `disabled` on the button), and/or treat a 404 from the delete call as success (row already gone).
**Fixable**: true

### W3 — Unrelated behavior changes ride along in this task's diff
**Location**: `src/frontend/src/pages/panel/PanelPage.tsx` (become-organizer HintCard, `hint_org_first_term_dismissed` key split, `FirstTermStepperOrganizer` `myGroups.length > 0` gate, commented-out hamburger "Dodaj pierwszy termin" `menuitem` at ~L1183-1191) and matching `PanelPage.test.tsx` blocks
**Category**: best practices (change hygiene, `conventions.md` "clean version control")
Spec §13 scopes the frontend to inline edit/delete affordances + the L60-66 comment removal. The hint-card refactor, the stepper-selection fix, and the commented-out (not deleted) menu item are separate concerns folded into the same commit/working tree, which complicates review and rollback. The commented-out JSX block specifically violates `commenting.md` (no dead-code comments) — it should be deleted, not `/* */`-wrapped.
**Fixable**: true (split out or at least delete the commented block)

---

## Informational

### I1 — Dangling `InventoryBalance` after `soft_delete_item`
`circulation/service.py:206-217` leaves the 1:1 balance row. Spec-accepted (§4 R4, "harmless once the item is filtered from reads"). Noted only because the row becomes unreachable state; a future hard-delete/admin tool must clean it up. No action now.

### I2 — Needed-item / term edit cannot clear a text field back to NULL
`saveEditNeededItem` sends `description: editingNeededItem.description.trim()` and `saveEditTermField` sends `{ [field]: next }` with `next = draft.trim()`. Clearing the input sends `""`, and the backend partial-apply (`if data.description is not None`) writes an empty string rather than `NULL`. Minor; matches how `create` behaves and no AC requires re-nulling.

### I3 — `saveEditNeededItem` always sends both `category` and `description`
Unlike the term editor (single changed field), the needed-item editor PATCHes both fields every save. Harmless (both are valid partial-apply fields) and spec R7 does not require single-field granularity here, but it is an inconsistency with the term-editor pattern it is modeled on.

### I4 — `datetime.utcnow()` used for `deleted_at`
`groups/service.py:542`, `circulation/service.py:216`. Deprecated in Python 3.12 (naive UTC). Consistent with existing repo usage (`added_at=datetime.utcnow()` etc.), so not introduced here — flag for a future repo-wide `datetime.now(UTC)` migration, not this task.

### I5 — `_withdraw_pledge_row` TODO comment is the only notification marker
`groups/service.py:513-515` — matches spec §3/§10 exactly (no notification infra exists). Listed so the reviewer confirms this is intentional and not an unfinished feature.

---

## Metrics
- Longest new function: `neededItemsEditor` (~125 lines, JSX-heavy render helper in `PanelPage.tsx`) — acceptable for a co-located render helper; `soft_delete_needed_item` is ~25 lines.
- Max nesting depth: 3 (service layer), ~5 (PanelPage JSX ternaries — typical for this file).
- New DB queries per request: `soft_delete_needed_item` = 1 pledge SELECT + 1 commit (no N+1). `list_*` filters are index-free but FK-scoped and small (spec-accepted, no partial index).
- Potential data leaks: 1 (W1).
- Injection risks: 0 (all SQLAlchemy-bound; matrix regex unchanged pattern).

## Prioritized Recommendations
1. **W1** — add a `get_item` guard to `get_item_balance` (or the balance route) so `/balance` 404s for soft-deleted items; add the missing test. Closes the one real read-path leak.
2. **W2** — disable the trash buttons while a delete is in flight (or treat delete-404 as success) in both optimistic handlers.
3. **W3** — split the unrelated hint/stepper changes out of this task, and delete (don't comment out) the dead hamburger `menuitem` block.
4. **I2/I3** — optional consistency polish on the needed-item editor.
