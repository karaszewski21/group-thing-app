# Raw findings: Pattern Mining (Explore agent)

Backend `src\backend\`, frontend `src\frontend\src\`.

Two standards no longer match the code:
- **IDs are UUID now, not explicit sequences.** `models.md`/`migrations.md` say "explicit Postgres Sequence", but `app/core/base_model.py` (since `0041_baseentity_id_uuid.py`) uses `postgresql.UUID(as_uuid=True)` with `default=uuid.uuid4` and `server_default=gen_random_uuid()`. Follow 0054 for the new table.
- **Soft delete already exists.** `models.md` says no entity uses it, but `groups.deleted_at`, `needed_items.deleted_at`, `inventory_items.deleted_at` do. No global filter; every query adds `.where(X.deleted_at.is_(None))`.

## 1. Backend template for the Location module

Combine three: **`app/organizations/`** (cleanest standalone module, `/mine` shape, PATCH via `model_fields_set`, 403 ownership check); **`app/groups/`** group and needed-item soft delete; **`app/circulation/application/inventory_items.py`** (owner-scoped item with soft delete and `_require_item_owner`).

Files to create: `app/locations/{__init__,models,schemas,service,router}.py`. Register in `app/main.py` (imports 24–48, includes 147–160).

**Model** (style of `app/organizations/models.py` / `app/groups/models.py`):
```python
def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    return Enum(enum_cls, native_enum=False, length=length,
                values_callable=lambda cls: [member.value for member in cls])

class LocationSource(enum.StrEnum):
    GOOGLE = "GOOGLE"
    MANUAL = "MANUAL"

class Location(BaseEntity):
    __tablename__ = "locations"
    owner_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_locations_owner_party_id_parties"), nullable=False)
    source: Mapped[LocationSource] = mapped_column(_enum_column(LocationSource, 10), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
```
- Enum stored as VARCHAR (migration: `sa.String(10)`). `owner_party_id` naming already used by `ItemListingPreference.owner_party_id` (`groups/models.py:347`).
- `__eq__`/`__hash__` on business key only (e.g. `OrganizationMedia.__eq__` on `storage_key`, `organizations/models.py:174`). Location has no natural key → no `__eq__`.
- `lat`/`lng`: standard forbids `Float`; use `Numeric(9,6)`.

**Schemas** (`app/organizations/schemas.py`): Response `ConfigDict(from_attributes=True)`, `id: uuid.UUID`, `created_at`, `updated_at`. Create `Field(min_length=1, max_length=255)`. Update partial PATCH as `UpdateOrganizationRequest`: `ConfigDict(extra="forbid", str_strip_whitespace=True)`, all optional, `_not_null` validator for non-clearable fields, blank-clears validator for `notes` (`return value or None`); service applies:
```python
for field in data.model_fields_set:
    setattr(organization, field, getattr(data, field))
await db.commit(); await db.refresh(organization)
```
Public variant: `PublicOrganizationResponse`/`PublicCircleOrganization` (`groups/schemas.py:297`) narrower, no `party_id`.

**Router** (`app/organizations/router.py`):
```python
router = APIRouter(tags=["organizations"])
DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
@router.get("/api/organizations/mine", ...)
async def get_my_organization(db: DbSession, principal: ReadPrincipal, ...):
    profile = await get_profile_by_principal(db, principal)
@router.delete(".../{media_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
```
Literal `/mine` before `/{id}`. Owner from principal, never body.

**Ownership check (403 vs 404)**: look up first → 404 (`EntityNotFoundException("Organization", id)`), then 403 (`AccessDeniedException`) if not owner (`organizations/service.py` `update_organization`; same order in `inventory_items.py::_require_item_owner`). Soft-deleted row → 404 for PATCH/DELETE. Errors `app/core/errors.py`: `EntityNotFoundException`→404, `AccessDeniedException`→403, `BusinessConflictException`→409, `IntegrityError`→409.

**Soft delete** (`groups/infrastructure/repository.py:62-79`, `application/circles.py:173-201`):
```python
async def get_group(db, group_id):
    group = await db.get(Group, group_id)
    if group is None or group.deleted_at is not None: return None
    return group
async def get_group_including_deleted(db, group_id): return await db.get(Group, group_id)
select(Group).where(Group.deleted_at.is_(None)).order_by(Group.created_at.desc())
group.deleted_at = datetime.utcnow(); await db.commit()
logger.info("Group soft-deleted group_id=%s actor_party_id=%s ...", ...)
```
Nested read for group/term must use including-deleted lookup; only `/mine` filters.

**Migration** (template `0054_organization_media.py`; next **0057**, `down_revision="0056"`): UUID `id` `server_default=sa.text("gen_random_uuid()")`; `sa.PrimaryKeyConstraint("id", name="pk_locations")`; named FK; `created_at`/`updated_at` `sa.TIMESTAMP()` not null; `op.create_index("ix_locations_owner_party_id", ...)`; partial unique:
```python
op.create_index("uq_locations_owner_party_id_google_place_id", "locations",
    ["owner_party_id", "google_place_id"], unique=True,
    postgresql_where=sa.text("google_place_id IS NOT NULL"))   # consider "AND deleted_at IS NULL"
```
Downgrade drops indexes then table. Group/term FK columns in a separate migration (template `0056`: `op.add_column` + `op.create_foreign_key`). Race on unique index: SAVEPOINT pattern in `app/circulation/application/inventory.py:40-70` (`async with db.begin_nested(): ... except IntegrityError: re-fetch`).

**Authorization matrix**: rows before catch-all, modelled on organizations rows 48–50 and inventory-items rows; asserts in `tests/test_authorization_matrix.py` (43–60, 161–171).

**Text moderation**: Organization/Group/Term texts go through `await check_text(TextField.X, new, old)` (`app/moderation/text_guard.py`). No LOCATION_NAME/LOCATION_NOTES yet; tests in `tests/test_text_moderation_org_group_term.py`.

**Tests**: `conftest.py` `client`, `db_session`, `freeze_local_now`, `count_queries`. Helpers per file (`test_organizations.py`): `_register_organizer(client, email)`, `_auth_headers(token)`. Names camelCase `test_<operation>_<scenario>_<expected>` e.g. `test_updateOrganization_nonOwnerIsRejected`. Migration test template `tests/test_group_soft_delete_migration.py`. `backend-testing.md` still Java; ignore specifics.

## 2. Optional FK to another module and a nested response

No `relationship()`/`selectinload` across modules in `app/groups`; nested response = explicit join or ACL lookup, then Pydantic built by hand.

Column (from `Group.deleted_by_party_id`, `GroupJoinRequest.term_id`):
```python
default_location_id: Mapped[uuid.UUID | None] = mapped_column(
    postgresql.UUID(as_uuid=True),
    ForeignKey("locations.id", name="fk_groups_default_location_id_locations"), nullable=True)
```
ACL module: copy `organizations_acl.py` (`get_own_organization`, `public_organization(org) -> PublicCircleOrganization | None`). `product_bridge.py` is the write-side twin (validates FK id, clean 404).

Explicit join for reads: `repository.get_needed_item_with_product` / `list_needed_items_with_product_for_term` (`repository.py:~365-395`) `select(NeededItem, Product.name, ...).join(...)`. For optional FK `.outerjoin(Location, Location.id == Term.location_id)` without `deleted_at` filter. Batch lookups: `list_group_names(db, ids)` (`repository.py:82`), `first_approved_photo_by_product` return dicts keyed by id.

Response mapping: routers `GroupResponse.model_validate(group)` then patch (`router/circles.py:69-71`); or explicit `ModerationTermResponse(...)` (`application/terms.py:96-108`). `create_term`/`update_term` assign `if data.x is not None`; explicit clearing to null needs `model_fields_set`.

Places building Group/Term responses: `GroupResponse`, `TermResponse`, `ModerationTermResponse`, `PublicTermResponse`, `PublicCircleResponse` (schemas); `application/public_view.py`; `application/terms.py`; `application/organizer_page.py`; `router/terms.py`.

## 3. Frontend templates

**API module**: copy `api/organizations.ts` (snake_case types, `encodeURIComponent` ids) + `api/client.ts` (204 → `undefined`):
```ts
export function updateOrganization(id: string, request: UpdateOrganizationRequest): Promise<OrganizationResponse> {
  return api.patch(`/organizations/${encodeURIComponent(id)}`, request);
}
```
`api/categories.ts` simplest full CRUD but camelCase; Location uses snake_case.

**Error helpers** (`api/problem.ts`): `extractProblemMessage(err)`, `serverMessageOr(err, fallback)` (Polish fallback, server message for 400/409/503, fixed 403 text — prefer), `hasStatus(err, 404)`.

**Hook**: best template `hooks/useCategories.ts`, one query + mutations:
```ts
const CATEGORIES_KEY = ["categories"] as const;
const NO_CATEGORIES: Category[] = [];
export function useCategories(): UseCategoriesResult {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: CATEGORIES_KEY, queryFn: getCategories });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => { await queryRefetch(); }, [queryRefetch]);
  const invalidate = useCallback(() => queryClient.invalidateQueries({ queryKey: CATEGORIES_KEY }), [queryClient]);
  const remove = useCallback(async (id: string) => {
    try { await apiDeleteCategory(id); } catch (err) { throw new Error(extractProblemMessage(err)); }
    await invalidate();
  }, [invalidate]);
  return { data: query.data ?? NO_CATEGORIES, loading: query.isPending,
           error: query.error ? extractProblemMessage(query.error) : null, refetch, remove, move };
}
```
For user-owned data add token to key + `enabled: token !== null` as `hooks/useMyOrganization.ts` (`queryKey: [MY_ORGANIZATION_KEY, token]`, `loading: token !== null && query.isPending`). `useOrganizationMedia.ts`/`useUpdateOrganization.ts` show shared `mutate(call, fallback)` helper (invalidates on failure too, rethrows `serverMessageOr`). Hook tests: `test/useCategories.test.ts` with `vi.mock("../api/categories")` + `renderHook(..., { wrapper: createQueryWrapper() })`.

**List with inline edit/delete**: closest is "Potrzebne rzeczy" in `components/panel/EditTermDialog.tsx:181-280, 329-429` (`editing` state `{id, ...draft} | null`, `adding` flag, `newDraft`; `<ul>/<li>` rows with "Edytuj"/"Usuń" `aria-label`s; editing row swaps to inputs with Zapisz/Anuluj; errors inline `role="alert"`; nothing optimistic). Copy UI pattern but use a hook (its own fetching is an anti-pattern). `pages/organizer/editor/PhotosTab.tsx` is hook-based list with delete (`useMyOrganization` + `useOrganizationMedia`, `<section aria-labelledby aria-busy>`, moves focus after removal).

**Picker / select from saved list**: no combobox/autocomplete in codebase. Only `role="combobox"` is a `<select>` in `pages/ProductListPage.tsx:140`. Picker-like UIs: `<select>` + hook (`NeededItemQuickAddForm.tsx` with `useCategories()`), `role="radiogroup"` button grids in `pages/organizer/editor/ColorsTab.tsx:53`, `LayoutTab.tsx:27`. Radiogroup style suits "select a saved location"; autocomplete built new.

**Modal**: `components/krag/ModalSheet.tsx` meets a11y standard (`trapFocus`, Esc ignoring `defaultPrevented`, focus return, `useRegisterOpenSheet`). Building blocks `components/krag/trapFocus.ts`, `components/shared/openSheets.ts`. Hand-rolled alertdialog: `pages/panel/DeleteGroupDialog.tsx`. Panel forms use `pages/panel/panelComponents.tsx:167` `ModalSheet` (only registers open sheet). LocationPicker should be inline inside those sheets, not another sheet; if nested, use krag `ModalSheet` and `preventDefault` on Esc. `Field` at `panelComponents.tsx:158`.

**Where LocationPicker plugs in**: `PanelModals.tsx` 150–169, 212–231, term modal 282–373; `PanelDataContext.tsx` `groupExtras` 293, `handleAddGroup` 592–617, `startEditGroup`/`saveEditGroup` 934–990, `handleAddTerm` 647; `FirstTermStepperGuest.tsx`, `FirstTermStepperOrganizer.tsx`, `EditTermDialog.tsx`; types `api/groups.ts:18`, `api/terms.ts:4`.

## 4. Env flags, external scripts, dayjs

- No env-gated feature exists. Nothing reads `import.meta.env`. `tsconfig.app.json` `"types": ["vite/client"]`. No `vite-env.d.ts`, no `.env*` under frontend.
- Docker image cannot receive key: `src/frontend/Dockerfile` `npm run build` no `ARG`/`ENV`; `docker-compose.yml` frontend-build no build args. Both need `ARG VITE_GOOGLE_MAPS_API_KEY`.
- No external script loading exists (only `iframe.src` in `plugins/PluginFrame.tsx:55`). Loader should be lazy (user interaction) and skipped when key missing.
- dayjs: `import dayjs from "../utils/dayjs"` (examples `CreateFamilyDialog.tsx:5`, `AdminTermsPage.tsx`, `krag/components/TermCard.tsx`).

## 5. Anti-patterns (do not copy)

- Fetching with `useState`+`useEffect`: `EditTermDialog.tsx:139-153` (`getTermAttendeesForFormalization` though `useTermAttendees.ts` exists); `PanelDataContext.tsx` 1221-line imperative `load()` holding `groupExtras`; also `RsvpDialogLoggedIn.tsx`, `PendingActionsHost.tsx`, `CategoryFormPage.tsx`, `OnboardingPage.tsx`, `OrganizationPage.tsx`, `RzeczyView.tsx`, `ProductDetailPage.tsx`, `ProductFormPage.tsx`, `PluginDetailPage.tsx`, `PluginFormPage.tsx`, `OAuth2AuthorizePage.tsx`. LocationPicker should use `useMyLocations`.
- Panel `ModalSheet` in `panelComponents.tsx` lacks focus trap/Esc/focus return. Don't build new sheets on it.
- Direct `import "dayjs"`: none outside wrapper. `utils/format.ts` legacy.
- `datetime.now()`/`date.today()` in `app/groups`: none (guard test). `app/organizations/service.py` uses `date.today()` for `valid_from` (outside guard).
- Surrogate id in `__eq__`: none.
- Single-field updates: `update_group`/`update_term`/`UpdateGroupRequest` use "required name + `if x is not None`" — cannot clear a value; use `model_fields_set` for new location/capacity fields.
- Outdated docs: Sequence guidance in `models.md`/`migrations.md`, "no soft delete" note, Java `backend-testing.md`, `security.md` "no test suite" note.

## Convention checklist

1. Model extends `BaseEntity` (UUID id, `created_at`, `updated_at` optimistic lock). `__tablename__`, `Mapped[]`/`mapped_column`, `StrEnum` via `_enum_column`, named FKs `fk_{table}_{col}_{reftable}`, nullable `deleted_at: DateTime()`.
2. Cross-module references plain FK id columns, never `relationship()`. Reads via explicit joins or batched lookups through an ACL in `groups/infrastructure`.
3. Migration 0057+: UUID PK `gen_random_uuid()`, named pk/fk/ix/uq, partial unique via `postgresql_where`, reverse-order downgrade, separate schema/data migrations.
4. Router: full `/api/...` paths, `ReadPrincipal`/`EditPrincipal`, owner from `get_profile_by_principal(...).party_id`, `/mine` before `/{id}`, 201 on POST, 204 `response_model=None` on DELETE.
5. Matrix rows before catch-all + asserts in `test_authorization_matrix.py`.
6. Ownership: 404 missing/soft-deleted, 403 non-owner, 409 conflicts.
7. Moderation via `check_text` before assignment, if location texts moderated.
8. Backend tests: HTTP via `client`, camelCase names, non-owner 403 test, "deleted gone from /mine but still renders on term" test, migration test.
9. Frontend: `src/api/locations.ts`; `src/hooks/useMyLocations.ts` with key constant, stable empty array, `{data, loading, error, refetch}` + mutations invalidating prefix and rethrowing `serverMessageOr`.
10. Accessibility: labelled inputs, `role="alert"` errors, `aria-label`s on row buttons, radiogroup/listbox semantics; any sheet uses krag `ModalSheet` + `useRegisterOpenSheet`.
11. Dates via `utils/dayjs`. Google key via `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`, manual mode when missing. Add `vite-env.d.ts` and Dockerfile `ARG`.
