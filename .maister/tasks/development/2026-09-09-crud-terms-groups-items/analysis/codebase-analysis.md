# Codebase Analysis Report

**Date**: 2026-09-09
**Task**: Add CRUD (edit + soft-delete) to Term, Group (circle), and InventoryItem
**Description**: Add CRUD to Term, Group (circle), and InventoryItem ("rzeczy"). Currently only create + read exist; existing records cannot be modified. Scope: Term = PATCH (occurs_on, description) + soft DELETE; InventoryItem = PATCH + soft DELETE; Group = PATCH only (rename, no delete). Soft delete via a new nullable `deleted_at` column (no such column exists anywhere today) + Alembic migration. NeededItem editing as part of the term edit surface is an open scope question. Frontend edit/delete UI in PanelPage. Public krąg pages must never expose edit/delete. Ownership checks in the service layer.
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery + Pattern Mining)

---

## Summary

The three verticals (`app.groups` for Term + Group, `app.circulation` for InventoryItem) currently expose only create + read. Adding edit is low-risk and well-precedented: the freshly-completed `PATCH /api/families/{id}` rename (backend `rename_family` + frontend inline editor with `renaming*/*Draft/*Error` state) plus `update_organization` are direct, copyable templates. Adding soft-delete is net-new for the codebase — no `deleted_at` / `is_deleted` column exists anywhere (temporal soft-close today is `valid_to` on relationship rows only), so it requires a new nullable column on `Term` and `InventoryItem` (never on `BaseEntity`), an Alembic migration (0017, down_revision "0016"), and an explicit `.where(Model.deleted_at.is_(None))` filter at **every** read site because SQLAlchemy has no global query filter. The main design decisions are (a) how far to cascade a Term soft-delete to `NeededItem`/`Pledge`/`TermAttendance`, and (b) whether to block InventoryItem mutation when a non-AVAILABLE `InventoryBalance`/`Reservation` exists.

**Conflict reconciled**: The Context Discovery agent's claim "No ModalSheet/Field components exist" is **wrong**. `ModalSheet` and `Field` are exported from `src/frontend/src/pages/panel/PanelPage.tsx` and already imported by `FirstTermStepperGuest.tsx`, `FirstTermStepperOrganizer.tsx`, and `CreateFamilyDialog.tsx`. File Discovery + Code Analysis are authoritative here. For this task the relevant frontend precedent is the **inline editor** (family rename), not a modal.

---

## Files Identified

### Primary Files — Backend

**src/backend/app/groups/models.py** (~220 LOC)
- `Term` (L141-152): `circle_group_id` FK→groups, `occurs_on`, `description`. `Group` (L65-74): `party_id`, `name`. No `relationship()` anywhere (cross-BC FK-id only).
- Add `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)` to `Term` (and `NeededItem` if cascading). NOT to `Group` (PATCH-only, no delete).

**src/backend/app/groups/router.py** (~333 LOC)
- Term routes L238-257 (`create_term`, `list_terms`, `get_term`). Group routes L52-153. Public routes `get_public_circle` / `get_public_circle_view` L79-96.
- Add `PATCH /api/terms/{term_id}`, `DELETE /api/terms/{term_id}` (or soft-delete verb), `PATCH /api/groups/{group_id}`. Declare fine-grained/`/mine` routes before `/{id}`.

**src/backend/app/groups/service.py** (~880 LOC)
- `create_term` L385-396, `get_term` L399-403, `list_terms` L406-410. Ownership helper `_require_active_organizer` L288-291 (+ `_group_role_party_id`, `get_current_leadership`). `create_circle` L69-75, `create_own_circle` L90-115, `get_own_circle` L78-87, `get_group` L123-127, `list_groups` L118-120.
- Read sites needing `deleted_at IS NULL` filter: `list_terms` (406), `get_term` (399, consumed widely), `get_public_circle_view` (669, 697-706), `list_my_attendances` (622-643), `list_needed_items` (436), `get_needed_item` (429).
- Add `update_term`, `delete_term` (soft), `update_group`.

**src/backend/app/groups/schemas.py** (~227 LOC)
- `TermResponse` L81-89, `CreateTermRequest` L92-95, `GroupResponse` L16-24, `CreateCircleRequest` L27-28.
- Add `UpdateTermRequest` (`occurs_on: date | None = None`, `description: str | None = Field(default=None, max_length=2000)`), `UpdateCircleRequest` (`name: str | None` or required-with-validator like `UpdateFamilyRequest`).

**src/backend/app/circulation/models.py** (~271 LOC)
- `InventoryItem` L135-157: `inventory_id` FK, `product_id` FK, `condition` (`ItemCondition` enum), `added_at`. Dependents: `InventoryBalance.item_id` (1:1, created in `register_item`), `Reservation.item_id`.
- Add `deleted_at` column.

**src/backend/app/circulation/router.py** (~215 LOC)
- Routes L78-113 (`register_item`, `list_items`, `get_item`, `get_item_balance`). Add `PATCH` / `DELETE` `/api/inventory-items/{item_id}` using `EditPrincipal` + `acting_user_id` pattern (see `confirm_reservation` L156-162).

**src/backend/app/circulation/service.py** (~514 LOC)
- `register_item` L128-154 (owner check: `inventory.owner_user_id != owner_user_id` → `AccessDeniedException`), `get_item` L157-161, `list_items` L164-168, `get_user_id_by_principal` L66-75 (**this vertical uses raw `users.id`, not `party_id`**), `get_or_create_personal_inventory` L107-125.
- Add `update_item`, `soft_delete_item` with owner check via `get_inventory(item.inventory_id).owner_user_id == acting_user_id`.
- Read sites needing filter: `list_items` (164), `get_item` (157, consumed by reservation/swap flows).

**src/backend/app/circulation/schemas.py** (~140 LOC)
- `InventoryItemResponse` L53-62, `CreateInventoryItemRequest` L65-68. Add `UpdateInventoryItemRequest` (`condition: ItemCondition | None`; possibly `product_id`).

**src/backend/app/core/auth_deps.py** (~303 LOC)
- `AUTHORIZATION_MATRIX` `_RAW_MATRIX` L190-282, first-match-wins. Term rows 32/33 (L256-257), inventory-items rows 40/41 (L264-265), groups rows 26/27 (L243-244) are GET→READ / POST→EDIT only.
- Add `PATCH`/`DELETE` method rows for `^/api/terms/[^/]+$` → `("EDIT","mcp:edit")`, same for `^/api/inventory-items/[^/]+$`, and `PATCH` for `^/api/groups/[^/]+$` — placed **before** any catch-all. Precedent: standalone families PATCH row L251; `_methods("POST","PATCH")` for organizations L280.

### Primary Files — Frontend

**src/frontend/src/pages/panel/PanelPage.tsx** (~1740 LOC)
- Renders term tiles (home L863-895, "Terminy" organizer view L1130-1200, "Spotkania" L1204-1249), "rzeczy" (home L936-945, "Moje rzeczy" view L1251-1309). Add-term modal L1597-1670 (`handleAddTerm` L534-558), item add modal L1673-1685.
- **Explicit design-note comment L60-66**: buttons deliberately omitted because Term / warehouse item had no delete endpoint; Group delete is `endLeadership`. This task activates that note.
- Inline family-rename precedent: state `renamingFamily`/`familyNameDraft`/`renameError` (L261-263); `startRenameFamily` (L615), `cancelRenameFamily` (L622), `saveRenameFamily` (L627, early-returns if unchanged/blank, calls `renameFamily`, `await load({silent:true})`, catch → inline error). `PencilIcon` (L223), `TrashIcon` (L207) exist and are imported. `ModalSheet`/`Field` exported here.
- `load()` useCallback L373-468; `terms` state `TermWithNeeded[]`, `items` `InventoryItemResponse[]`.

**src/frontend/src/api/terms.ts** (~58 LOC) — add `UpdateTermRequest`, `updateTerm(id, req)` → `api.patch`, `deleteTerm(id)` → `api.delete`.
**src/frontend/src/api/groups.ts** (~209 LOC) — add `updateCircle(id, {name})` → `api.patch("/groups/{id}")`.
**src/frontend/src/api/inventories.ts** (~77 LOC) — add `updateInventoryItem`, `deleteInventoryItem`.
**src/frontend/src/api/client.ts** — `patch<T>` (L90-92) and `delete<T>` (L98-99) **already exist**; `request()` maps 204 → `undefined as T`. No client change needed.

### Related Files

- **src/backend/app/organizations/service.py** L118-136 (`update_organization`) + **router.py** L63-71 + **schemas.py** L43-51 (`UpdateOrganizationRequest`) — PATCH template.
- **src/backend/app/families/service.py** L155-179 (`rename_family`, guardian-check via join) + **router.py** L75-86 + **schemas.py** L43-49 (`UpdateFamilyRequest` with `_reject_blank_name`) — closest/freshest PATCH template.
- **src/backend/app/families/service.py** `make_primary_contact` L318-359, `end_group_role` (groups/service.py L158-187) — cascade-soft-close precedents.
- **src/backend/app/core/base_model.py** (~68 LOC) — `BaseEntity` (`id`, `created_at`, `updated_at` doubling as `version_id_col` L64-67). No soft-delete column; must be per-concrete-model.
- **src/backend/app/core/errors.py** — `AccessDeniedException`→403 "Access denied", `EntityNotFoundException`→404, `BusinessConflictException`→409, Pydantic/value-error→**400 (not 422)**. Global handlers in `app/main.py`; routes never catch.
- **src/backend/alembic/versions/0016_unique_user_profile_email.py** — current head (down_revision "0015"). New migration = `0017_*.py`, revision "0017", down_revision "0016".
- **src/backend/alembic/versions/0009_party_bc_split.py** (groups/terms/needed_items/pledges tables), **0004_circulation_schema.py** (inventory_items), **0012** (partial-index idiom `uq_organization_memberships_active_role`).
- **src/frontend/src/pages/krag/KragGrupyPage.tsx** — `PrivateKragGrupyView` (organizer detection `isOrganizerViewer`), `PublicKragGrupyView` (comment L581-582 already notes deleted term → 404). Public views must never render edit/delete.
- **src/frontend/src/hooks/useKragGrupy.ts**, **usePublicKragGrupy.ts** — consume public term; must not surface soft-deleted terms.
- **src/frontend/src/components/shared/ItemQuickAddForm.tsx** (~79 LOC) + **utils/itemQuickAdd.ts** — presentational item form, reusable as PATCH edit form.
- **src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx** / **FirstTermStepperGuest.tsx** — call `createTerm`, import `ModalSheet`/`Field` from PanelPage.
- **src/frontend/src/pages/OrganizationPage.tsx** L57-76 — page-level edit-form (`if(organization) updateOrganization else create`) precedent.
- **src/frontend/src/components/shared/ConfirmDialog.tsx** + **ProductListPage.tsx** L59-70 (`deleting` state) — delete-confirm UI precedent (note: Panel group removal uses plain button + toast, no confirm dialog).

---

## Current Functionality

Term, Group, and InventoryItem support **create + read only**. There is no way to modify an existing record and no delete path of any kind. The frontend reflects this deliberately (PanelPage L60-66 design note).

Soft-close in the codebase today applies **only to relationship rows** via `valid_to: date | None` (Leadership, Membership, GroupRole, FamilyMembership, OrganizationMembership). "Removing a circle" is already modelled as `end_leadership` — the group row stays, the leadership closes. There is **no `deleted_at` / `is_deleted` column anywhere**, and `models.md` L169-170 explicitly documents soft-delete as a not-yet-used pattern requiring a `deleted_at` column plus a manual `.where(...)` filter at every query site.

### Key Components / Functions

- **`_require_active_organizer(db, group_id, party_id)`** (groups/service.py L288-291) — the Term ownership gate: resolves current active Leadership for the group, compares its role's `party_id`; raises `AccessDeniedException` otherwise. Reused by `create_term`, `create_needed_item`. Use for Term PATCH + DELETE and Group PATCH.
- **`get_own_circle(db, organizer_party_id)`** (groups/service.py L78-87) — alternative Group ownership resolution mirroring `get_own_organization`.
- **`get_user_id_by_principal(db, principal)`** (circulation/service.py L66-75) — circulation identity as raw `users.id`. InventoryItem ownership = `get_inventory(item.inventory_id).owner_user_id == acting_user_id`.
- **`update_organization`** (organizations/service.py L118-136) — partial-update idiom: `get_*` (404) → ownership compare (403) → `if data.x is not None: obj.x = data.x` → `commit`, `refresh`, return. No manual `updated_at` bump (`version_id_generator` handles it).
- **`rename_family`** (families/service.py L155-179) — same shape with guardian-check join.
- **`end_group_role`** (groups/service.py L158-187) — cascade-close: loops active child rows setting `valid_to`. Model for cascading a Term soft-delete.

### Data Flow

**Term edit/delete (proposed)**: PanelPage inline editor → `updateTerm`/`deleteTerm` (api/terms.ts) → `PATCH`/`DELETE /api/terms/{id}` → matrix check (`EDIT`) → router resolves `profile = get_profile_by_principal(principal)` → `service.update_term(db, id, profile.party_id, body)` → `get_term` (404) → `_require_active_organizer(term.circle_group_id, party_id)` (403) → mutate / set `deleted_at = datetime.utcnow()` → `commit`/`refresh` → `TermResponse` (or 204) → frontend `await load({silent:true})`.

**InventoryItem edit/delete (proposed)**: PanelPage → api/inventories.ts → `PATCH`/`DELETE /api/inventory-items/{id}` → matrix (`EDIT`) → router `acting_user_id = get_user_id_by_principal(principal)` → `service.update_item` / `soft_delete_item` → `get_item` (404) → owner check via inventory (403) → optional 409 guard if `InventoryBalance` not AVAILABLE → mutate → commit → response.

**Read filtering**: every `list_*`/`get_*` for Term, NeededItem, InventoryItem — plus the joins in `get_public_circle_view`, `list_my_attendances`, `list_attendances_for_term`, `list_pledges` — must add `.where(X.deleted_at.is_(None))`. `get_*` should 404 on a soft-deleted row (or accept an `include_deleted` param). Frontend `load()` inherits filtering from the API automatically.

---

## Dependencies

### Imports (what the new code depends on)

- `get_profile_by_principal` (users/service.py L88-99) — principal → `UserProfile` via `account_user_id`.
- `_require_active_organizer` / `get_current_leadership` / `_group_role_party_id` (groups/service.py) — Term/Group ownership.
- `get_user_id_by_principal` / `get_inventory` (circulation/service.py) — InventoryItem ownership.
- `EditPrincipal = Annotated[Principal, Depends(require_any("EDIT","mcp:edit"))]`.
- `AccessDeniedException`, `EntityNotFoundException`, `BusinessConflictException` (core/errors.py).
- Alembic `op.add_column` / `op.create_index` (migration 0017).

### Consumers (what depends on the changed code)

**Term** — `get_term` is consumed by `create_needed_item` (L413), `create_pledge`→`get_needed_item` (L448), `fulfill_pledge` (L489-500), `create_rsvp` (L751), `get_public_circle_view` (L669/697-706), `list_my_attendances` (L622), router GET `/api/terms/{id}`. FK dependents: `NeededItem.term_id`, `TermAttendance.term_id` (both **no `ondelete`** — grep for `ondelete` across all migrations returns zero matches → default RESTRICT). Frontend: `api/terms.ts`, PanelPage, `useKragGrupy.ts`, `usePublicKragGrupy.ts`, `KragGrupyPage.tsx`, `FirstTermStepper*`, `organizerSteps.tsx`/`guestSteps.tsx`, `RsvpDialog*.tsx`.

**Group** — `get_group` consumed by `resolve_organizer_slug` (L564), `_resolve_organizer` (L585), `get_public_circle_view` (L669), cross-BC `families/service.py` `list_group_memberships_for_family`. FK dependents: `Leadership.to_group_id`, `Membership.to_group_id`, `Term.circle_group_id`. Frontend: `api/groups.ts`, PanelPage, `useKragGrupy.ts`, `KragGrupyPage.tsx`, `PublicKragRedirectPage.tsx`, `FirstTermStepper*`, `router.tsx`.

**InventoryItem** — `get_item` consumed by `create_reservation` (L252), `create_swap` (L302), `confirm/cancel/fulfill_reservation` (L435/454/477), `_current_holder_user_id` (L357), cross-BC `groups/service.py` `fulfill_pledge` (L489, calls `register_item` without `owner_user_id` — internal path, check skipped). FK dependents: `InventoryBalance.item_id` (1:1), `Reservation.item_id`. `Pledge.resolved_reservation_id` is a loose no-FK pointer. Frontend: `api/inventories.ts`, PanelPage, `ItemQuickAddForm.tsx`, `utils/itemQuickAdd.ts`.

**Consumer Count**: Term ~8 backend call sites + 8 frontend modules; Group ~6 + 8; InventoryItem ~7 + 4.
**Impact Scope**: **Medium** — many read call sites must each gain a filter (easy to miss one), but the mutation surface itself is small and additive. Pre-production, so no backward-compat burden.

---

## Test Coverage

### Existing Test Files

- **src/backend/tests/test_groups.py** — `create_my_circle` idempotency; `createTerm_happyPath_returns201WithTermFields`; `create_needed_item`; TermAttendance FK-violation; public circle view (`getPublicCircle_unknownId_returns404`, `getPublicCircle_responseSchema_hasNoChildIdentifyingField`). **No PATCH/DELETE/end tests.**
- **src/backend/tests/test_public_term.py** — `GET /api/groups/public/{id}?term_id=` variants (`termIdFromAnotherGroup_returns404`, `nonexistentTermId_returns404`, `noTermIdParam_returnsNearestTermUnchanged`, `neededItems_orderedById`). **Must be updated** so a soft-deleted Term is not picked as `next_term` and 404s when addressed by id.
- **src/backend/tests/test_my_attendances.py** — `GET /api/groups/mine/attendances`, joins through Term; needs a "soft-deleted term excluded" assertion.
- **src/backend/tests/test_families.py** — PATCH template tests: `test_patchFamily_guardian_renamesFamilyInPlace` (200 + same row), `test_patchFamily_nonGuardian_returns403`, `test_patchFamily_guardianOfDifferentFamily_returns403`, `test_patchFamily_unknownId_returns404` (id 999999), `test_createOwnFamily_blankName_returns422` (actually asserts **400**).
- **src/backend/tests/test_organizations.py** — `test_updateOrganization_ownerCanSetColors` (200), `test_updateOrganization_nonOwnerIsRejected` (403), partial-update keeps name.
- **src/backend/tests/test_product_resolution.py** — `POST /api/products/resolve` + `registerInventoryItem`.
- **No `test_circulation*` / `test_inventory*` file exists** — one must be created for InventoryItem PATCH/DELETE.
- **conftest.py** — session-scoped Postgres testcontainer + `alembic upgrade head`; function-scoped `db_session` outer-txn + SAVEPOINT rollback; `client` fixture overrides `get_db`; per-file `_register_organizer`/`_register_guest`/`_auth_headers` helpers.

**Frontend**: `src/frontend/src/test/PanelPage.test.tsx` (hamburger promotion, item add dialog, home hints, Rodzina section, **"Mój dom — inline family rename"** L909-954: in-place rename + network-error inline + restore, Spotkania list links, per-term public links & copy-link). `PublicKragGrupyPage.test.tsx` (public term render, anonymous/logged-in RSVP, term-less redirect, never renders child-identifying field). `OrganizationPage.test.tsx` (PATCH edit form). Vitest + jsdom, `vi.mock` factories, `vi.resetAllMocks()` in `beforeEach`, per-file `renderWithProviders` with `MemoryRouter`, files in `src/test/`.

### Coverage Assessment

- **Gaps**: zero coverage for any entity edit/delete; no circulation test file at all; `test_public_term.py` / `test_my_attendances.py` assume no term is ever removed.
- **Standard** (backend-testing.md L63/92): naming `test_<camelCaseAction>_<condition>_<expectedResult>`, 2-8 focused tests per feature — duplicate/constraint (409), non-existent (404), referential integrity (409), validation (400), ownership (403).

---

## Coding Patterns

### Naming Conventions

- **Backend services**: `update_<entity>`, `get_<entity>` (raises `EntityNotFoundException(EntityName, id)`), `get_own_<entity>` (returns `None`).
- **Schemas**: `Update<Entity>Request`, all fields `X | None = Field(default=None)` — applied `if data.x is not None` ("PATCH not replace").
- **Routes**: plural nouns, `PATCH`/`DELETE /api/<plural>/{id}`; fine-grained + `/mine` routes declared before `/{id}`.
- **Migrations**: `NNNN_<snake_desc>.py`, 4-digit sequential; constraint names `{pk,fk,uq,ix}_{table}_{cols}`.
- **Tests**: backend `test_<camelCaseAction>_<condition>_<expectedResult>`; frontend `describe()` named after the page.
- **Frontend inline editors**: `renaming<X>` / `<x>Draft` / `<x>Error` state triplet in the page component.

### Architecture Patterns

- **Authz**: service layer owns fine-grained checks (raises `AccessDeniedException`); routers resolve profile/identity and delegate; routers never catch domain exceptions (global handlers in `app/main.py` produce flat `{status,error,message}` envelope). Matrix row added **first** (first-match-wins eval order), then `Depends(require_any(...))` on the route.
- **Identity**: always from `Principal`, never request body. `app.groups` works in `party_id`; `app.circulation` works in raw `users.id`.
- **Commit boundary**: service does `await db.commit(); await db.refresh(row); return row`. Helpers inside a larger txn use `await db.flush()` and let the caller commit.
- **Models**: `BaseEntity` + `__tablename__` + `__sequence_name__`; cross-BC references are bare FK-id columns (no `relationship()` across modules); `lazy="raise"` + explicit `.options()`; enums via `_enum_column` (`native_enum=False`, string-backed). Ordering in SQL, never Python.
- **Soft-close (relationships)**: set `valid_to = date.today()`, never delete; active reads filter `.valid_to.is_(None)`.
- **Soft-delete (entities)**: no precedent — `models.md` L169-170 prescribes a `deleted_at` column + manual `.where(Model.deleted_at.is_(None))` at every query site.
- **Migrations**: `alembic revision --autogenerate` then hand-review; mandatory working `downgrade()`; one logical change per file; additive nullable columns; partial index idiom `postgresql_where=sa.text("deleted_at IS NULL")`; migrations must not import app code; explicit `CREATE SEQUENCE` only for new `BaseEntity` tables (not needed for a column add).
- **Frontend**: `api/*.ts` thin wrappers; page-level `load()` useCallback refetch, `load({silent:true})` after in-place mutations; inline editors (not modals) for simple renames.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~10 backend files + ~6 frontend files touched | Medium |
| Dependencies | Reuses existing ownership helpers + error types; 1 new migration | Low |
| Consumers | ~21 backend call sites + ~20 frontend modules read the affected entities | Medium-High |
| Test Coverage | Strong PATCH templates exist; soft-delete + circulation tests are net-new | Medium |

### Overall: Moderate

Edit endpoints are near-mechanical copies of `rename_family` / `update_organization`. The genuine complexity is concentrated in soft-delete: (1) a new cross-cutting column + migration with no in-repo precedent, (2) the requirement to add a filter at ~10+ read sites without missing one (no global filter in SQLAlchemy), (3) the Term→child cascade policy decision, and (4) the InventoryItem-with-active-reservation guard.

---

## Key Findings

### Strengths
- Freshest possible template: `PATCH /api/families/{id}` (backend + frontend inline editor) was completed in the immediately-prior task and is directly analogous.
- `api.patch` / `api.delete` already exist in `client.ts`; `request()` already handles 204.
- `TrashIcon` / `PencilIcon` / `ModalSheet` / `Field` all already exist in PanelPage.
- Clear standards coverage: `models.md` soft-delete section, `security.md` matrix-first rule, `migrations.md` workflow, `errors.py` status mapping.
- Pre-production: no backward-compat shims, URL/schema churn is acceptable.

### Concerns
- **No global soft-delete filter** — every current and future read of Term / NeededItem / InventoryItem must remember `.where(deleted_at.is_(None))`. Easy to regress. Centralize in `list_*` / `get_*` service functions.
- **FK RESTRICT on Term children** — `NeededItem.term_id` and `TermAttendance.term_id` have no `ondelete`, so a hard delete is impossible while children exist; soft-delete triggers no DB cascade, so the service must decide explicitly.
- **`FULFILLED` pledges carry `resolved_reservation_id`** pointing at a real circulation `Reservation`/`InventoryItem` that must not be disturbed by a Term soft-delete.
- **InventoryItem with non-AVAILABLE `InventoryBalance`** (RESERVED/LENT) — soft-deleting leaves a dangling 1:1 balance row and possibly an active `Reservation`. Needs a 409 `BusinessConflictException` guard (precedent: `create_reservation` status guards L261-265).
- Context Discovery agent produced at least one demonstrably false claim (ModalSheet/Field) — treat its other unverified assertions with caution.
- `test_public_term.py` and `test_my_attendances.py` currently assume terms are permanent; both need new assertions.

### Opportunities
- Cascade decision can be scoped minimally: filter `Term.deleted_at IS NULL` in all join reads so `NeededItem`/`TermAttendance`/`Pledge` rows become harmlessly invisible without needing their own `deleted_at` (except `NeededItem` if the edit surface must show/hide them independently).
- `ItemQuickAddForm.tsx` is already presentational and can back the InventoryItem edit form with no changes.
- This task activates the dormant `models.md` L169-170 soft-delete section — a good moment to promote the "central filter in `list_*`/`get_*`, 404 on soft-deleted" decision into that standard.

---

## Impact Assessment

- **Primary changes**:
  - Backend: `groups/{models,router,service,schemas}.py`, `circulation/{models,router,service,schemas}.py`, `core/auth_deps.py`, new `alembic/versions/0017_*.py`.
  - Frontend: `api/terms.ts`, `api/groups.ts`, `api/inventories.ts`, `pages/panel/PanelPage.tsx`.
- **Related changes**:
  - Backend read sites: `get_public_circle_view`, `list_my_attendances`, `list_attendances_for_term`, `list_pledges`, `list_needed_items`, `get_needed_item` — add `deleted_at` filter.
  - Frontend: verify `KragGrupyPage.tsx` / `usePublicKragGrupy.ts` never render edit/delete; confirm `PublicKragGrupyView` handles a now-missing term as 404 (comment already anticipates this).
- **Test updates**:
  - New: `test_groups.py` (Term PATCH/DELETE + ownership + soft-delete-excluded-from-reads), new `test_inventory_items.py` (InventoryItem PATCH/DELETE + owner check + reserved-item 409), Group PATCH tests.
  - Modify: `test_public_term.py`, `test_my_attendances.py` to assert soft-deleted terms are excluded.
  - Frontend: extend `PanelPage.test.tsx` with inline term-edit / term-delete / group-rename describe blocks mirroring the family-rename tests; confirm `PublicKragGrupyPage.test.tsx` still asserts no edit/delete controls.

### Risk Level: Low-Medium

Edit endpoints are low risk (mechanical, well-tested precedent, additive, pre-production). Soft-delete raises it to low-medium: a missed read-site filter would silently leak deleted records, and the Term→child cascade / reserved-item guard are genuine domain decisions rather than mechanical work. No irreversible data operations (soft-delete is recoverable); no auth model change beyond additive matrix rows.

---

## Recommendations

This is primarily **modifying existing code** (adding edit) plus **a new cross-cutting capability** (soft-delete).

### Backend — edit endpoints
1. Copy the `rename_family` shape for `update_group` and the `update_organization` shape for `update_term` / `update_item`. Order: add `AUTHORIZATION_MATRIX` row(s) first, then the route with `EditPrincipal`, then the service function with the ownership gate.
2. `update_term`: reuse `_require_active_organizer(db, term.circle_group_id, party_id)`. `update_group`: reuse the same helper with `group_id` directly (most consistent with `create_term`), or `get_own_circle` + `.id` compare.
3. `update_item`: `get_item` (404) → `get_inventory(item.inventory_id)` → `if inventory.owner_user_id != acting_user_id: raise AccessDeniedException`. `acting_user_id` from `get_user_id_by_principal`.
4. Schemas: `UpdateTermRequest(occurs_on: date | None = None, description: str | None = Field(default=None, max_length=2000))`; `UpdateInventoryItemRequest(condition: ItemCondition | None = None)`; `UpdateCircleRequest` — prefer required `name: str` + blank-rejecting `field_validator` (like `UpdateFamilyRequest`) since rename is the only Group operation. Apply each field `if data.x is not None`.
5. Let `version_id_generator` bump `updated_at` — do not set it manually.

### Backend — soft-delete
6. Add `deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)` to `Term` and `InventoryItem` only. Do **not** touch `BaseEntity`. Add to `NeededItem` **only if** the term-edit surface must hide individual needed items independently — otherwise rely on the Term-level filter in joins (recommended minimal scope).
7. Migration `0017_term_and_inventory_item_soft_delete.py`, revision `"0017"`, down_revision `"0016"`: `op.add_column("terms", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))`, same for `inventory_items`; `downgrade()` drops both. Use `sa.TIMESTAMP()` to match existing migration style. Add partial index `ix_terms_deleted_at` / `ix_inventory_items_deleted_at` with `postgresql_where=sa.text("deleted_at IS NULL")` only if list queries show a need. No new sequence. Do not import app code.
8. `delete_term` / `soft_delete_item`: ownership gate → `row.deleted_at = datetime.utcnow()` → `commit`. Return 204 (router) — `DELETE /api/terms/{id}`, `DELETE /api/inventory-items/{id}`.
9. **Add `.where(Model.deleted_at.is_(None))` centrally** in every `list_*` and every join-read: `list_terms`, `get_term`, `get_public_circle_view` (both branches), `list_my_attendances`, `list_attendances_for_term`, `list_needed_items`, `list_pledges`; `list_items`, `get_item`. Make `get_term` / `get_item` 404 for a soft-deleted row so downstream callers (`create_needed_item`, `create_reservation`, `create_rsvp`, `fulfill_pledge`) inherit the behaviour.
10. **Term cascade (decision needed — recommend minimal)**: do not cascade to `Pledge` (leave `FULFILLED` untouched; the loose `resolved_reservation_id` must never be disturbed). Optionally set `OPEN` pledges to `WITHDRAWN` (precedent `withdraw_pledge` L478-486). `TermAttendance` rows become harmlessly invisible via the join filter. State the chosen policy explicitly in the spec.
11. **InventoryItem guard**: before soft-delete/PATCH-of-`product_id`, check `InventoryBalance` status; if RESERVED/LENT (or an active `Reservation` exists) raise `BusinessConflictException` (409). Editing `condition` on an AVAILABLE item is unrestricted.

### Frontend
12. Use the **inline editor** pattern (not a modal) for Term and Group edit, mirroring family rename: `renamingTerm`/`termDraft`/`termError` (and `renamingGroup`/...) state in PanelPage; `start*`/`cancel*`/`save*` trio; `save*` early-returns on unchanged/blank, calls `updateTerm`/`updateCircle`, `await load({silent:true})`, catches → inline error. For the InventoryItem edit, reuse `ItemQuickAddForm.tsx`.
13. Add delete via `TrashIcon` button in the organizer "Terminy"/"Spotkania" views and "Moje rzeczy" view only. Consider `ConfirmDialog.tsx` for term/item delete (destructive, unlike group-leave). No delete control for Group.
14. Remove the now-obsolete design-note block at `PanelPage.tsx` L60-66.
15. `api/terms.ts`: add `UpdateTermRequest`, `updateTerm(id, req) → api.patch`, `deleteTerm(id) → api.delete`. `api/groups.ts`: `updateCircle(id, {name}) → api.patch("/groups/{id}")`. `api/inventories.ts`: `updateInventoryItem`, `deleteInventoryItem`. No `client.ts` change.
16. **Public pages**: audit `KragGrupyPage.tsx` (`PublicKragGrupyView`), `usePublicKragGrupy.ts` — confirm no edit/delete controls and that they consume only the soft-delete-filtered API. Confirm the term-deleted → 404 path (comment L581-582 already anticipates it).

### Tests
17. Backend: mirror `test_families.py` PATCH tests for Term and Group (`_guardian/organizer_...renamesInPlace`, `_nonOwner_returns403`, `_unknownId_returns404`, blank-name→400). New `test_inventory_items.py` for InventoryItem PATCH/DELETE + owner 403 + reserved-item 409. Soft-delete tests: `test_deleteTerm_organizer_excludesFromListAndPublicView`, `test_getTerm_softDeleted_returns404`.
18. Update `test_public_term.py` and `test_my_attendances.py` with soft-deleted-term-excluded assertions.
19. Frontend: extend `PanelPage.test.tsx` with inline term-edit, term-delete, and group-rename describe blocks following the family-rename tests; keep `PublicKragGrupyPage.test.tsx` asserting absence of edit/delete controls.

### Standards
20. After implementation, suggest promoting the "soft-delete: central filter in `list_*`/`get_*`, `get_*` returns 404 for soft-deleted" decision into `.maister/docs/standards/backend/models.md` (activating its L169-170 placeholder) via `/maister:standards-update`.

---

## Next Steps

Proceed to **gap analysis** to resolve the open scope questions before specification:
1. Does NeededItem get its own `deleted_at` / independent edit-delete within the term edit surface, or is Term-level filtering sufficient?
2. Term soft-delete cascade policy for `OPEN` pledges and `TermAttendance` (recommendation: minimal — no pledge cascade, join-filter attendances).
3. InventoryItem delete/edit behaviour when reserved or lent (recommendation: 409).
4. `DELETE` verb + 204 vs a `POST /api/terms/{id}/archive` style — recommendation: `DELETE` + 204 (no `/end` POST precedent for entities; `DELETE` matches `api.md` and existing `deleteProduct`).
5. Confirm single migration adding `deleted_at` to both tables is acceptable as "one logical change".
