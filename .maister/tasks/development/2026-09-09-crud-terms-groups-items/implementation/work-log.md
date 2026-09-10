# Work Log

## 2026-09-09 - Implementation Started

**Total Steps**: 63 leaf steps across 6 groups
**Task Groups**: G1 (migration 0017 + models + read filters), G2 (backend groups: Term/NeededItem/Group PATCH+DELETE + matrix rows), G3 (backend circulation: InventoryItem PATCH+DELETE + matrix test), G4 (frontend api + term inline edit + circle rename), G5 (frontend NeededItem sub-CRUD + item edit/delete), G6 (test review)
**Mode**: SEQUENTIAL (orchestrator.options.sequential: true)
**No TDD gate** (has_reproducible_defect: false)

## Standards Reading Log

### Loaded Per Group

## 2026-09-09 - Group 1 (Migration 0017 + models + soft-delete read filters) — SUCCESS

**Steps**: 1.1–1.9 completed
**Standards Applied**: backend/models.md §169-170 (deleted_at per concrete model, explicit .where at every site), backend/migrations.md (0017_ name, one logical change, additive nullable, reversible, sa.TIMESTAMP()), backend/queries.md, error-handling.md (reused EntityNotFoundException), testing/backend-testing.md
**Tests**: `uv run pytest tests/test_public_term.py "tests/test_groups.py::test_getNeededItem_softDeleted_returns404" -q` → 10 passed, 0 failed. Migration round-trip 0016→0017→0016→0017 clean.
**Files Modified**: alembic/versions/0017_needed_item_inventory_item_soft_delete.py (new), groups/models.py (NeededItem.deleted_at), circulation/models.py (InventoryItem.deleted_at), groups/service.py (list_needed_items filter, get_needed_item 404, list_pledges parent guard), circulation/service.py (list_items filter, get_item 404), test_public_term.py (+2), test_groups.py (+1)
**Notes**:
- 1.7 finding: get_public_circle_view routes through list_needed_items (no private select) → inherits the central filter automatically. No explicit .where added there.
- list_pledges now 404s on an UNKNOWN needed_item_id too (was: empty list) — spec-intended consistency (decision 5 Option A).
- Migration verified against local PG (DATABASE_URL must be exported for alembic env.py); testcontainers conftest also runs `alembic upgrade head` fresh each session.

## 2026-09-09 - Group 2 (Backend groups: Term/NeededItem/Group PATCH+DELETE + matrix rows) — SUCCESS

**Steps**: 2.1–2.16 completed
**Standards Applied**: backend/security.md (matrix row first, coarse require_any + fine service check, identity from Principal), backend/api.md (/mine + /public before /{id}), backend/models.md, backend/queries.md (pledge cascade = one select, no N+1), global/error-handling.md + validation.md (typed exceptions, Polish 409 msg, Pydantic 400), global/commenting.md (single # TODO), global/minimal-implementation.md, testing/backend-testing.md
**Tests**: `cd src/backend && uv run pytest tests/test_groups.py -q` → 18 passed, 0 failed (10 pre-existing + 8 new). ruff clean; mypy 3 errors all pre-existing on main (fulfill_pledge, merge_anonymous_profile — untouched).
**Files Modified**: groups/schemas.py (UpdateTermRequest, UpdateNeededItemRequest max_length=500, UpdateGroupRequest + UpdateCircleRequest alias, local _reject_blank_name), groups/service.py (update_group, update_term, _require_needed_item_organizer, update_needed_item, _withdraw_pledge_row, soft_delete_needed_item), groups/router.py (3 routes), core/auth_deps.py (3 matrix rows), tests/test_groups.py (+3 helpers, +8 tests)
**Notes**:
- 409 FULFILLED-pledge test inserts Pledge(status=FULFILLED, resolved_reservation_id=123456) directly (loose cross-BC pointer, no FK) — exercises both guard conditions.
- _reject_blank_name replicated locally in groups/schemas.py (matches how families does it — module-local, not cross-BC import).
- matrix TEST not touched — G3 owns it (all 4 rows). G3 also adds inventory-items row + must verify /api/groups/mine + /public still resolve to their own rows.

## 2026-09-09 - Group 3 (Backend circulation: InventoryItem PATCH+DELETE + matrix test) — SUCCESS

**Steps**: 3.1–3.11 completed
**Standards Applied**: backend/security.md (matrix row first, coarse require_any + fine _require_item_owner in service, identity via get_user_id_by_principal = raw users.id, never party_id), backend/api.md (PATCH all-optional body, 204 DELETE), global/error-handling.md (AccessDeniedException 403, BusinessConflictException 409 Polish), global/minimal-implementation.md, testing/backend-testing.md
**Tests**: `cd src/backend && uv run pytest tests/test_circulation.py tests/test_authorization_matrix.py -q` → 14 passed, 0 failed (6 circulation + 8 matrix)
**Files Modified**: circulation/schemas.py (UpdateInventoryItemRequest), circulation/service.py (_require_item_owner, update_item, soft_delete_item), circulation/router.py (PATCH + DELETE routes), core/auth_deps.py (1 matrix row, G2's 3 preserved), tests/test_circulation.py (NEW, 6), tests/test_authorization_matrix.py (NEW, 8 — no prior matrix test file existed)
**Notes**:
- Balance-status enum: BalanceStatus (circulation/models.py); AVAILABLE=BalanceStatus.AVAILABLE; members AVAILABLE/RESERVED/IN_TRANSIT/LENT/RETURNED.
- Matrix test file NEWLY created at src/backend/tests/test_authorization_matrix.py (G2 deferred without a stub) — pure-function test, covers all 4 new rows + asserts /api/groups/mine + /public still resolve to their own rows.
- _require_item_owner shared helper (DRY, mirrors _require_party_to_reservation).

## 2026-09-09 - Group 4 (Frontend api + term inline edit + circle rename) — PARTIAL then resumed

**First pass** (rate-limited): completed the API layer only — api/terms.ts (updateTerm, UpdateTermRequest, updateNeededItem, deleteNeededItem, UpdateNeededItemRequest), api/groups.ts (updateCircle), api/inventories.ts (updateInventoryItem, deleteInventoryItem). These were committed by the user in 48c3905 "add crud term think" (which ALSO swept in the prior task's uncommitted HintCard/organizer-menu tweaks to PanelPage.tsx + PanelPage.test.tsx — unrelated to this task).
**Resumed pass — SUCCESS**: PanelPage.tsx term per-field inline editors + circle rename + removed the "przycisk celowo pominięty" comment sentence + 5 tests.
**Standards Applied**: frontend/components.md (reuse PencilIcon, inline editors not modals, local state trios like renamingFamily), frontend/accessibility.md (aria-label on every pencil, Enter=save/Escape=cancel, type=date input), testing/frontend-testing.md, global/error-handling.md (Polish inline msg, restore original), global/minimal-implementation.md ({[field]: next} sends only the changed field)
**Tests**: `cd src/frontend && npx vitest run src/test/PanelPage.test.tsx` → 44 passed (39 pre-existing + 5 new), 0 failed. tsc + eslint clean.
**Files Modified**: PanelPage.tsx (editingTermField/termFieldDraft/termFieldError + circle rename state/handlers + termEditControls helper), PanelPage.test.tsx (+updateCircle/updateTerm mocks, +5 tests)
**Notes**:
- Term edit affordances in 2 spots (home "Najbliższe terminy" and organizer "Terminy" list) — the 3rd term-render site is the GUEST Spotkania view, deliberately untouched (guests don't own terms; backend requires EDIT+ownership).
- Circle rename in the "Spotkania" → "Grupy" section per myGroups row (replaces the h3 name).
- termEditControls: two pencils (Data/Opis) idle → single input + Zapisz/Anuluj when active.

## 2026-09-09 - Group 5 (Frontend NeededItem sub-CRUD + InventoryItem edit/delete) — SUCCESS

**Steps**: 5.1–5.11 completed (5.8 skipped — api wrappers already done)
**Standards Applied**: testing/frontend-testing.md, frontend/accessibility.md (aria-label on every icon button, Enter/Escape), frontend/components.md (reuse PencilIcon/TrashIcon/Field + G4's state-trio pattern), global/error-handling.md (Polish inline msg, optimistic reconcile on failure), global/minimal-implementation.md (no ConfirmDialog/undo/restore endpoint)
**Tests**: `npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx` → 74 passed (PanelPage 50, PublicKragGrupyPage 24 unchanged). tsc + eslint clean.
**Files Modified**: PanelPage.tsx (needed-item + inventory-item state/handlers/neededItemsEditor helper + inventory row condition editor & trash), PanelPage.test.tsx (+mock entries, +6 tests)
**Notes**:
- Needed-item controls: neededItemsEditor(term.id, neededItems) sub-panel under termEditControls in home "Najbliższe terminy" + organizer "Terminy"/"Spotkania". Each item = li with pencil (category select + description) + trash; "+ Potrzebna rzecz" toggle opens inline add row. Guest views untouched.
- Inventory controls: pencil on "Stan:" swaps in a select + Zapisz/Anuluj; trash at row trailing edge, in view==="rzeczy".
- Optimistic-restore: capture index + row from current state BEFORE setTerms/setItems (React updater is async — first run failed because deleteNeededItem was never reached from inside the updater); on catch splice(index, 0, row) guarded by a some(id) check to avoid double-insert if a concurrent load() re-added it. No status-code inspection — any rejection → same restore + message (per scope-clarifications).

## 2026-09-09 - Group 6 (Test Review & Gap Analysis) — SUCCESS

**Steps**: 6.1–6.6 completed
**Standards Applied**: testing/backend-testing.md, testing/frontend-testing.md, global/error-handling.md + validation.md
**Added**: 9 strategic tests (8 backend + 1 frontend):
- test_groups.py: deleteNeededItem_nonOrganizer_returns403, deleteNeededItem_secondDelete_returns404, getNeededItemPledges_parentSoftDeleted_returns404, patchTerm_emptyBody_returns200Noop, patchGroup_unknownId_returns404
- test_circulation.py: patchInventoryItem_unknownId_returns404, deleteInventoryItem_nonOwner_returns403, createReservation_softDeletedItem_returns404
- PanelPage.test.tsx: needed-item edit rejection → inline error, original kept
**Tests**:
- Backend feature suite: `uv run pytest tests/test_groups.py tests/test_circulation.py tests/test_public_term.py tests/test_my_attendances.py tests/test_authorization_matrix.py -q` → 55 passed, 0 failed (test_groups 24, circulation 9, public_term 9, my_attendances 6, matrix 8)
- Frontend feature suite: `npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx` → 75 passed (PanelPage 51, PublicKragGrupy 24)
**Confirmed guarantees**: public krąg view = no edit/delete + no child-identifying data ✓; terms have no deleted_at → test_my_attendances unaffected ✓; FULFILLED-pledge 409 ✓; balance!=AVAILABLE 409 ✓.
**Note**: plan's "28-38 test" estimate was stale — G3 landed a full 8-row matrix file; final feature count ~45. All green, no regressions.

## 2026-09-09 - Implementation Complete

**Groups**: G1–G6 all SUCCESS. All plan checkboxes marked.
**Green**: backend feature suite 55/55, frontend feature suite 75/75.

## 2026-09-09 - Phase 11 verification + fix

**Verification**: completeness check PASSED (63/63, standards compliant, docs complete). Code review: 0 critical, 3 warning (W1 balance-leak, W2 double-delete guard, W3 prior-task residue), 5 info. → verification/implementation-verification.md + code-review-report.md.
**User feedback fix (only item selected)**: organizer term tile restructured — replaced `termEditControls` strip + `neededItemsEditor` bordered panel with one compact `organizerTermCard`: inline pencil beside the date + beside the description, borderless compact needed-items list within the tile body, "+ Potrzebna rzecz" text button. Circle name is the only nav Link (not the whole card). Guest/public views untouched. Removed `termEditControls` + `neededItemsEditor` functions.
**Tests**: `npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx` → 75 passed (no test edits needed — aria-labels stable). Full FE suite: 178 passed / 2 pre-existing baseline failures. tsc + eslint clean.
**Deferred (user chose not to fix)**: W1 (minor status-only balance leak), W2 (double-click delete guard), item-name editing (Product re-resolve). Documented as known issues in verification-context + verification report.

**User feedback fix 2**: "Kopiuj link" moved into the term tile as a `CopyIcon` (was an external text button beside the tile, Terminy view only). Now appears in the `organizerTermCard` header in BOTH views (home Najbliższe terminy + Terminy). External button + its flex wrapper removed. aria-label unchanged so tests pass as-is.
**Tests**: PanelPage.test.tsx 51 + PublicKragGrupy 24 pass; full FE 178 pass / 2 pre-existing. tsc + eslint clean.

**User feedback fix 3 (reversal — dialog instead of inline)**: user reviewed the inline term editors and asked for a dialog. NEW `src/frontend/src/components/panel/EditTermDialog.tsx` (mirrors CreateFamilyDialog): "Edytuj termin" ModalSheet with Data + Opis (single Zapisz, sends only changed fields) + "Potrzebne rzeczy" section (inline edit/delete/add, await-then-refresh, 409 keeps the row). `organizerTermCard` slimmed to a read-only compact tile: date chip + circle Link + plain occurs_on/description text + read-only needed-item chips + trailing CopyIcon + new "Edytuj termin" pencil → opens the dialog. Removed all the inline term-field + needed-item sub-CRUD state & handlers from PanelPage (startEditTermField/saveEditTermField/handleAddNeededItem/saveEditNeededItem/handleDeleteNeededItem + their state). "Moje rzeczy" item delete/condition path untouched.
**Gotcha fixed**: circular import — EditTermDialog read PanelPage's exported NEEDED_ITEM_LABELS at module top-level; kept the label map local to the dialog instead.
**Tests**: `npx vitest run src/test/PanelPage.test.tsx src/test/PublicKragGrupyPage.test.tsx` → 75 passed (PanelPage 51, term-edit describe blocks rewritten to drive the dialog). Full FE suite 178 pass / 2 pre-existing baseline. tsc + eslint clean.

**User feedback fix 4**: EditTermDialog "Potrzebne rzeczy" edit/add rows → vertical stack (category select full-width, description input on its own line full-width + bigger padding, Zapisz/Anuluj below). PanelPage.test.tsx 51/51.

**User feedback fix 5 (scope addition — item name+category edit)**: user asked twice why item name can't change; chose "name + category" via Product re-resolve.
- Backend: `UpdateInventoryItemRequest` gains `product_id: int | None`; `update_item` validates a changed product_id via `product_service.get_product` (404 if missing) — allowed regardless of balance status. +2 tests (test_patchInventoryItem_owner_changesProduct, _unknownProductId_returns404).
- Frontend: "Moje rzeczy" item row gets a pencil → inline name `<input>` + category `<select>` (PRODUCT_CATEGORIES / CATEGORY_LABELS from utils/productCategory.ts, same source as ItemQuickAddForm). Save → resolveProduct({name, category}) (get-or-create) → updateInventoryItem(id, {product_id}) → load({silent}). Early-return if both unchanged; empty name → "Podaj nazwę rzeczy", no request; error → editor stays open + inline msg. `editingItemMeta`/`itemMetaError` state; condition editor + handleDeleteItem untouched. +2 tests.
- **Tests**: backend `uv run pytest tests/test_circulation.py -q` → 11 passed; full backend `uv run pytest -q` → 108 passed / 0 failed. frontend PanelPage 53 + PublicKragGrupy 24; full FE 180 pass / 2 pre-existing baseline. tsc + eslint clean.
**Full-suite regression**: backend `uv run pytest -q` → 106 passed / 0 failed. frontend `npx vitest run` → 178 passed / 2 failed (180). The 2 FE failures (auth.test.tsx AuthContext hook, extension-points.test.tsx plugin iframes) are PRE-EXISTING on baseline (verified in the prior task by stash-and-rerun) — unrelated admin/plugin areas, not this feature.
**Tests added this task**: ~45 feature tests (backend: test_groups +18, test_circulation +9 new file, test_authorization_matrix +8 new file, test_public_term +2, test_groups soft-delete +1; frontend: PanelPage +16). Migration 0017 round-trips clean.
