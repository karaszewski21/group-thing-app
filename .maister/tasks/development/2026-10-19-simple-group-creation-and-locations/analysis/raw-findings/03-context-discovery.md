# Raw findings: Context Discovery — tests & integration (Explore agent)

Repo: backend `src/backend` (FastAPI, `app/`, `alembic/`, `tests/`), frontend `src/frontend` (React 19, Vite 8, TS, Vitest 3, react-router-dom 7, react-query 5, Tailwind 4, Chakra admin only). **No `.github/` directory, no CI workflows.** Test suites were NOT run; baseline failures cited come from earlier work logs.

## 1. Required integration points

**Backend registration**
- `app/main.py:147-160` `app.include_router(...)` list; new `locations_router` before `system_router` (line 160, SPA catch-all, must stay last). Imports 24-48.
- `app/groups/router/__init__.py:30-40` groups sub-router assembly (if Location lives inside groups BC).
- `app/core/authorization_matrix.py:37-249` (`_RAW_MATRIX`, first match wins). Group rows: `:81` mine/attendances READ; `:88-106` public PUBLIC rows; `:113-117` join-requests AUTHENTICATED; `:123` `PATCH,DELETE ^/api/groups/[^/]+$` EDIT; `:127-128` moderation/restore ADMIN; `:134` GET `^/api/groups(/.*)?$` READ; `:135` POST EDIT. Term rows `:163-166`. No `/api/locations` row → catch-all `:248`. Follow families/inventory-items precedent `:137-152`, `:177-182`.
- `tests/test_authorization_matrix.py:174-192` parametrized table; add locations rows.

**Backend groups/terms code to extend**
- `app/groups/models.py`: Group `:97-123`, Term `:221-239`. No `relationship()` (`:12`). Nested `LocationResponse` loaded explicitly and attached after `model_validate` like `attendee_count` at `router/terms.py:56-61`.
- `app/groups/schemas.py`: GroupResponse 31-41, UpdateGroupRequest 72-81, CreateOwnCircleRequest 88-90, ModerationTermResponse 134-145, TermResponse 148-158, CreateTermRequest 161-164, UpdateTermRequest 167-169, PublicTermResponse 284-289, PublicCircleResponse 308-323.
- `router/circles.py:74-86` POST /mine idempotent, ignores `body.visibility`; `:89-106` /mine/new `create_additional_circle(name, visibility)`; PATCH `:274-284`. Service `application/circles.py:65-121`, `update_group` ~222.
- `application/terms.py:32-44` `create_term` (copy group defaults here); `:86-110` `list_terms_for_moderation`; `:113-129` `update_term`. Router `router/terms.py:38-90`.
- `application/public_view.py:267` builds `PublicTermResponse`. Organizer page schemas `OrganizerTermResponse`/`OrganizerCircleResponse` (`:361-383`).
- Text moderation `app/moderation/text_guard.py:18-26` (`TextField` enum); pattern `check_text(TextField.X, value)` (`terms.py:36`).
- Slug: backend never returns `organizer_slug=None` for `/mine`; derives `k-<blake2s>` (`domain/organizer_slug.py:11-34`).

**Frontend**
- `api/client.ts`: `ApiError` 1-13; `request()` 19-58 (prefix `/api`, Bearer `localStorage.auth_token`, 401 → `/login?returnTo=`); `api.get/post/put/patch/delete/upload` 71-108.
- `api/problem.ts`: `extractProblemMessage` 40-57, `serverMessageOr` 67, `ACCESS_DENIED_MESSAGE` 59.
- `api/groups.ts`: `GroupResponse` 18-27, `CreateCircleRequest` 29-32, `createMyCircle` 107, `createAdditionalMyCircle` 115, `updateGroupLayoutMode(id, name, layout, visibility?)` 127-139 (only PATCH caller), `PublicTermResponse` 187-193, `PublicCircleResponse` 216-226. `api/terms.ts`: `TermResponse` 4-16, `ModerationTermResponse` 20-29, `CreateTermRequest` 31-35, `UpdateTermRequest` 70-73.
- `router.tsx`: `/panel` 97, `/panel/:view` 101, `/panel/terminy/:termId` 108, `/:organizationSlug/grupa/:groupId/term/:termId` 155, `/:organizationSlug/terminy` 163, `/:organizationSlug` 173. **No literal `/krag/` route** — "krag" is just a cosmetic slug segment. Link builders: `panelHelpers.ts:110`, `FirstTermStepperGuest.tsx:113`, `FirstTermStepperOrganizer.tsx:59`, `PublicTermView.tsx:191`, `SwapAcceptSuccessSheet.tsx:49`, `ItemTimeline.tsx:85`, `organizerHelpers.ts:5`.
- Hamburger `components/shared/AccountMenu.tsx:13-80` (Profil / Ustawienia / Moja organizacja / Mój dom + `extraItems`), used only by `components/layout/PublicLayout.tsx:36`. No group-creation item today ("Dodaj pierwszy termin" was commented out earlier).
- `FirstTermStepperGuest.tsx`: `withOrganizationStep` 29,46; org step 56-68; `createMyCircle({name})` 75; `createTerm` 91; title switch 102; dots 103.
- `PanelModals.tsx:63-104` modals; `withOrganizationStep={organizationSlug === null}` 95; toast 100. Add/edit group fields 151-166, 213-228. `ModalKind` `panelHelpers.ts:24-32`.
- `HomeView.tsx:70-118` four HintCards; "Możesz zostać organizatorem" 86-95. `SpotkaniaView.tsx:85,172-175,183,223-228`.
- `PanelDataContext.tsx`: `isOrganizer` 230; hint keys 270-281; `groupExtras` 293 (written 604-608, 968-985; read 935-940; exported 1144); forms 202-208, 305-310; `createAdditionalMyCircle` 600; `createTerm` 660.
- `EditTermDialog.tsx:61-72,122-128`; `AdminTermsPage.tsx:33-60`.

## 2. Test infrastructure and how to run

**Backend** (`tests/conftest.py`): session-scoped `PostgresContainer("postgres:18")` via testcontainers (Docker required); `alembic upgrade head` once via subprocess (`:51-68`). `db_session` (`:97-114`) outer transaction + SAVEPOINT rolled back. `client` (`:131-150`) httpx `AsyncClient`/`ASGITransport`, `get_db` + `get_storage` (`FakeStorage`) overridden. `freeze_local_now` (`:117-127`) opt-in. `count_queries(engine)` (`:81-94`). `MODERATION_TEXT_ENABLED=false` forced (`:43`). `asyncio_mode=auto`, session loop scope. No shared auth fixtures; each file has `_register(client, role, email)` → `POST /api/auth/register {"role": "GUEST"|"ORGANIZER"}` → token, `_auth(token)`; `_grant_admin_and_relogin` in `test_groups_moderation.py`.
Run: `cd src/backend && uv run python -m pytest` (plain `uv run pytest` fails — uv trampoline). `uv run python -m mypy app` (baseline ~32 errors), `uv run python -m ruff check`.

**Frontend**: `vitest.config.ts` jsdom, globals, setup `src/test/setup.ts`. Helpers `src/test/queryClient.tsx`, `src/test/page.ts`. Run: `cd src/frontend && npm test`, `npm run lint`, `npx tsc -b`. `npm run build` runs `tsc -b`; `tsconfig.app.json` includes `src` so **test fixtures are type-checked**. Known baseline failures (~11, from 2026-10-13/14 logs): PanelPage "hamburger promotion" ×6 (click menuitem "Dodaj pierwszy termin" that no longer exists); TermPage "Imię" ×1, auth ×1, extension-points ×2, foundation ×1; OrganizerEditor focus ×2 flaky.

## 3. Test inventory with "will break because…"

**Backend files touching groups/terms** (all register users and POST `/api/groups/mine` → `/api/terms`): test_account_merge, test_add_active_membership, test_attendance_withdrawal, test_authorization_matrix, test_circles_router, test_circulation, test_circulation_ledger, test_domain_clock_guard, test_exchange_summary, test_families_bootstrap, test_group_access, test_group_join_requests_decisions, test_group_join_requests_router, test_group_layout_mode, test_group_privacy, test_group_soft_delete(+_keep_live, _reads, _service, _migration), test_groups, test_groups_moderation, test_handover_copy_api, test_lend_step0_fixes, test_my_attendances, test_notifications, test_organizations, test_organizer_page, test_organizer_page_queries, test_organizer_bridges, test_organizer_terms, test_pagination, test_pledge_fulfillment, test_private_group_access_defects, test_product_category_fk_rename, test_promotion, test_public_preview, test_public_term, test_rsvp, test_term_attendees, test_term_clock_regressions, test_term_end_scan, test_term_item_listings, test_term_item_listings_router, test_text_moderation_org_group_term.

Specific break risks:
- **`test_public_term.py:180-198`, `:243-249`**: exact `set(body.keys())` on `PublicCircleResponse` and `body["term"].keys() == {id, occurs_on, description, needed_items, item_listings}`. Adding `location`/`capacity` breaks both.
- `test_groups.py:570`: `PublicCircleResponse.model_fields` has no field containing "child".
- `test_my_attendances.py:114`: exact key set of `MyAttendanceResponse`.
- **Default visibility**: dozens of tests (test_groups_moderation `:136`, test_group_privacy `:133` `== "PUBLIC"`, test_rsvp, test_public_term, test_term_*, test_domain_clock_guard `:121`) create via `POST /api/groups/mine` then RSVP anonymously/GUEST relying on server default PUBLIC. **Changing backend default to PRIVATE would break most of the suite.** Safer: frontend sends `visibility` explicitly; backend wires `CreateOwnCircleRequest.visibility` through `create_own_circle`.
- `test_groups.py:~340`: `create_own_circle` idempotency (second call ignores name).
- `test_groups_moderation.py:112-153`: picks fields from `ModerationTermResponse`; nullable additions fine.
- Query budgets: `test_organizer_page_queries.py:25-26` (`MAIN_ENDPOINT_BUDGET = 10`, `TERMS_ENDPOINT_BUDGET = 5`, must not grow with term count). `test_organizer_bridges.py:168,202` budgets too. Per-term location lookups break these → batch `IN`.
- Exact notification text: `test_handover_copy_api.py:114,117,196`, `test_term_item_listings.py:2327`, `test_term_end_scan.py:713,744,765,779`.
- **Migration downgrade tests** (test_group_soft_delete_migration `:63-79` → `downgrade 0055`; test_organization_media_migration, test_organization_page_layout_migration, test_photo_moderation_attempts_migration, test_terms_circle_occurs_on_index_migration) downgrade shared DB below head then upgrade back → new 0057/0058 `downgrade()` must be correct (drop FKs on groups/terms before dropping `locations`).
- `test_domain_clock_guard.py:25-38`: fails if `datetime.now(`/`date.today(` under `app/groups/application` or `app/groups/router`.

**Frontend tests** (`src/frontend/src/test/`):
- **PanelPage.test.tsx**: module mocks replace whole modules (`../api/groups` 68-81, `../api/terms` 117-126, `../api/organizations` 127-130). New `../api/locations` is **not mocked** → real fetch → add `vi.mock("../api/locations")`. New functions in groups/terms api must be added to factories. `renderPanel` uses `createQueryWrapper`.
  - `:614-641`: "Możesz zostać organizatorem" → dialog "Zostań organizatorem" → "Nazwa organizacji" → `createMyOrganization` "Studio Nutka" → circle step. Breaks on label/org-step change.
  - `:644-653`: expects "Możesz zostać organizatorem".
  - `:402-416`, `:478-547`, `:550-571`, `:732-790`, `:1857`: dialog title "Dodaj pierwszy termin", placeholder "np. Nutki dla starszaków", buttons "Dalej →"/"Dodaj", `createMyCircle` called with exactly `{ name: "Nutki" }` (`:507`).
  - `createTerm` exact `{circle_group_id, occurs_on, description: undefined}` (`:522-528`, `:1476-1482`).
  - `:1314`: `updateTerm(TERM_ID, { occurs_on })` exact.
  - `:1522-1580`: edit-group labels "Nazwa grupy"/"Szablon wizualizacji", `updateGroupLayoutMode(GROUP_ID, "Nutki", "PITCH", "PUBLIC")` exact.
  - `:2882-2935`: "+ Dodaj grupę" → "Dodaj nową grupę"/"Dodaj termin zajęć" inline-error tests.
  - Hints `:597-700` use `hint_*_dismissed:guest` keys; titles "Dodaj swój pierwszy termin", "Dopracuj stronę organizacji", "Ustal pierwsze spotkanie w swojej grupie.".
  - Hamburger-promotion `:397-445` already fail at baseline.
  - Inline TermResponse/GroupResponse literals (`:436`, `:485`, `:534`, `:690`, `mockGroup`) fail `tsc` if new fields required → declare optional or update fixtures.
- **EditTermDialog.test.tsx**: typed fixtures 28-48; mocks `../api/terms` (17-22), `../api/groups` (23-26); LocationPicker needs `../api/locations` mock; uses `createQueryWrapper`.
- **FirstTermStepperOrganizer.test.tsx**: `vi.mock("../api/terms", () => ({ createTerm }))`; renders **without QueryClientProvider** (10-16) → react-query LocationPicker crashes "No QueryClient set". Labels "Data i godzina", "Opis (opcjonalnie)", button "Dodaj termin" must stay.
- No FirstTermStepperGuest test file.
- **AdminTermsPage.test.tsx**: typed fixture 15-24; `getByText("3")`/`getByText("5")` (52-53) — a capacity column with duplicate numbers makes `getByText` throw.
- **TermPage.test.tsx**: typed `PublicCircleResponse` fixture 46-80; mocks `../api/groups` via `importOriginal`; 5 tests already fail at baseline.
- Fixtures needing tsc updates if fields required: termViewModel.test.ts, termAccess.test.ts, AdminGroupsPage.test.tsx, DeleteGroupDialog.test.tsx, TermAttendeesPage.test.tsx, useModerationGroups.test.tsx.
- NotificationBell.test.tsx unaffected. PublicLayout.test.tsx, Sidebar.test.tsx, SidebarAuthIntegration.test.tsx: menu-item counts may shift when adding a hamburger item.
- OnboardingWizard/OnboardingHandoff use "Nazwa organizacji" and `createMyCircle` (out of scope; keep `createMyCircle` working).
- `LayoutRenderer.test.tsx:272` / `GhostBlock.tsx:50`: CTA "Dodaj grupę →" → `/panel/spotkania`.
- `ItemDetailPage.test.tsx:556`, `calendar.test.ts` assert `/krag/...` URLs.

## 4. Notifications

Text only. `Notification` model (`app/notifications/models.py:68-104`): `message` String(500), `link_path`, `read_at`, pointers `proposal_id`, `join_request_id`, `reservation_id`. `NotificationResponse` (`schemas.py:13-24`) no structured term data. Term text built with `clock.format_term_when`/`fit_notification_message`: `application/term_item_listings.py:530-551` (TERM_ITEM_LISTING_TAKEN, ITEM_RESERVED_FOR_PICKUP), `:739-747` (SWAP_ACCEPTED), `notifications/outbox_listener.py:77-136` (`_term_suffix`, payload `occurs_on`/`group_name` from `term_end_scan.py:~120-190`), pledges `pledges.py:52-60`. Helpers `app/core/clock.py:58-71`. Adding place = append text (500 cap; update exact-text tests) or add fields to outbox payload (backward-compatible like `_term_suffix` None fallback). Frontend renders `{n.message}` (`NotificationBell.tsx:63-77`; types `api/notifications.ts:3-45`).

## 5. Soft-delete and partial unique index precedent

- Group soft delete: `0056_group_soft_delete.py` (nullable `deleted_at` DateTime naive UTC, `deleted_by_party_id` FK `fk_groups_deleted_by_party_id_parties`). Service `circles.py:193` `datetime.utcnow()`; restore `:206-216`. Every read filters: `repository.py:64,73,92,229,276,292,331,343`. Keep-live twins `get_term_any` (`terms.py:54-60`). `NeededItem.deleted_at` (`models.py:261`). `standards/backend/models.md:170` "no entity implements soft delete" is stale.
- Partial unique indexes `op.create_index(name, table, cols, unique=True, postgresql_where=sa.text("..."))`: `0037:79-87` (`uq_group_join_requests_pending_requester_group` WHERE status='PENDING'), `0023:55-56`, `0054:88-96`, `0003`/`0009`/`0012` WHERE `valid_to IS NULL`, `0042` WHERE `account_type='EXTERNAL'` mirrored in model `__table_args__` (`circulation/models.py:128-129`). For Location: `uq_locations_owner_party_id_google_place_id` WHERE `google_place_id IS NOT NULL` (decide `AND deleted_at IS NULL`).
- New table: UUID id `uuid4` default + `server_default gen_random_uuid()` (`base_model.py:41-58`, `0054:48`); names `pk_/fk_/uq_/ix_`; next revision 0057; migration tests follow `test_group_soft_delete_migration.py`.

## 6. Configuration requirements and gaps

- No `VITE_*` usage; no `src/vite-env.d.ts`; `tsconfig.app.json` `"types": ["vite/client"]` so `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` is `string | undefined`; add `src/vite-env.d.ts` with `interface ImportMetaEnv { readonly VITE_GOOGLE_MAPS_API_KEY?: string }`.
- No `src/frontend/.env*`. Root `.env.example` backend only. Vite envDir default is `src/frontend` → need `src/frontend/.env.example` or `envDir` in `vite.config.ts`.
- **Docker build gap**: `src/frontend/Dockerfile` builder stage has no `ARG`/`ENV`; `docker-compose.yml` `frontend`/`frontend-build` pass no build args. Backend serves built `index.html` from `frontend_index` volume for OG previews; runtime loader simpler than index.html script.
- **No CSP** (index.html, nginx.conf, backend headers). index.html already loads Google Fonts.
- No Google/maps dependency in package.json. Options: hand-written `<script>` loader, or `@googlemaps/js-api-loader` + `@types/google.maps`.
- Tests/CI: key undefined → manual mode. Google path testable with `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "x")` + fake `window.google`.
- docker-compose: `postgres:18`, `frontend-build` (one-shot), `backend` (runs `alembic upgrade head` on start, 8080), `frontend` (nginx 5174:80). Vite dev proxy `/api`, `/oauth2` → localhost:8080.

## Shared dependencies to reuse

Backend: `app.core.auth_deps` (`Principal`, `require_any`), `app.users.service.get_profile_by_principal`, `app.core.errors` (`EntityNotFoundException`, `AccessDeniedException`, `BusinessConflictException`), `app.moderation.text_guard.check_text`, `app.core.clock`, `app.core.base_model.BaseEntity`, ACL pattern `organizations_acl.py`.
Frontend: `api`/`ApiError` (`api/client.ts`); `serverMessageOr`/`extractProblemMessage`; `Field`/`ModalSheet` (`panelComponents`); hooks e.g. `useCategories.ts:33`; `termPublicPath` (`panelHelpers.ts:110`); `createMyOrganization` (`api/organizations.ts`).
