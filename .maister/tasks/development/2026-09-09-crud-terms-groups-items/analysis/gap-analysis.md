# Gap Analysis: Add edit / soft-delete to Term, NeededItem, InventoryItem, Group

**Date**: 2026-09-09
**Inputs**: task description, `analysis/clarifications.md` (authoritative), `analysis/codebase-analysis.md`
**Note**: `codebase-analysis.md` predates the revised scope and still discusses a `Term.deleted_at` column + term delete endpoint. That is **superseded** by `clarifications.md`: Term is PATCH-only, no delete, no `deleted_at`. `deleted_at` lands on `needed_items` + `inventory_items` **only**.

## Summary
- **Risk Level**: low-medium
- **Estimated Effort**: medium
- **Detected Characteristics**: modifies_existing_code, involves_data_operations, ui_heavy

Edit endpoints are near-mechanical copies of `update_organization` / `rename_family`. The real work is (a) the net-new soft-delete column + `.where(deleted_at IS NULL)` at every needed-item / inventory-item read site (no global filter in SQLAlchemy), (b) the NeededItem delete → Pledge cascade with the FULFILLED-pledge 409 guard, and (c) the InventoryItem delete 409 guard on non-AVAILABLE balance. No new tables/entities; additive AUTHORIZATION_MATRIX rows only.

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes
- Creates new entities: no (new columns + endpoints, no new tables/aggregates)
- Involves data operations: yes (UPDATE + soft-DELETE across 4 entities)
- UI heavy: yes (edit/delete surface in `PanelPage.tsx`)

## Current vs Desired

### Term (`app.groups`)
| | Current | Desired |
|---|---|---|
| Backend | `create_term` (svc 385), `get_term` (399), `list_terms` (406); routes `POST/GET /api/terms` + `GET /api/terms/{id}` (router 238-257) | + `PATCH /api/terms/{id}` editing `occurs_on`, `description`. **No delete. No `deleted_at`. No read-site filtering.** |
| Schema | `TermResponse`, `CreateTermRequest` (schemas 81-95) | + `UpdateTermRequest(occurs_on: date \| None = None, description: str \| None = Field(default=None, max_length=2000))` |
| Ownership | `_require_active_organizer(db, circle_group_id, party_id)` (svc 288) | reuse: `get_term` (404) → `_require_active_organizer(term.circle_group_id, profile.party_id)` (403) |
| Matrix | rows for `GET`/`POST` only (auth_deps ~256-257) | + `PATCH ^/api/terms/[^/]+$ → ("EDIT","mcp:edit")`, ahead of blanket rows |
| Frontend | term tiles render-only; add-term modal exists | inline edit of date + description within the term surface |

### NeededItem ("potrzebna rzecz", `app.groups`)
| | Current | Desired |
|---|---|---|
| Backend | `create_needed_item` (svc 413), `get_needed_item` (429, `db.get`, no filter), `list_needed_items` (436, no filter); routes `POST/GET /api/needed-items` + `GET /api/needed-items/{id}` (router 261-283) | + `PATCH /api/needed-items/{id}` (edit `category`, `description`) + soft-`DELETE /api/needed-items/{id}` (204) |
| Column | none | new nullable `deleted_at: Mapped[datetime \| None] = mapped_column(DateTime(), nullable=True)` on `NeededItem` (not `BaseEntity`) |
| Schema | `NeededItemResponse`, `CreateNeededItemRequest` (schemas 98-115); `category: NeededItemCategory` (StrEnum, models 48) | + `UpdateNeededItemRequest(category: NeededItemCategory \| None = None, description: str \| None = Field(default=None, max_length=...))`, partial-apply |
| Delete cascade | n/a | in one tx: `Pledge.status IN (OPEN, CLAIMED)` → `WITHDRAWN` (mirror `withdraw_pledge` svc 478-486); any pledge with `resolved_reservation_id` set (FULFILLED) → **409 `BusinessConflictException`**; leave `# TODO: notify pledger` at the withdraw point. No notification infra built. |
| Read filtering | none | `.where(NeededItem.deleted_at.is_(None))` in `list_needed_items` (436), `get_needed_item` → **404** on soft-deleted (covers `create_pledge` svc 448, `fulfill_pledge` svc 499). `get_public_circle_view` inherits via `list_needed_items` (svc 711). |
| Matrix | `POST /api/needed-items`, `GET` rows | + `PATCH` **and** `DELETE ^/api/needed-items/[^/]+$ → ("EDIT","mcp:edit")` ahead of blanket rows |
| Frontend | needed-items shown inside term view | add / edit / remove needed-items within the term surface; small add/edit form reusing `Field` |

### InventoryItem ("rzecz", `app.circulation`)
| | Current | Desired |
|---|---|---|
| Backend | `register_item` (svc 128), `get_item` (157, no filter), `list_items` (164, no filter); routes `POST/GET /api/inventory-items` + `GET /{id}` + `GET /{id}/balance` (router 78-113) | + `PATCH /api/inventory-items/{id}` (edit `condition` enum **only**) + soft-`DELETE /api/inventory-items/{id}` (204) |
| Column | none | new nullable `deleted_at` on `InventoryItem` |
| Schema | `InventoryItemResponse`, `CreateInventoryItemRequest` (schemas 53-68) | + `UpdateInventoryItemRequest(condition: ItemCondition \| None = None)` — name/category live on `Product`, not editable here |
| Ownership | `inventory.owner_user_id != owner_user_id` → `AccessDeniedException` (svc 143) | `get_item` (404) → `get_inventory(item.inventory_id)` → `owner_user_id != acting_user_id` → 403. `acting_user_id` from `get_user_id_by_principal` (svc 66, raw `users.id`) |
| Delete guard | n/a | `DELETE` → **409 `BusinessConflictException`** when `InventoryBalance.status != AVAILABLE` (RESERVED/LENT — `BalanceStatus`, models 63). Precedent: `create_reservation` guard (svc 261-265 / swap guard 307-310). PATCH stays allowed regardless of balance status. |
| Read filtering | none | `.where(InventoryItem.deleted_at.is_(None))` in `list_items` (164); `get_item` → 404 on soft-deleted (covers `create_reservation` svc 252, `create_swap` 302, confirm/cancel/fulfill, `_current_holder_user_id` 357, cross-BC `fulfill_pledge` svc 489) |
| Matrix | `POST /api/inventory-items`, `GET` rows (auth_deps ~264-265) | + `PATCH` **and** `DELETE ^/api/inventory-items/[^/]+$ → ("EDIT","mcp:edit")` ahead of blanket rows |
| Frontend | items render-only in "Moje rzeczy" | condition edit + delete (with confirm) in "Moje rzeczy" |

### Group / circle (`app.groups`)
| | Current | Desired |
|---|---|---|
| Backend | `create_own_circle` (svc 90), `get_group` (123), `list_groups` (118); routes 52-153 | + `PATCH /api/groups/{id}` editing `name` **only**. No delete (removal = `end_leadership`). No `deleted_at`. |
| Schema | `GroupResponse`, `CreateCircleRequest` (schemas 16-28) | + `UpdateCircleRequest` — prefer required `name: str` + blank-rejecting `field_validator` (mirror `UpdateFamilyRequest`), since rename is the only Group op |
| Ownership | n/a | `get_group` (404) → `_require_active_organizer(db, group_id, profile.party_id)` (403) |
| Matrix | `GET`/`POST` rows (auth_deps ~243-244) | + `PATCH ^/api/groups/[^/]+$ → ("EDIT","mcp:edit")` ahead of blanket rows |
| Frontend | circle name render-only | inline rename in organizer circle section |

### Migration 0017
- File `0017_needed_item_inventory_item_soft_delete.py`, `revision = "0017"`, `down_revision = "0016"` (current head confirmed).
- `upgrade()`: `op.add_column("needed_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))` + same for `inventory_items`.
- `downgrade()`: drop both columns. One logical change. No new sequence. No app-code import.

## Data Lifecycle Analysis

### NeededItem — CRUD after this task
| Op | Backend | UI | User access | Status |
|---|---|---|---|---|
| CREATE | `POST /api/needed-items` (exists) | add form in term surface (new) | organizer term view | ✅ (UI new) |
| READ | `GET/list` (exists) + new `deleted_at` filter | term view list (exists) | organizer + public term | ✅ |
| UPDATE | `PATCH` (new) | inline/edit form (new) | organizer term view | ✅ |
| DELETE | soft-`DELETE` + pledge cascade (new) | trash + confirm (new) | organizer term view | ✅ |
**Completeness after task: 100%.** No orphaned operations — every new backend op has a matching UI touchpoint in `PanelPage.tsx`.

### InventoryItem — CRUD after this task
| Op | Backend | UI | User access | Status |
|---|---|---|---|---|
| CREATE | `POST` (exists) | item add modal (exists) | "Moje rzeczy" | ✅ |
| READ | `GET/list` (exists) + `deleted_at` filter | "Moje rzeczy" list (exists) | panel | ✅ |
| UPDATE | `PATCH condition` (new) | condition control (new) | "Moje rzeczy" | ✅ |
| DELETE | soft-`DELETE` + 409 guard (new) | trash + confirm (new) | "Moje rzeczy" | ✅ |
**Completeness after task: 100%.**

### Orphan check — pledge reads vs soft-deleted NeededItem
`list_pledges` (svc 468) filters only by `needed_item_id`, no parent-state check. After a NeededItem soft-delete its pledges are `WITHDRAWN` but still returned by `list_pledges` and `get_pledge` (svc 461, used by `withdraw_pledge`/`fulfill_pledge`/`sync_pledge_fulfillment`). This is a **decision** (below), not necessarily a bug — WITHDRAWN pledges are terminal, but a stale `GET /api/needed-items/{id}/pledges` on a deleted item is inconsistent with `get_needed_item` returning 404.

## User Journey Impact

| Dimension | Current | After | Assessment |
|---|---|---|---|
| Term/needed-item edit reachability | none (render-only) | organizer term surface | ✅ +1 |
| Item condition/delete reachability | none | "Moje rzeczy" view | ✅ +1 |
| Discoverability (edit) | n/a | ~7/10 — pencil/trash icons already imported (`PencilIcon`, `TrashIcon`), family-rename precedent sets the pattern users have seen | ✅ |
| Flow integration | L60-66 comment explicitly documents the *absence* of delete | comment removed; edit/delete now consistent with family-rename | ✅ |
| Multi-persona | organizer edits Term/NeededItem/Group; item owner edits own items; **public krąg pages (`PublicKragGrupyView`, `usePublicKragGrupy`) never expose edit/delete** | unchanged for guest/public | ✅ (must verify public views stay read-only + consume filtered API) |

## Issues Requiring Decisions
_Only NEW decisions not already settled in `clarifications.md`._

### Critical (decide before spec)
1. **NeededItem soft-DELETE — AUTHORIZATION_MATRIX coverage.** Today only `POST /api/needed-items` and `GET` rows exist; there is no method row for `DELETE ^/api/needed-items/[^/]+$` or `PATCH ^/api/needed-items/[^/]+$`. First-match-wins means a missing row falls through to whatever blanket row matches (possible deny or wrong scope).
   - Options: (A) add explicit `PATCH` + `DELETE` rows → `("EDIT","mcp:edit")` ahead of blanket rows; (B) add a single combined `_methods("PATCH","DELETE")` row (precedent: organizations `_methods("POST","PATCH")` auth_deps ~280).
   - Recommendation: **B** — one combined `PATCH`/`DELETE` row per entity path (`terms` PATCH-only, `needed-items` PATCH+DELETE, `inventory-items` PATCH+DELETE, `groups` PATCH-only). Same permission, fewer lines, matches existing idiom.

### Important (decide during spec)
2. **Frontend term-edit shape: true inline field-swap vs expand-to-edit card.** The family-rename template edits one string. A Term has two fields (`occurs_on` date + `description`) plus a needed-items sub-list edited on the same surface — richer than a rename.
   - Options: (A) per-field inline editors (`renamingTermDate`/`termDateDraft`/... trios, each independently saved); (B) one "edit mode" on the term card that reveals date + description inputs + needed-items add/edit/remove, single save.
   - Recommendation: **B** for the term card (date + description together), keeping needed-items add/edit/remove as their own small inline sub-forms. Matches `clarifications.md` "within the term's card/view".
3. **Which term views get the edit/delete affordance.** Term tiles render in home (~L863), "Terminy" organizer view (~L1130), "Spotkania" (~L1204). `clarifications.md` says edit is organizer-only.
   - Recommendation: edit/delete controls in the **organizer "Terminy" view only** (and needed-items there); home + "Spotkania" stay render-only. NeededItem delete lives in that same surface.
4. **Destructive-delete confirmation UX** for NeededItem + InventoryItem delete.
   - Options: (A) `ConfirmDialog.tsx` (used by `ProductListPage`); (B) inline two-step ("Usuń" → "Na pewno?"); (C) optimistic delete + toast undo (Panel group-removal uses plain button + toast, no confirm).
   - Recommendation: **A** `ConfirmDialog.tsx` for both — deletes are cascading (pledges withdrawn) / guarded (409), not trivially reversible in the UI; a plain toast is too weak. Note `clarifications.md` L76 already blesses "a simple confirm".
5. **Pledge reads vs soft-deleted NeededItem.** Should `list_pledges` (svc 468) / `get_pledge` (svc 461) 404 or exclude when the parent `NeededItem.deleted_at` is set?
   - Options: (A) add a parent-state guard to `list_pledges` (raise 404 via `get_needed_item`) and leave `get_pledge` alone (WITHDRAWN pledges are terminal); (B) add `NeededItem.deleted_at IS NULL` join filter to both; (C) do nothing — pledges are already WITHDRAWN, endpoint is organizer-facing only.
   - Recommendation: **A** — cheap consistency win (`list_pledges` already can call `get_needed_item`), no need to touch the pledge-lifecycle reads.
6. **`UpdateNeededItemRequest.category` typing.** Codebase evidence: `category` is `NeededItemCategory` (StrEnum, 30-char column) — **not free text**. Confirm PATCH constrains to the enum and both fields are optional partial-apply (`if data.x is not None`). Low-risk; flag only to make it explicit in the spec.
7. **Partial index on `deleted_at`.** `models.md` mentions `postgresql_where=sa.text("deleted_at IS NULL")` partial-index idiom.
   - Recommendation: **skip** for 0017 — needed-item / inventory-item list queries are small and term/inventory-scoped; add later only if a query plan shows a need. Keeps the migration to "one logical change".

## Integration Points

**Backend — new surface**
- `groups/schemas.py`: `UpdateTermRequest`, `UpdateNeededItemRequest`, `UpdateCircleRequest`
- `groups/models.py`: `NeededItem.deleted_at`
- `groups/service.py`: `update_term`, `update_needed_item`, `soft_delete_needed_item` (+ pledge cascade + 409), `update_group`; add `deleted_at` filter to `list_needed_items` (436), `get_needed_item` (429, →404)
- `groups/router.py`: `PATCH /api/terms/{id}`, `PATCH`+`DELETE /api/needed-items/{id}`, `PATCH /api/groups/{id}`
- `circulation/schemas.py`: `UpdateInventoryItemRequest`
- `circulation/models.py`: `InventoryItem.deleted_at`
- `circulation/service.py`: `update_item`, `soft_delete_item` (+ balance 409 guard); add `deleted_at` filter to `list_items` (164), `get_item` (157, →404)
- `circulation/router.py`: `PATCH`+`DELETE /api/inventory-items/{id}` (use `acting_user_id` / `get_user_id_by_principal` pattern, cf. `confirm_reservation` router 156-162)
- `core/auth_deps.py`: matrix rows for `terms` PATCH, `needed-items` PATCH+DELETE, `inventory-items` PATCH+DELETE, `groups` PATCH — all ahead of blanket rows

**Backend — read sites to audit for the `deleted_at` filter** (needed-item + inventory-item only): `list_needed_items` (svc 436), `get_needed_item` (429), `get_public_circle_view` needed-items branch (svc 711 — inherits if `list_needed_items` filters centrally), `list_pledges` (468, per decision #5); `list_items` (svc 164), `get_item` (157). Term reads unchanged (no `Term.deleted_at`).

**Migration**: `src/backend/alembic/versions/0017_needed_item_inventory_item_soft_delete.py` (down_revision `0016`).

**Frontend**
- `src/frontend/src/api/terms.ts`: `UpdateTermRequest`, `updateTerm(id, req)` → `api.patch`
- `src/frontend/src/api/groups.ts`: `updateCircle(id, {name})` → `api.patch("/groups/{id}")`
- `src/frontend/src/api/inventories.ts`: `updateInventoryItem(id, {condition})`, `deleteInventoryItem(id)`
- (needed-items API — add `updateNeededItem`, `deleteNeededItem`; check whether they live in `terms.ts` or a `neededItems.ts`)
- `src/frontend/src/pages/panel/PanelPage.tsx`: inline term edit (organizer "Terminy"), needed-items add/edit/remove, item condition edit + delete ("Moje rzeczy"), circle rename inline; **remove L60-66 comment block**
- `src/frontend/src/components/shared/ConfirmDialog.tsx`: reuse for destructive deletes
- `src/frontend/src/components/shared/ItemQuickAddForm.tsx`: presentational, reusable as condition-edit form
- Audit read-only: `src/frontend/src/pages/krag/KragGrupyPage.tsx` (`PublicKragGrupyView`), `src/frontend/src/hooks/usePublicKragGrupy.ts` — no edit/delete controls, consume filtered API only
- `src/frontend/src/api/client.ts`: **no change** (`patch`/`delete` exist, 204 handled)

**Tests**
- `src/backend/tests/test_groups.py`: Term PATCH (organizer 200 in-place / non-organizer 403 / unknown-id 404), Group PATCH (same trio + blank-name→400), NeededItem PATCH + soft-DELETE (excluded from list + public view / get→404 / OPEN+CLAIMED pledges→WITHDRAWN / FULFILLED pledge→409)
- **New** `src/backend/tests/test_inventory_items.py` (no `test_circulation*`/`test_inventory*` exists): InventoryItem PATCH condition (owner 200 / non-owner 403 / unknown 404), soft-DELETE (excluded from reads / non-AVAILABLE balance→409)
- Update `src/backend/tests/test_public_term.py`: soft-deleted NeededItem not surfaced in public term needed-items
- Check `src/backend/tests/test_my_attendances.py`: unaffected (Term has no `deleted_at`) — confirm no assumption breaks
- `src/frontend/src/test/PanelPage.test.tsx`: inline term-edit / needed-item edit+remove / item condition-edit+delete / circle-rename describe blocks mirroring the "Mój dom — inline family rename" tests (L909-954)
- `src/frontend/src/test/PublicKragGrupyPage.test.tsx`: keep asserting absence of edit/delete controls
- `src/backend/alembic` migration round-trip (upgrade/downgrade) covered by conftest `alembic upgrade head`

## Risk Assessment
- **Complexity risk**: low-medium. Edit endpoints mechanical; soft-delete cascade + guards are the only genuine domain logic.
- **Integration risk**: medium — ~5 needed-item/inventory read sites must each gain `.where(deleted_at.is_(None))`; missing one silently leaks deleted rows. Mitigate by filtering centrally in `list_*` / `get_*`.
- **Regression risk**: low. Additive columns (nullable), additive matrix rows, additive endpoints. Pre-production, no backward-compat burden. Soft-delete is recoverable. Watch: `get_needed_item` / `get_item` switching to 404-on-deleted changes behaviour for downstream callers (`create_pledge`, `create_reservation`, `fulfill_pledge`) — intended, but needs a test each.

## Phase Summary
This is a modify-existing-code task adding PATCH to four entities and soft-DELETE to two, all closely templated on the just-shipped `rename_family` / `update_organization` PATCH pattern; the only net-new mechanics are a `deleted_at` column (migration 0017) with manual read-site filtering and two delete-time 409 guards (NeededItem FULFILLED-pledge, InventoryItem non-AVAILABLE balance). Seven open decisions remain — one critical (matrix row strategy) and six important (frontend edit shape, affordance placement, confirm UX, pledge-read consistency, category typing, partial index) — none blocking, all resolvable in spec.
