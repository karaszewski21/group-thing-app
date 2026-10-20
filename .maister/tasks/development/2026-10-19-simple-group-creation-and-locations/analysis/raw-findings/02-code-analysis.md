# Raw findings: Code Analysis (Explore agent)

Backend: `src/backend/app` (FastAPI, async SQLAlchemy 2.0); migrations `src/backend/alembic/versions`; tests `src/backend/tests` via testcontainers + `alembic upgrade head`. Frontend: `src/frontend/src` (React 19, Vite 8, TanStack Query v5, Tailwind v4; Chakra UI v3 only on admin pages).

## Things that contradict the brief / standards

1. **PKs are UUIDs now, not explicit sequences.** Migration `0041_baseentity_id_uuid.py` switched every `BaseEntity` table to `postgresql.UUID(as_uuid=True)` with `uuid.uuid4` default and `server_default gen_random_uuid()` (`app/core/base_model.py:41-66`). `standards/backend/models.md:79-111` and `migrations.md` are out of date. Copy `0054_organization_media.py`. `0037` shows old sequence helpers; do not copy.
2. **Latest Alembic revision is "0056"**; next is `0057_...`.
3. **No relationships in `app/groups/models.py`.** No `relationship()`, no `lazy="raise"` on Group/Term. Plain FK-id columns; reads use explicit `select(A, B).join(...)`. `public_view.py:99-102` says this is the intended "eager form". `lazy="raise"` + selectinload only in `app/circulation`. Nested responses are built by hand.
4. **Term creation copies nothing from the group today.** `occurs_on` stored as sent (`application/terms.py:32-44`).
5. **Guest stepper sends no visibility.** `createMyCircle({name})` → `POST /api/groups/mine` → `service.create_own_circle(db, party_id, body.name)`; visibility ignored (`router/circles.py:74-86`, `application/circles.py:65-90`). Always server default PUBLIC (`models.py:121-125`). `POST /api/groups/mine` is idempotent: returns existing led circle if any, so a repeat user running the stepper does not get a new group.
6. **`organizer_slug` is never null in practice** (`derive_organizer_slug` falls back to `k-<hash>`). `?? "krag"` is only a guard. Route `/:organizationSlug/grupa/:groupId/term/:termId` (`router.tsx:155`) accepts `krag` as a segment.
7. **No `VITE_*` env plumbing** in frontend.
8. **Notifications have no structured term data.** `Notification` = `message` (String 500) + `link_path`. Term details only as `clock.format_term_when` / `_term_suffix` text (`application/term_item_listings.py:532-551, 745`, `notifications/outbox_listener.py:80-87`).
9. **"my groups" and "groups I attend" are mutually exclusive** (`PanelDataContext.tsx:455-470`): any active leadership → `guestCircles = []`. Blocks scope item 6.
10. **`SpotkaniaView.tsx:127-156` builds literal `TermResponse`/`GroupResponse` objects** from `MyAttendanceResponse`. New TS fields must be `| null` / optional and added there, or `tsc` breaks.

## Backend structure

`app/groups` layout: `models.py` (entities; `_enum_column` helper String-backed `native_enum=False`), `schemas.py`, `service.py` (flat re-export facade over `application/*`; routers import `from app.groups import service`), `application/<usecase>.py` (ownership checks raise `AccessDeniedException`; commit+refresh), `infrastructure/repository.py` (reads, never commits), `infrastructure/*_acl.py` / `*_bridge.py` (only files allowed to import another BC, e.g. `organizations_acl.py`), `domain/` (pure rules), `router/` package (one file per resource, assembled in `router/__init__.py`; order matters).

Smaller modules (`app/organizations`, `app/families`) are flat: `models.py`, `schemas.py`, `service.py`, `router.py`, sometimes `repository.py`. Registered in `app/main.py:146-159` before `system_router` (must stay last).

Auth in routers (`router/terms.py:27-32`, `router/circles.py:52-58`):
```python
DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
profile = await get_profile_by_principal(db, principal)   # app.users.service:97 -> profile.party_id
```

`AUTHORIZATION_MATRIX` (`app/core/authorization_matrix.py`): reference table tested in `tests/test_authorization_matrix.py`; enforcement is per-route `require_any`. Groups rows 81-135. `/api/locations` would fall to AUTHENTICATED catch-all → add rows (copy organizations `:195-201` or inventory-items `:178-180`), before the catch-all:
```python
(_methods("PATCH", "DELETE"), r"^/api/locations/[^/]+$", ("EDIT", "mcp:edit")),
(_methods("GET"), r"^/api/locations(/.*)?$", ("READ", "mcp:read")),
(_methods("POST"), r"^/api/locations(/.*)?$", ("EDIT", "mcp:edit")),
```

Migration conventions: `NNNN_short_description.py`, `revision="0057"`, `down_revision="0056"`, docstring header; names `{pk,fk,uq,ix}_{table}_{cols}`; FKs via `op.create_foreign_key` (`0056`); partial unique indexes only in migration via `op.create_index(..., unique=True, postgresql_where=sa.text(...))` (`0037:77-83`); schema/data separate; working `downgrade`.

## Soft delete pattern

`Group.deleted_at`/`deleted_by_party_id` (`models.py:126-131`). `repository.get_group` returns None when deleted (`:69-75`); `get_group_including_deleted` for restore. Lists filter `Group.deleted_at.is_(None)` (`:62-66`). Term reads join Group and filter (`get_term` `:285-294`, `count_terms`, `list_terms_for_moderation`). `get_term_any` (`:297`) is the keep-live escape hatch. `NeededItem.deleted_at` same shape, check in application layer (`terms.py:170-180`). Set via `datetime.utcnow()` (`circles.py:193`). For Location: filter `deleted_at IS NULL` only in `GET /mine`; when rendering Term/Group location load by id without filter.

## Counts / RSVP

`repository.count_active_attendances_by_term(db, term_ids)` (`:475-492`) → `{term_id: (count, child_sum)}` over `withdrawn_at IS NULL`. `list_terms_with_counts` (`terms.py:67-83`) fills counts only for active organizer. Router writes them onto `TermResponse` after `model_validate` (`router/terms.py:57-64`). GET /api/terms/{id}, POST, PATCH return no counts. Public view has **no `attendee_count`**; returns `guardians` (all attendances incl. withdrawn — `list_attendances_for_term` keeps them) (`public_view.py:300-312`). "Brak wolnych miejsc" needs new count field on `PublicTermResponse` or `guardians.length` (beware withdrawn rows).

## How responses are built

`GroupResponse`/`TermResponse`: `ConfigDict(from_attributes=True)` + `Model.model_validate(orm)`, router patches derived fields (`router/circles.py:69-71,84-86,104-106,205-206,282-284,303-305`). `ModerationTermResponse`, `PublicCircleResponse`, `PublicTermResponse`, `My*` built field by field (`terms.py:95-109`, `public_view.py:232-324`). Nested example: `organization: PublicCircleOrganization | None` via `organizations_acl.public_organization(org)` (`organizations_acl.py:39-47`) — a mapper turning cross-BC ORM object into allowlisted schema. `LocationResponse` should follow: mapper + batched lookup by id.

## Exact current schema fields (`app/groups/schemas.py`)

- **GroupResponse** (31-41, from_attributes): id, party_id, name, organizer_slug: str|None=None, layout_mode: GroupLayoutMode, visibility: GroupVisibility, created_at, updated_at.
- **CreateOwnCircleRequest** (88-90): name (1..255), visibility: GroupVisibility|None=None. `/mine/new` honours visibility; `/mine` ignores it.
- **UpdateGroupRequest** (72-81): name required (stripped, non-blank), layout_mode|None, visibility|None. Partial-apply only non-None (`circles.py:220-247`).
- **CreateCircleRequest** (68-69): name.
- **TermResponse** (148-158, from_attributes): id, circle_group_id, occurs_on: datetime, description: str|None, created_at, updated_at, attendee_count: int|None=None, child_count: int|None=None.
- **CreateTermRequest** (161-164): circle_group_id, occurs_on, description: str|None (max 2000).
- **UpdateTermRequest** (167-169): occurs_on|None, description|None (max 2000). Applied only if not None (`terms.py:122-125`).
- **ModerationTermResponse** (134-145): id, circle_group_id, group_name, occurs_on, description, created_at, attendee_count: int, child_count: int.
- **PublicTermResponse** (284-289): id, occurs_on, description, needed_items, item_listings.
- **PublicCircleResponse** (308-323): id, name, organizer_display_name, organizer_slug, organization: PublicCircleOrganization|None, visibility, layout_mode, term: PublicTermResponse|None, guardians.
- **PublicCircleOrganization** (297-305): name, primary_color, accent_color, palette_preset.
- **GroupAccessResponse**: group: PublicCircleResponse, access: GroupAccessDetails (is_member, is_organizer, can_view_content, join_request, is_attending).
- **OrganizerTermResponse** (376-382): term_id, group_id, group_name, occurs_on, description, attendee_count. **OrganizerNextTermResponse**: id, occurs_on, attendee_count. Candidates for location display.
- **GroupVisibility** (`models.py:91-104`): PUBLIC | PRIVATE, server_default "PUBLIC". Set at creation only by `create_additional_circle` (`circles.py:93-122`).

## Backend term creation flow (today)

`POST /api/terms` → `router/terms.py:38` (EditPrincipal) → `service.create_term(db, principal, body)` (`terms.py:32`): 1. `get_profile_by_principal`; 2. `get_group` (404 if missing/soft-deleted); 3. `_require_active_organizer(group_id, party_id)` (Leadership → GroupRole → party; 403); 4. `check_text(TextField.TERM_DESCRIPTION, description)`; 5. `Term(circle_group_id, occurs_on, description)` add/commit/refresh; 6. router `TermResponse.model_validate(term)`. Inheritance belongs in step 5 (`get_group` already returns the Group). Validate supplied `location_id` belongs to caller.

## Frontend structure

`src/api/*.ts` fetch wrappers + TS types; `src/hooks/use*.ts`; `components/panel/*` (steppers, EditTermDialog); `components/shared/*`; `components/krag/*` (ModalSheet, trapFocus); `pages/panel/*` (PanelPage, PanelDataContext, PanelModals, panelHelpers, panelComponents, `views/*`); `pages/krag/*`; `pages/AdminTermsPage.tsx`; tests `src/test/*.test.tsx`.

## Group creation in the guest stepper (today)

Entry points: HomeView hint "Dodaj swój pierwszy termin" (when `!isOrganizer`) → `setFirstTermForOrganizer(false)` + `setModal("pierwszy-termin")` (`HomeView.tsx:71-83`); hint "Możesz zostać organizatorem" → `setModal("zostan-organizatorem")` (`:85-94`); organizer zero-terms hint (`:107-119`); SpotkaniaView "+ Dodaj grupę" (organizers only) → `setModal("grupa")` (`:171-176`). Hamburger `AccountMenu.tsx` has no group-creation item.

Modal host (`PanelModals.tsx:63-104`): `"pierwszy-termin"` renders `FirstTermStepperOrganizer` if `firstTermForOrganizer && myGroups.length>0`, else `FirstTermStepperGuest`; `"zostan-organizatorem"` renders `<FirstTermStepperGuest withOrganizationStep={organizationSlug === null}>`.

`FirstTermStepperGuest`: state `step: "organization"|1|2|"done"`, organizationName, circleName, circle, occursOn, description, busy, formError, createdTermId. Org step → `createMyOrganization({name})`; Step 1 → `createMyCircle({name})` (no visibility), sets circle, `onCircleCreated()` = `load({silent:true})`; Step 2 → `createTerm({circle_group_id, occurs_on, description})`, `onCircleCreated()`, "done". Done screen (105-127) link + "Gotowe" → `onDone` (close, toast, `load()`). Uses panel `ModalSheet` and `Field` from `panelComponents.tsx`.

`FirstTermStepperOrganizer`: one step `createTerm` with `circleGroupId={myGroups[0].id}`. Onboarding wizard (`organizerSteps.tsx:70,103`) also uses `createMyCircle`/`createTerm` (out of scope, shares API).

## PanelDataContext

- `isOrganizer` (230); `profile.is_organizer` from `users/router.py:53` `is_active_organizer`.
- `load()` (332-488): profile → `getLeadershipsForPerson` → active leaderships → if any: `myGroups = getGroup(id)` each, `guestCircles = []`; else family memberships → `guestCircles`. Terms: `getTerms(group.id)` + `getNeededItems` per relevant group → `terms: TermWithNeeded[]` (`{term, group, neededItems}`, `panelHelpers.ts:47-51`). `myAttendances = getMyAttendances()`. `organizationSlug` from `getMyOrganization()` (null on 404).
- `groupExtras` (293) `Record<groupId, {location, freeSpots}>`: written `handleAddGroup` (604-609), `saveEditGroup` (970-984); read `startEditGroup` (935-940), `SpotkaniaView.tsx:183,223-229`; exported 1144.
- Forms: `groupForm {name, location, freeSpots, visibility:"PUBLIC"}` (305-310), `editGroupForm {name, location, freeSpots, layoutMode, visibility}` (202-208), term form (313-319). `handleAddGroup` → `createAdditionalMyCircle({name, visibility})`. `handleAddTerm` (647-684) resolves products → `createTerm` → `createNeededItem` per draft. `saveEditGroup` → `updateGroupLayoutMode(id, name, layoutMode, visibility)` (PATCH).
- Hint flags (270-281) in localStorage via `hintKey(flag, username)`.
- `relevantGroupsForForm = isOrganizer ? myGroups : guestCircles` (1091). `organizerTermCard` (851-930); guest tiles inline in HomeView (132-164) and SpotkaniaView (287-321).

## Term data flow on the frontend

- TS `TermResponse` (`api/terms.ts:4-16`), `CreateTermRequest`, `UpdateTermRequest`, `ModerationTermResponse`. `GroupResponse` (`api/groups.ts:18-27`), `CreateCircleRequest`.
- Term-add modal: `PanelModals.tsx:282-374`, state in PanelDataContext, `createTerm`.
- EditTermDialog: props `term`, `neededItems`, `group` from `editTermEntry` (`PanelModals.tsx:119-136`); local `useState`; `saveTermFields` (186-197) diff patch → `updateTerm` → `onChanged()` = `load({silent:true})`.
- AdminTermsPage: `useModerationTerms(page)` (key `["moderationTerms", page]`) → `getTermsForModeration`; Chakra Table/AdminTable.
- Public term page: `TermPage` → `useTermAccess(groupId, termId)` (key `["groupAccess", groupId, termId]`) → `getGroupAccess` (`GET /api/groups/public/{id}/access?term_id=`). `PublicTermView` renders `GroupHeader` (subtitle = description), `TermCard date`, `AttendeeList` (203-228). Location goes in/next to `TermCard`. Types `api/groups.ts:187-226`.
- Notifications: `useNotifications` → `NotificationBell` renders `n.message`, navigates `link_path`.

## Patterns LocationPicker and useLocations hooks must follow

- Query hook: copy `useModerationTerms`/`useMyOrganization`. Key `["myLocations"]`, consider including token (`useMyOrganization:45-49`). Return `{data, loading: isPending, error: string|null, refetch}` with module-level `NO_LOCATIONS`. `extractProblemMessage`.
- Mutations: copy `useUpdateOrganization` — call API, `await queryClient.invalidateQueries({queryKey: PREFIX})`, rethrow `new Error(serverMessageOr(err, "…"))`.
- API module `src/api/locations.ts`. Dates via `../utils/dayjs`.
- Modals: panel `ModalSheet` (`panelComponents.tsx`) has `useRegisterOpenSheet(true)` but no trapFocus/Esc. Accessible one: `components/krag/ModalSheet.tsx`. Nested "add/edit place" sheet should use krag `ModalSheet`; autocomplete Esc must `preventDefault`.
- Styling: Tailwind tokens, `inputClass = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"`, primary button `rounded-[13px] bg-mint ... text-white`, `<Field label>`. Errors `role="alert"` `text-danger`. Polish copy.
- Error text: `serverMessageOr(err, "Nie udało się … — spróbuj ponownie")`.
- Google key: new `vite-env.d.ts`, docker build-arg plumbing. Tests vitest+jsdom; manual mode must work with no key.

## Where Location should live: recommendation — new `app/locations` module

- Ownership is party-scoped, not circle-scoped: owner is `profile.party_id` (PERSON Party), reused across groups/terms. `Group.party_id` is a separate ORGANIZATION Party per circle (`circles.py:43-50`); owner of a Group is the Leadership. Location does not belong to the Group aggregate.
- Precedent for small party-owned BCs referenced by plain FK-id: `app/organizations` (via `infrastructure/organizations_acl.py`), `app/party`. Direct-FK owner precedent: `ItemListingPreference.owner_party_id` FK `parties.id` (`groups/models.py:290-294`).
- Groups/Terms reference as `default_location_id`/`location_id` UUID FK `locations.id` (`fk_groups_default_location_id_locations`, `fk_terms_location_id_locations`), no `relationship()`.
- Groups reads locations through new ACL `app/groups/infrastructure/locations_acl.py` mirroring `organizations_acl.py`: `get_owned_location(db, location_id, owner_party_id)`, batched `get_locations_by_ids(db, ids)` including soft-deleted, `location_response(loc)`.
- Response models: `LocationResponse` (owner view) in `app/locations/schemas.py`; public `PublicLocationResponse` (name, formatted_address, lat, lng, google_place_id, notes) in groups `schemas.py` like `PublicCircleOrganization`.
- Module layout: `models.py` (Location + `LocationSource` StrEnum via `_enum_column`), `schemas.py`, `service.py` (owner check → `AccessDeniedException`, soft delete `deleted_at = datetime.utcnow()`, `check_text` if new `TextField` added in `app/moderation/text_guard.py:18`), `router.py` registered in `main.py` before `system_router`. `/api/locations/mine` before `/{id}`.
- N+1: panel loads terms per group. Resolve locations in one batched `IN` query per list endpoint, set on response after `model_validate` like `organizer_slug`/`attendee_count`.

## Naming conventions

Backend tables plural snake (`locations`); FK `fk_<table>_<col>_<reftable>`, PK `pk_<table>`, unique `uq_`, index `ix_`. Schemas `Create…Request`, `Update…Request`, `…Response`, `Public…Response`. Use cases `create_*`, `update_*`, `soft_delete_*`, `list_my_*`. Routes `/mine`. Frontend api functions camelCase verbs (`getMyLocations`, `createLocation`, `updateLocation`, `deleteLocation`); hooks `useMyLocations`; components PascalCase (`components/shared/LocationPicker.tsx`); "krąg" = group/circle, UI says "grupa", Polish copy. Tests `src/test/<Component>.test.tsx`, backend `tests/test_<feature>.py` + matrix test.

## Tests likely affected

Backend: `test_groups.py`, `test_circles_router.py`, `test_public_term.py`, `test_groups_moderation.py`, `test_organizer_terms.py`, `test_organizer_page*.py`, `test_authorization_matrix.py`, `test_group_privacy.py`. Frontend: `FirstTermStepperOrganizer.test.tsx`, `PanelPage.test.tsx`, `EditTermDialog.test.tsx`, `AdminTermsPage.test.tsx`, `TermPage.test.tsx`, `OnboardingWizard.test.tsx`.
