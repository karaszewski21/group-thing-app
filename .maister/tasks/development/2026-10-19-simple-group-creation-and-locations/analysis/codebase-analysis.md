# Codebase Analysis Report

**Date**: 2026-10-19
**Task**: Simplified 2-step group creation for any logged-in user + new Location entity (Google Places or manual, owner-scoped, soft delete) wired into Group defaults and Term, shared LocationPicker, informational capacity
**Description**: `.maister/tasks/development/2026-10-19-simple-group-creation-and-locations/task-description.md` (Scope A: group creation without organization step, default visibility PRIVATE/PUBLIC, `/krag` fallback links, panel showing led + attended groups, no "organizator" as account status. Scope B: `Location` entity + `/api/locations`, `Group.default_location_id`/`default_capacity`, `Term.location_id`/`capacity` copied from group at creation, `LocationPicker` with Google Places Autocomplete via `VITE_GOOGLE_MAPS_API_KEY` and manual fallback, display on public term page / panel cards / AdminTermsPage / notifications, "Brak wolnych miejsc" without blocking RSVP.)
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)

Paths are relative to the repo root `C:\Users\karas\Desktop\swaptime\group-thing-app`. Backend: `src/backend/app` (FastAPI, async SQLAlchemy 2.0, hand-written Alembic, testcontainers Postgres 18). Frontend: `src/frontend/src` (React 19, Vite 8, TS 5.9, TanStack Query v5, Tailwind v4, Chakra only on admin pages, Vitest 3 + jsdom). No `.github/` directory, no CI workflows. Test suites were not run for this analysis.

---

## Summary

The codebase already has every building block the task needs (idempotent `POST /api/groups/mine`, `k-<hash>` organizer-slug fallback, `groupExtras` placeholder state, soft-delete and partial-unique-index precedents, `organizations_acl.py` cross-BC mapper, hook/api-module templates), but nothing for Google, no `VITE_*` plumbing, and no backend knowledge of location/capacity. The work is a cross-cutting feature: one new backend module (`app/locations`), two Alembic migrations (0057/0058), schema additions in 7 group/term response models, a 1221-line `PanelDataContext.tsx` whose either/or "guest vs organizer" model must become both-at-once, and ~12 frontend plus ~10 backend test files that will break for identifiable reasons. Thirteen contradictions between the brief/standards and the actual code (listed first below) must be resolved in the specification before planning.

---

## Contradictions with the brief and standards (resolve in spec)

All four agents flagged these independently; they are the most important output of this analysis.

| # | Brief/standard says | Code actually does | Consequence |
|---|---|---|---|
| 1 | `standards/backend/models.md:79-111`, `migrations.md`: PKs via explicit Postgres `Sequence` | Since `0041_baseentity_id_uuid.py`, `app/core/base_model.py:41-66` uses `postgresql.UUID(as_uuid=True)`, `default=uuid.uuid4`, `server_default=gen_random_uuid()` | New `locations` table and all FK columns are UUID. Copy `0054_organization_media.py`, not `0037`. Standards doc is stale. |
| 2 | Brief: done screen links "pod /krag/..." when `organizer_slug` is null | Backend never returns null `organizer_slug` for `/mine`, `/mine/new`, PATCH, GET `/{id}`: `groups/domain/organizer_slug.py:11-34` + `infrastructure/slug_resolver.py:18` derive `k-<blake2s>`. Schema types it `str \| None` (`schemas.py:37`). Slug segment is cosmetic: lookups go by group_id/term_id; `router.tsx:155` accepts any segment; "krag" is a reserved Organization slug (`organizations/slugs.py:24`). No literal `/krag/` route exists. | Today's links look like `/k-abc123/grupa/<id>/term/<id>`. The `?? "krag"` guards in `panelHelpers.ts:110`, `FirstTermStepperGuest.tsx:113`, `FirstTermStepperOrganizer.tsx:59`, `PublicTermView.tsx:191` are dead code. Either change `derive_organizer_slug` to return `"krag"` when no Organization exists, or rewrite the acceptance criterion. Decide in spec. |
| 3 | Brief item 6: panel shows led and attended groups at once | `PanelDataContext.tsx:455-470` `load()`: any active leadership → `myGroups` loaded and `guestCircles = []`; otherwise family memberships → `guestCircles`. `relevantGroupsForForm = isOrganizer ? myGroups : guestCircles` (`:1091`); `if (isOrganizer)` branches in `SpotkaniaView.tsx:128,158` and `HomeView.tsx:133` | Contexts are mutually exclusive by construction; requires restructuring `load()` and the view branches, not a copy change. |
| 4 | Brief item 16: location in notifications "if they contain meeting details" | `Notification` = `message` String(500) + `link_path` + pointer ids (`app/notifications/models.py:68-104`); `NotificationResponse` (`schemas.py:13-24`) has no structured term data. Only term detail is text from `clock.format_term_when` / `_term_suffix` (`application/term_item_listings.py:530-551,739-747`, `notifications/outbox_listener.py:77-136`, `term_end_scan.py:205-216`, `pledges.py:52-60`) | Place can only be appended to text (500-char cap via `fit_notification_message`) or added to the outbox payload with a None fallback. Exact-text tests will need updating (see test inventory). |
| 5 | Brief item 17: "Brak wolnych miejsc" when `attendee_count >= capacity` on the public page | `PublicTermResponse` (`schemas.py:284-289`) has no `attendee_count`; public page counts `guardians[]`, which includes withdrawn attendances (`public_view.py:300-312`, `list_attendances_for_term` keeps `withdrawn_at` rows) | Needs a new `attendee_count` on `PublicTermResponse` computed from `count_active_attendances_by_term` (`repository.py:475-492`), or filtered `guardians.length`. Beware `test_public_term.py` exact-key assertions. |
| 6 | Brief item 3: default visibility PRIVATE without organization | `Group.visibility` `server_default "PUBLIC"` (`models.py:91-104,113-125`); `POST /api/groups/mine` ignores `body.visibility` (`router/circles.py:74-86`, `application/circles.py:65-90`); only `/mine/new` honours it. Dozens of backend tests create via `/mine` then RSVP as anonymous/GUEST relying on PUBLIC (`test_groups_moderation.py:136`, `test_group_privacy.py:133`, `test_rsvp`, `test_public_term`, `test_term_*`, `test_domain_clock_guard.py:121`) | Do not change the backend default. Have the frontend send `visibility` explicitly and wire `CreateOwnCircleRequest.visibility` through `create_own_circle`. Also note `/mine` is idempotent: returns the existing led circle, so a repeat user does not get a new group (`test_groups.py:~340`). |
| 7 | Brief item 12: key from `VITE_GOOGLE_MAPS_API_KEY` | Nothing reads `import.meta.env`; no `src/vite-env.d.ts`; no `src/frontend/.env*`; root `.env.example` has backend keys only; `tsconfig.app.json` has `"types": ["vite/client"]` so the var types as `string \| undefined` | Add `src/frontend/src/vite-env.d.ts`, `src/frontend/.env.example` (or `envDir`), and never print the value. |
| 8 | Brief risk: app must run with key in Docker | `src/frontend/Dockerfile` builder stage has no `ARG`/`ENV`; `docker-compose.yml` `frontend`/`frontend-build` pass no build args; no CSP anywhere; no Google/maps package in `package.json`; no external script loader exists (only `iframe.src` in `plugins/PluginFrame.tsx:55`) | Add `ARG VITE_GOOGLE_MAPS_API_KEY` to Dockerfile and compose build args; choose hand-written lazy `<script>` loader or `@googlemaps/js-api-loader` + `@types/google.maps`. |
| 9 | Brief item 13: LocationPicker used in `FirstTermStepperOrganizer` | `src/frontend/src/test/FirstTermStepperOrganizer.test.tsx:10-16` renders the component without `QueryClientProvider` | A react-query-based LocationPicker crashes with "No QueryClient set"; test must wrap with `createQueryWrapper()` and mock `../api/locations`. |
| 10 | Brief items 10-11: add `location`/`capacity` to public responses | `tests/test_public_term.py:180-198, 243-249` assert exact `set(body.keys())` for `PublicCircleResponse` and `body["term"].keys() == {id, occurs_on, description, needed_items, item_listings}`; `test_my_attendances.py:114` exact keys of `MyAttendanceResponse`; `test_groups.py:570` no field containing "child" on `PublicCircleResponse` | These tests break by design; update them alongside the schema. |
| 11 | Query performance (standards `queries.md`) | `test_organizer_page_queries.py:25-26` (`MAIN_ENDPOINT_BUDGET = 10`, `TERMS_ENDPOINT_BUDGET = 5`, must not grow with term count) and `test_organizer_bridges.py:168,202` enforce SQL query budgets | Per-term location lookups will break the budgets. Resolve locations with one batched `IN` query per list endpoint. |
| 12 | `models.md:170` "no entity implements soft delete"; `lazy="raise"` + `selectinload` guidance | `groups.deleted_at`, `needed_items.deleted_at`, `inventory_items.deleted_at` exist; no global filter, every query adds `.where(X.deleted_at.is_(None))`. `app/groups/models.py` has no `relationship()` at all (`:12`); reads use explicit `select(A, B).join(...)` and nested responses are built by hand (`public_view.py:99-102` calls this the intended "eager form"). `lazy="raise"` only in `app/circulation`. | Follow the groups BC as it is: plain FK-id columns, explicit joins/batched lookups, no `relationship()`. |
| 13 | Standard `models.md`: `__eq__`/`__hash__` on business key; no `Float` | Location has no natural business key | Do not add `__eq__`. `lat`/`lng` must be `Numeric(9,6)`, not `Float`. |

Also stale: `standards/testing/backend-testing.md` still describes Java/MockMvc; `security.md` "no test suite" note.

---

## Files Identified

Ranked by how many agents cited them and by direct relevance. Line counts from the agents.

### Primary Files

**Backend groups bounded context**

**src/backend/app/groups/models.py** (416 lines) — all 4 agents
- `Group` 97-123 (`party_id`, `name`, `layout_mode`, `visibility` server_default PUBLIC 113-125, `deleted_at`/`deleted_by_party_id` 126-131). `Term` 221-239 (`circle_group_id`, `occurs_on`, `description`; index 227). `TermAttendance` 294-320. `NeededItem.deleted_at` 261. `ItemListingPreference.owner_party_id` FK `parties.id` 290-294/347 (naming precedent). `_enum_column` helper (String-backed, `native_enum=False`). No `relationship()`.
- Gets `default_location_id`/`default_capacity` on Group and `location_id`/`capacity` on Term.

**src/backend/app/groups/schemas.py** (816 lines) — all 4 agents
- Exact current field lists below. Seven models need location/capacity additions.

**src/backend/app/groups/router/circles.py** (369 lines) — 4 agents
- POST `/api/groups` 64; POST `/mine` 74-86 (`create_own_circle(db, party_id, body.name)`, visibility ignored, idempotent); POST `/mine/new` 89-106 (passes visibility); GET `/public/{id}` 115; `/access` 135; RSVP 153; `/mine/attendances` 227; PATCH `/{id}` 274-284; DELETE 287; GET `/{id}` 300. Each handler does `response.organizer_slug = await service.resolve_organizer_slug(...)` after `model_validate` (69-71, 84-86, 104-106, 205-206, 282-284, 303-305) — the pattern to reuse for attaching `location`.

**src/backend/app/groups/router/terms.py** (134 lines) — 4 agents
- POST `/api/terms` 38; GET list with counts 46-64 (counts written onto `TermResponse` after `model_validate` 56-64); `/moderation` 67; GET `/{id}` 77; PATCH `/{id}` 83. GET `/{id}`, POST, PATCH return no counts.

**src/backend/app/groups/application/circles.py** (348 lines) — 4 agents
- `create_circle` 43 (creates ORGANIZATION Party per circle 43-50); `create_own_circle` 65-90 (idempotent, no visibility); `create_additional_circle` 93-122 (only place setting visibility); `soft_delete_group` 173-201 (`datetime.utcnow()` 193); restore 206-216; `update_group` 220-247 (applies only non-None; cannot clear); `_is_active_organizer`/`_require_active_organizer` 338/346.

**src/backend/app/groups/application/terms.py** (279 lines) — 4 agents
- `create_term` 32-44: profile → `get_group` (404) → `_require_active_organizer` (403) → `check_text(TextField.TERM_DESCRIPTION)` 36 → `Term(circle_group_id, occurs_on, description)` → commit/refresh. Copies nothing from the group today; inheritance of default location/capacity belongs here (group already loaded). `get_term_any` 54-60 keep-live twin. `list_terms_with_counts` 67-83 (counts only for active organizer). `list_terms_for_moderation` 86-110 (builds `ModerationTermResponse` field by field 95-109). `update_term` 113-129 (`if data.x is not None` 122-125). NeededItem soft-delete check 170-180. Notification `link_path "/panel"` ~276.

**src/backend/app/groups/application/public_view.py** (510 lines) — 3 agents
- `list_my_attendances` 96; `get_public_circle_view` 183-329 (PRIVATE reduced branch ~229; `PublicTermResponse` built at 267; guardians 300-312; `PublicCircleResponse` 318); `create_rsvp` 401. "Eager form" comment 99-102.

**src/backend/app/groups/infrastructure/repository.py** (1025 lines) — 3 agents
- `get_group` 69-75 (None when soft-deleted), `get_group_including_deleted`, list filter 62-66, `list_group_names(db, ids)` 82 (batched-dict precedent), `list_groups_for_moderation` 103, `get_term` 285-294 (joins Group, filters deleted), `get_term_any` 297, `list_terms_for_group` 318, `list_terms_for_moderation` 336, needed-item joins ~365-395, `count_active_attendances_by_term` 475-492 → `{term_id: (count, child_sum)}` over `withdrawn_at IS NULL`. Reads never commit.

**src/backend/app/groups/infrastructure/organizations_acl.py** — 3 agents
- `get_own_organization`, `public_organization(org) -> PublicCircleOrganization | None` (39-47): the cross-BC mapper template for a new `locations_acl.py`. Write-side twin: `product_bridge.py`.

**src/backend/app/groups/domain/organizer_slug.py** (34) and **infrastructure/slug_resolver.py** (36) — 3 agents
- `derive_organizer_slug` falls back to `k-<blake2s>`; the one place to change if `/krag` is to be real.

**src/backend/app/groups/service.py** (175) — facade re-exporting `application/*`; routers import `from app.groups import service`. **router/__init__.py** (40) — sub-router order matters.

**Backend infrastructure**

**src/backend/app/core/authorization_matrix.py** (269 lines) — 4 agents
- `_RAW_MATRIX` 37-249, first match wins. Group rows 81-135 (`:123` `PATCH,DELETE ^/api/groups/[^/]+$` EDIT; `:134` GET READ; `:135` POST EDIT). Term rows 163-166. Organizations rows 195-201, inventory-items 177-182, families 137-152 as templates. Catch-all AUTHENTICATED at 248. No `/api/locations` row today → add before the catch-all.

**src/backend/app/main.py** (160) — imports 24-48, `include_router` list 146-160 (groups 154, organizations 155, …, `system_router` last at 160 — SPA catch-all, must stay last).

**src/backend/app/core/base_model.py** (68) — `BaseEntity` UUID id (41-66), `created_at`, `updated_at` as optimistic-lock version.

**src/backend/alembic/versions/** — head `0056_group_soft_delete.py` (down `0055`); next `0057`. `env.py` `target_metadata = None` → hand-written migrations. Templates: `0054_organization_media.py` (new UUID table, partial unique 88-96), `0056` (add_column + create_foreign_key), `0037:77-87` (partial unique `postgresql_where`), `0023`, `0042` (mirrored in `circulation/models.py:128-129`).

**src/backend/app/organizations/** (`models.py` 228, `schemas.py` 134, `service.py` 204, `router.py` 141) — 3 agents
- Cleanest standalone-module template: `/mine` shape, PATCH via `model_fields_set`, 404-then-403 ownership order, `ConfigDict(extra="forbid", str_strip_whitespace=True)` partial update with `_not_null` / blank-clears validators, `OrganizationMedia.__eq__` on `storage_key` (174), `date.today()` in `valid_from` (outside clock guard).

**src/backend/app/circulation/application/inventory_items.py** — owner-scoped soft-delete with `_require_item_owner`; **inventory.py:40-70** SAVEPOINT `begin_nested` + `IntegrityError` re-fetch for unique races.

**src/backend/app/moderation/text_guard.py** (18-26 `TextField` enum) — `check_text(TextField.X, new, old)`; no LOCATION_* fields yet.

**src/backend/app/notifications/** — `models.py:68-104` (`Notification`), `schemas.py:13-24`, `outbox_listener.py` (136; `_term_suffix` 77-136), `service.py` (90); `groups/infrastructure/notifications_bridge.py` (38); `app/core/clock.py:58-71` (`format_term_when`, `fit_notification_message`).

**src/backend/app/party/models.py** (54) — `Party(party_type, active)`, `PartyType PERSON/ORGANIZATION`; `owner_party_id` FKs point to `parties.id`. **app/users/schemas.py:55**, **users/router.py:53** — `is_organizer` = `is_active_organizer`; **users/service.py:97** `get_profile_by_principal` → `profile.party_id`.

**Frontend panel (Scope A + pickers)**

**src/frontend/src/pages/panel/PanelDataContext.tsx** (1221 lines) — all 4 agents
- `isOrganizer` 230 (`profile?.is_organizer === true || myGroups.length > 0`, rationale 217-229). `editGroupForm {name, location, freeSpots, layoutMode, visibility}` 202-208. `organizationSlug` 215, loaded 416-422 via `getMyOrganization()` (null on 404) — the existing "has an Organization" signal. `firstTermForOrganizer` 255. Hint keys 259-281 (`hint_first_term_dismissed`, `hint_become_organizer_dismissed`, `hint_org_first_term_dismissed`, `hint_org_polish_dismissed`, per account via `hintKey()` 132). `groupExtras` 293 `Record<groupId,{location;freeSpots}>` (written 604-609, 970-984; read 935-940; exported 1144) — to delete. `groupForm {name, location, freeSpots, visibility:"PUBLIC"}` 305-310. Add-term form 313-319. `load()` 332-488 (either/or at 455-470). `handleAddGroup` 592-617 → `createAdditionalMyCircle({name, visibility})` 600. `handleAddTerm` 647-684 → `createTerm` 660 + `createNeededItem` per draft. `signupSummaryChip` 818. `organizerTermCard` 851-930 (copy-link 907 via `termPublicPath`). `startEditGroup`/`cancelEditGroup`/`saveEditGroup` 934/948/954 → `updateGroupLayoutMode` 966. `relevantGroupsForForm` 1091. `editTermEntry` 1094. Imperative `useState`+`useEffect` style (anti-pattern; do not extend, but it is where the forms live).

**src/frontend/src/components/panel/FirstTermStepperGuest.tsx** (227 lines) — 4 agents
- `withOrganizationStep` 29/41/46; org step 56-68 → `createMyOrganization({name})` 61; step 1 `createMyCircle({name})` 75 (no visibility) + `onCircleCreated()`; step 2 `createTerm({circle_group_id, occurs_on, description})` 91; title switch "Zostań organizatorem" 102 (also comments 20-21, 27); dots 103; done screen 105-127 (link 113 `/${circle.organizer_slug ?? "krag"}/grupa/${circle.id}/term/${createdTermId}`, "Gotowe" 123); field "Nazwa kręgu" 165. Uses panel `ModalSheet`/`Field`.

**src/frontend/src/components/panel/FirstTermStepperOrganizer.tsx** (111) — one-step term form for `myGroups[0].id`; done link 59; "Gotowe" 69; fields 78-95 ("Data i godzina", "Opis (opcjonalnie)", button "Dodaj termin").

**src/frontend/src/pages/panel/PanelModals.tsx** (377 lines) — 4 agents
- `"pierwszy-termin"` 63-90 (Organizer stepper if `firstTermForOrganizer && myGroups.length>0`, else Guest). `"zostan-organizatorem"` 92-104 (`withOrganizationStep={organizationSlug === null}` 95; toast "Jesteś organizatorem — dodano pierwszy termin" 100). `EditTermDialog` mount 119-136. "Dodaj nową grupę" 139-198 ("Lokalizacja" 151, "Ile miejsc" 159, visibility select 170-185, button 195). "Edytuj grupę" 201-279 ("Lokalizacja" 213, "Ile miejsc" 221). "Dodaj termin zajęć" 282-374.

**src/frontend/src/pages/panel/views/HomeView.tsx** (290) — hints 70-119 (`hint_first_term` 71-83 → `setFirstTermForOrganizer(false)` + `setModal("pierwszy-termin")`; `hint_become_organizer` 85-94, title "Możesz zostać organizatorem" 88, `setModal("zostan-organizatorem")` 91; `hint_org_polish` 96-105; `hint_org_first_term` 107-119). Term cards: organizer branch 133; guest Link card 134-163. "Zapisane zajęcia" links 190 use `/${a.organizer_slug}/grupa/...` (no `?? "krag"`).

**src/frontend/src/pages/panel/views/SpotkaniaView.tsx** (326) — reads `groupExtras` 85, 183; builds literal `TermResponse`/`GroupResponse` objects from `MyAttendanceResponse` 127-156 (new TS fields must be optional/nullable or `tsc` breaks); "+ Dodaj grupę" 171-176 (organizers only); group tile `extra.location` + "wolne N miejsca" 220-229; FAB 263-269; guest term card 287-321; `isOrganizer` branches 128, 158.

**src/frontend/src/pages/panel/panelHelpers.ts** (111) — `ModalKind` 24-32 (`"zostan-organizatorem"` 29, `"pierwszy-termin"`); `TermWithNeeded` 47-51; `termPublicPath(group, termId)` 109-111.

**src/frontend/src/pages/panel/panelComponents.tsx** (203) — panel `ModalSheet` 167 (only `useRegisterOpenSheet(true)`, no trapFocus/Esc/focus return), `Field` 158, `HintCard` ~107, `FloatingAddButton`.

**src/frontend/src/components/shared/AccountMenu.tsx** (80) — hamburger: Profil, Ustawienia, "Moja organizacja" 63-70 (`/${slug}` or `/organization`), Mój dom, `extraItems`; comment 57-62. No "Załóż grupę" item. Used only by `components/layout/PublicLayout.tsx:36`.

**Frontend term forms and displays (Scope B)**

**src/frontend/src/components/panel/EditTermDialog.tsx** (491) — props `term`, `neededItems`, `group` (61-72); `occursOn`/`description` state 122-128; `saveTermFields` diff-PATCH 186-197 → `updateTerm` → `onChanged()`; fields "Data i godzina" 285, "Opis" 297; needed-items inline list 181-280, 329-429 (edit/delete row UI pattern); `useState`+`useEffect` fetch 139-153 (anti-pattern).

**src/frontend/src/pages/AdminTermsPage.tsx** (65) — Chakra `AdminTable` columns Date, Circle, Description, Signups, Children (33-60); `useModerationTerms`.

**src/frontend/src/pages/krag/PublicTermView.tsx** (251) — the public term AND group page (no separate group page): `GroupHeader` 203 (subtitle = `term.description`), `TermCard` 224, `NeededItemsSection`, `AttendeeList` 228, `TermFooter` (RSVP) 242, `organizer_slug ?? "krag"` 191. **pages/krag/components/TermCard.tsx** (36) takes only `{date}` — natural place for location + capacity. **TermPage.tsx** (52) route element; related `PrivateGroupGate.tsx` (256), `GroupHeader.tsx` (57), `TermFooter.tsx` (28), `termViewModel.ts`, `hooks/useTermAccess.ts` (key `["groupAccess", groupId, termId]`), `hooks/useTermSignUp.ts`.

**src/frontend/src/components/shared/NotificationBell.tsx** (85) — renders `n.message` 63-77, navigates `link_path` 19; types `api/notifications.ts:3-45`.

**Frontend data layer**

**src/frontend/src/api/groups.ts** (610) — `GroupResponse` 18-27 (id, party_id, name, organizer_slug, layout_mode, visibility, created_at, updated_at); `CreateCircleRequest` 29-32; `ModerationGroupResponse` 37 (`term_count`); `createMyCircle` 107 (POST `/groups/mine`); `createAdditionalMyCircle` 114; `updateGroupLayoutMode(id, name, layoutMode, visibility?)` 126-139 (only PATCH caller); `PublicTermResponse` 187-193; `PublicCircleResponse` 216-226; `MyAttendanceResponse` ~514-523.

**src/frontend/src/api/terms.ts** (108) — `TermResponse` 4-16, `ModerationTermResponse` 20-29, `CreateTermRequest` 31-35, `createTerm` 65, `UpdateTermRequest` 69-73, `updateTerm` 74.

**src/frontend/src/api/organizations.ts** (100) — `getMyOrganization` 65, `createMyOrganization` 69 (POST `/organizations/mine`); other callers `components/onboarding/steps/organizerSteps.tsx:5,35`, `pages/OrganizationPage.tsx:4,68` (the natural "Stwórz wizytówkę" target). Template for `api/locations.ts` (snake_case types, `encodeURIComponent` ids).

**src/frontend/src/api/client.ts** (108), **api/problem.ts** (`extractProblemMessage` 40-57, `serverMessageOr` 67, `hasStatus`), **api/queryClient.ts** (17), **router.tsx** (`/panel` 97, `/panel/:view` 101, `/panel/terminy/:termId` 108, `/:organizationSlug/grupa/:groupId/term/:termId` 155, comment about removed `/krag/:groupId` route 144-153, `/organization` 78, `/:organizationSlug/terminy` 163, `/:organizationSlug` 173).

**Hook templates**: `hooks/useCategories.ts` (query + mutations, module-level empty array, `extractProblemMessage`), `hooks/useMyOrganization.ts` (token in key 45-49, `enabled: token !== null`), `hooks/useUpdateOrganization.ts` / `useOrganizationMedia.ts` (shared `mutate(call, fallback)` that invalidates and rethrows `serverMessageOr`), `hooks/useModerationTerms.ts` (38), `useTermAttendees.ts` (86). **components/krag/ModalSheet.tsx** + `trapFocus.ts`, `components/shared/openSheets.ts` (accessible sheet). **utils/dayjs.ts** (34). **vite.config.ts** (23; dev proxy `/api`, `/oauth2` → 8080), **tsconfig.app.json** (includes `src`, so test fixtures are type-checked by `npm run build`).

### Related Files

- `src/frontend/src/pages/PanelPage.tsx` (96), `PanelNav.tsx` (56), `panelDataStore.ts` (16), `pages/panel/DeleteGroupDialog.tsx` (hand-rolled alertdialog).
- `src/frontend/src/pages/organizer/OrganizerTermsPage.tsx` (120), `blocks/UpcomingTermsBlock.tsx` (105), `blocks/NextTermCtaBlock.tsx`, `organizerHelpers.ts:5` — optional location display on organizer public pages; backend `application/organizer_page.py`, schemas `OrganizerTermResponse` 376-382 / `OrganizerNextTermResponse` 361-383.
- Other link builders using slug: `SwapAcceptSuccessSheet.tsx:49`, `ItemTimeline.tsx:85`.
- Per-group-role "organizator" wording that likely stays: `RegisterPage.tsx:23-64`, `PrivateGroupGate.tsx:144-243`, `GroupVisualization.tsx:142/187/252`, `TermCard.tsx:31`, `GroupHeader.tsx:46`, `PublicTermView.tsx:155`, `RequestAccessDialog.tsx:120`, `api/problem.ts:60`.
- `components/onboarding/steps/organizerSteps.tsx:70,103` — out of scope, shares `createMyCircle`/`createTerm`.
- `LayoutRenderer`/`GhostBlock.tsx:50` — CTA "Dodaj grupę →" → `/panel/spotkania`.
- `pages/organizer/editor/PhotosTab.tsx` (hook-based list with delete, focus move after removal), `ColorsTab.tsx:53` / `LayoutTab.tsx:27` (`role="radiogroup"` pickers), `NeededItemQuickAddForm.tsx` (`<select>` + hook), `pages/ProductListPage.tsx:140` (only `role="combobox"`, a `<select>`).
- Infra: `src/frontend/Dockerfile`, `docker-compose.yml` (postgres:18, `frontend-build` one-shot, `backend` runs `alembic upgrade head` on start on 8080, `frontend` nginx 5174:80, backend serves built `index.html` from `frontend_index` volume for OG previews), `index.html` (loads Google Fonts; no CSP), `nginx.conf`, root `.env.example`.
- Standards to update later: `.maister/docs/standards/backend/models.md`, `migrations.md`, `testing/backend-testing.md`.

Every "Zostań organizatorem" occurrence: `FirstTermStepperGuest.tsx` 20-21, 27, 102; `PanelModals.tsx` 92; `panelHelpers.ts` 29; `HomeView.tsx` 88, 91; `PanelPage.test.tsx` 614, 623, 627, 638, 652.

---

## Current Functionality

### Exact current schema fields (`src/backend/app/groups/schemas.py`)

| Model | Lines | Fields today |
|---|---|---|
| `GroupResponse` (from_attributes) | 31-41 | id, party_id, name, organizer_slug: str\|None=None, layout_mode: GroupLayoutMode, visibility: GroupVisibility, created_at, updated_at |
| `CreateCircleRequest` | 68-69 | name |
| `UpdateGroupRequest` | 72-81 | name (required, stripped, non-blank), layout_mode\|None, visibility\|None — only non-None applied |
| `CreateOwnCircleRequest` | 88-90 | name (1..255), visibility: GroupVisibility\|None=None — honoured by `/mine/new`, ignored by `/mine` |
| `ModerationTermResponse` | 134-145 | id, circle_group_id, group_name, occurs_on, description, created_at, attendee_count: int, child_count: int |
| `TermResponse` (from_attributes) | 148-158 | id, circle_group_id, occurs_on: datetime, description: str\|None, created_at, updated_at, attendee_count: int\|None=None, child_count: int\|None=None |
| `CreateTermRequest` | 161-164 | circle_group_id, occurs_on, description: str\|None (max 2000) |
| `UpdateTermRequest` | 167-169 | occurs_on\|None, description\|None (max 2000) — applied only if not None |
| `PublicTermResponse` | 284-289 | id, occurs_on, description, needed_items, item_listings |
| `PublicCircleOrganization` | 297-305 | name, primary_color, accent_color, palette_preset |
| `PublicCircleResponse` | 308-323 | id, name, organizer_display_name, organizer_slug, organization: PublicCircleOrganization\|None, visibility, layout_mode, term: PublicTermResponse\|None, guardians |
| `GroupAccessResponse` | 344 | group: PublicCircleResponse, access: {is_member, is_organizer, can_view_content, join_request, is_attending} |
| `OrganizerTermResponse` | 376-382 | term_id, group_id, group_name, occurs_on, description, attendee_count |
| `OrganizerNextTermResponse` | ~361-383 | id, occurs_on, attendee_count |
| `MyAttendanceResponse` | 500-515 | exact key set asserted by `test_my_attendances.py:114` |
| `GroupVisibility` (`models.py:91-104`) | | PUBLIC \| PRIVATE, server_default "PUBLIC" |

Frontend mirrors: `api/groups.ts:18-27` `GroupResponse`, `187-193` `PublicTermResponse`, `216-226` `PublicCircleResponse`; `api/terms.ts:4-16` `TermResponse`, `20-29` `ModerationTermResponse`, `31-35` `CreateTermRequest`, `69-73` `UpdateTermRequest`.

### Key flows today

- **Group creation (guest)**: `HomeView` hint "Dodaj swój pierwszy termin" (when `!isOrganizer`) → `"pierwszy-termin"` modal → `FirstTermStepperGuest` (steps: optional organization → circle name → first term → done). "Możesz zostać organizatorem" hint → `"zostan-organizatorem"` modal with `withOrganizationStep={organizationSlug === null}`. `createMyCircle({name})` → `POST /api/groups/mine` → `create_own_circle` (idempotent, visibility ignored → PUBLIC). `SpotkaniaView` "+ Dodaj grupę" (organizers only) → `"grupa"` modal → `createAdditionalMyCircle({name, visibility})` → `/mine/new`. Hamburger has no group-creation item. Each circle gets its own ORGANIZATION `Party` (`Group.party_id`); the human owner is the `Leadership`.
- **Term creation**: `POST /api/terms` → `create_term` (see above). Frontend: term modal (`PanelModals.tsx:282-374`) with state in `PanelDataContext` → `createTerm` → `createNeededItem` per draft; `EditTermDialog` diff-PATCH via `updateTerm`.
- **Panel load**: profile → leaderships → if any: `myGroups` via `getGroup(id)` each and `guestCircles=[]`; else family memberships → `guestCircles`. Terms: `getTerms(group.id)` + `getNeededItems` per relevant group → `terms: TermWithNeeded[]`. `myAttendances = getMyAttendances()`. `organizationSlug` from `getMyOrganization()`.
- **Public term page**: `TermPage` → `useTermAccess` → `GET /api/groups/public/{id}/access?term_id=` → `PublicTermView` renders header/date card/attendees/RSVP footer.
- **Counts**: `count_active_attendances_by_term` only on the list endpoint for active organizers; moderation list has counts; public view has none.
- **Soft delete**: `Group.deleted_at` set via `datetime.utcnow()`; every read filters `deleted_at IS NULL` (`repository.py:64,73,92,229,276,292,331,343`); `get_*_including_deleted`/`get_term_any` are the keep-live escape hatches.
- **Notifications**: text only; term detail appended as "(day, group_name)" suffix.

### Data Flow for the new feature (target)

Frontend `LocationPicker` → `useMyLocations` (`GET /api/locations/mine`) / `createLocation` (`POST /api/locations`) → `locations.id` UUID → sent as `default_location_id` (group forms) or `location_id` (term forms) → backend validates ownership via `locations_acl.get_owned_location(db, id, party_id)` → stored as plain FK column → list/detail endpoints batch-load `get_locations_by_ids` (including soft-deleted) → mapped to `LocationResponse`/`PublicLocationResponse` and attached after `model_validate` → rendered on `TermCard`, panel cards, `AdminTermsPage`; capacity compared with `attendee_count` for "Brak wolnych miejsc".

---

## Dependencies

### Imports (what the new code depends on)

Backend: `app.core.base_model.BaseEntity`, `app.core.auth_deps` (`Principal`, `require_any`), `app.users.service.get_profile_by_principal`, `app.core.errors` (`EntityNotFoundException`→404, `AccessDeniedException`→403, `BusinessConflictException`→409, `IntegrityError`→409), `app.moderation.text_guard.check_text`, `app.core.clock`, `app/party` (FK target `parties.id`), SQLAlchemy `postgresql.UUID`/`Numeric`, Alembic.
Frontend: `api/client.ts` (`api`, `ApiError`), `api/problem.ts`, TanStack Query (`queryClient`), `panelComponents` (`Field`, panel `ModalSheet`), `components/krag/ModalSheet`, `utils/dayjs`, `termPublicPath`, `createMyOrganization`, Google Maps JS (new, optional at runtime).

### Consumers (what depends on the code being changed)

- `GroupResponse`/`TermResponse` consumers: `PanelDataContext`, `SpotkaniaView` (hand-built literals), `HomeView`, `EditTermDialog`, `AdminTermsPage`, `PublicTermView`/`TermCard`, organizer public pages, onboarding `organizerSteps.tsx`, and every test fixture typing these (see Test Coverage).
- Backend list endpoints under query budgets: organizer endpoints (`test_organizer_page_queries.py`, `test_organizer_bridges.py`).
- `AUTHORIZATION_MATRIX` table test.
- Migration chain: every migration-downgrade test crosses the new revisions.
- Notification text consumers: exact-text tests in `test_handover_copy_api.py`, `test_term_item_listings.py`, `test_term_end_scan.py`.

**Consumer Count**: ~25 production files plus ~20 test files.
**Impact Scope**: High — response schemas used across panel, public pages, admin, organizer pages and notifications; panel data model restructured.

---

## Test Coverage

### Test infrastructure

- Backend `src/backend/tests/conftest.py` (153): session `PostgresContainer("postgres:18")` (Docker required), `alembic upgrade head` once via subprocess (51-68); `db_session` outer transaction + SAVEPOINT rollback (97-114); `client` httpx `ASGITransport` with `get_db`/`get_storage` overridden (131-150); `freeze_local_now` (117-127, opt-in); `count_queries(engine)` (81-94); `MODERATION_TEXT_ENABLED=false` (43); `asyncio_mode=auto`. No shared auth fixtures — each file has `_register(client, role, email)` → `POST /api/auth/register {"role": "GUEST"|"ORGANIZER"}` and `_auth(token)`. Run: `cd src/backend && uv run python -m pytest` (plain `uv run pytest` fails — uv trampoline); `uv run python -m mypy app` (baseline ~32 errors); `uv run python -m ruff check`.
- Frontend `vitest.config.ts` jsdom + globals, setup `src/test/setup.ts` (microtask notifyManager), helpers `src/test/queryClient.tsx` (`createQueryWrapper`), `src/test/page.ts`. Run: `cd src/frontend && npm test`, `npm run lint`, `npx tsc -b`. Known baseline failures (~11, from 2026-10-13/14 work logs, not re-verified): PanelPage "hamburger promotion" ×6 (`:397-445`, clicks a "Dodaj pierwszy termin" menuitem that no longer exists), TermPage ×5, OrganizerEditor focus ×2 flaky.

### Test inventory with "will break because" notes

**Backend**

| Test file | Will break because |
|---|---|
| `tests/test_public_term.py:180-198, 243-249` | Exact `set(body.keys())` on `PublicCircleResponse` and `body["term"].keys()`; adding `location`/`capacity`/`attendee_count` breaks both. Update the expected sets. |
| `tests/test_groups.py:570` | Asserts no `PublicCircleResponse` field contains "child"; fine unless a `child_*` field is added. `:~340` idempotency of `create_own_circle` (second call ignores name) — keep. |
| `tests/test_my_attendances.py:114` | Exact key set of `MyAttendanceResponse` if location is added there. |
| `test_groups_moderation.py:136`, `test_group_privacy.py:133` (`== "PUBLIC"`), `test_rsvp.py`, `test_public_term.py`, `test_term_*.py`, `test_domain_clock_guard.py:121` and ~40 files listed by Context Discovery | All create via `POST /api/groups/mine` then RSVP as anonymous/GUEST relying on server default PUBLIC. Changing the backend default breaks most of the suite; send visibility from the frontend instead. |
| `tests/test_groups_moderation.py:112-153` | Picks fields from `ModerationTermResponse`; nullable additions are fine. |
| `tests/test_authorization_matrix.py:43-60, 161-171, 174-192` | Parametrized table of matrix rows; new `/api/locations` rows must be added and asserted. |
| `tests/test_organizer_page_queries.py:25-26`, `tests/test_organizer_bridges.py:168, 202` | SQL query budgets (`MAIN_ENDPOINT_BUDGET = 10`, `TERMS_ENDPOINT_BUDGET = 5`, must not grow with term count). Per-term location lookups exceed them. |
| `tests/test_handover_copy_api.py:114,117,196`, `tests/test_term_item_listings.py:2327`, `tests/test_term_end_scan.py:713,744,765,779` | Exact notification message text; appending a place changes it. |
| `test_group_soft_delete_migration.py:63-79` (downgrade to 0055), `test_organization_media_migration`, `test_organization_page_layout_migration`, `test_photo_moderation_attempts_migration`, `test_terms_circle_occurs_on_index_migration.py` (43) | Downgrade the shared DB below head then upgrade back; new 0057/0058 `downgrade()` must drop FKs on `groups`/`terms` before dropping `locations`. |
| `tests/test_domain_clock_guard.py:25-38` | Fails on `datetime.now(`/`date.today(` under `app/groups/application` or `app/groups/router`; new groups-side code must use `clock`/`datetime.utcnow()`. |
| `tests/test_text_moderation_org_group_term.py` (264) | Template if `TextField.LOCATION_NAME/NOTES` moderation is added. |
| `test_circles_router.py`, `test_organizer_terms.py`, `test_organizer_page*.py`, `test_public_preview.py`, `test_notifications.py` | Build/inspect group and term responses; nullable additions should pass but verify. |

**Frontend**

| Test file | Will break because |
|---|---|
| `src/test/PanelPage.test.tsx` (3204) | Module mocks replace whole modules (`../api/groups` 68-81, `../api/terms` 117-126, `../api/organizations` 127-130); new `../api/locations` is not mocked → real fetch → add `vi.mock("../api/locations")`; new functions in groups/terms factories must be added. `:614-641` walks "Możesz zostać organizatorem" → dialog "Zostań organizatorem" → "Nazwa organizacji" → `createMyOrganization("Studio Nutka")`; `:644-653` expects "Możesz zostać organizatorem" — both die with the org step. `:402-416, 478-547, 550-571, 732-790, 1857` expect title "Dodaj pierwszy termin", placeholder "np. Nutki dla starszaków", buttons "Dalej →"/"Dodaj", and `createMyCircle` called with exactly `{ name: "Nutki" }` (`:507`) — breaks once visibility/location is sent. `createTerm` exact `{circle_group_id, occurs_on, description: undefined}` (`:522-528, 1476-1482`) — breaks if `location_id`/`capacity` are sent. `:1314` `updateTerm(TERM_ID, { occurs_on })` exact. `:1522-1580` `updateGroupLayoutMode(GROUP_ID, "Nutki", "PITCH", "PUBLIC")` exact; `:3018` asserts "Lokalizacja" absent in edit-group. `:2882-2935` "+ Dodaj grupę" inline-error tests. Hints `:597-700` use `hint_*_dismissed:guest` keys and titles "Dodaj swój pierwszy termin", "Dopracuj stronę organizacji", "Ustal pierwsze spotkanie w swojej grupie.". termPublicPath links `:1646, 1777, 1818, 1867`. Inline `TermResponse`/`GroupResponse` literals (`:436, 485, 534, 690`, `mockGroup`, fixtures 221-268, 128) fail `tsc` if new fields are required. |
| `src/test/FirstTermStepperOrganizer.test.tsx` (50) | Renders without `QueryClientProvider` (10-16); mocks only `createTerm`. LocationPicker → "No QueryClient set". Labels "Data i godzina", "Opis (opcjonalnie)", button "Dodaj termin" must stay. |
| (none) | No `FirstTermStepperGuest` test file exists — new tests needed for the 2-step flow. |
| `src/test/EditTermDialog.test.tsx` (135) | Typed fixtures 28-48 (`organizer_slug: null` at 43); mocks `../api/terms` 17-22 and `../api/groups` 23-26; needs `../api/locations` mock. |
| `src/test/AdminTermsPage.test.tsx` (73) | Typed fixture 15-24; `getByText("3")`/`getByText("5")` (52-53) — a capacity column with the same numbers makes `getByText` throw. |
| `src/test/TermPage.test.tsx` (810) | Typed `PublicCircleResponse` fixture 46-80 (null slug 222); mocks `../api/groups` via `importOriginal`; 5 tests already fail at baseline. |
| `termViewModel.test.ts`, `termAccess.test.ts`, `AdminGroupsPage.test.tsx`, `DeleteGroupDialog.test.tsx`, `TermAttendeesPage.test.tsx`, `useModerationGroups.test.tsx` | Typed fixtures; break under `tsc` if new fields are required rather than optional. |
| `PublicLayout.test.tsx`, `Sidebar.test.tsx`, `SidebarAuthIntegration.test.tsx` | Menu-item counts may shift if a hamburger "Załóż grupę" item is added. |
| `OnboardingWizard.test.tsx`, `OnboardingHandoff.test.tsx` | Use "Nazwa organizacji" and `createMyCircle`; out of scope but `createMyCircle` must keep working. |
| `LayoutRenderer.test.tsx:272`, `ItemDetailPage.test.tsx:556`, `calendar.test.ts` | Assert "Dodaj grupę →" CTA and `/krag/...` URLs; sensitive to slug decision. |
| `themeDefects.test.tsx:84-92`, `themeTokenUsage.test.tsx:69-88` | List krag files by path; new krag components must follow theme tokens. |
| `NotificationBell.test.tsx` | Unaffected. |

### Coverage Assessment

- Existing coverage of the touched areas is good (PanelPage alone 3204 lines; backend has dedicated files per feature, plus migration and query-budget tests).
- Gaps: no `FirstTermStepperGuest` test; no Location tests (new module); no test of "both contexts shown at once"; Google autocomplete path only testable with `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "x")` + a fake `window.google`.

---

## Coding Patterns

### Naming Conventions

- Backend tables plural snake_case (`locations`); constraint names `pk_<table>`, `fk_<table>_<col>_<reftable>`, `uq_<table>_<cols>`, `ix_<table>_<cols>`; `owner_party_id` already used by `ItemListingPreference`.
- Schemas `Create…Request`, `Update…Request`, `…Response`, `Public…Response`; use cases `create_*`, `update_*`, `soft_delete_*`, `list_my_*`; routes full `/api/...` with `/mine` before `/{id}`.
- Backend tests `tests/test_<feature>.py`, camelCase `test_<operation>_<scenario>_<expected>` (e.g. `test_updateOrganization_nonOwnerIsRejected`), helpers `_register_organizer`, `_auth_headers`.
- Frontend api functions camelCase verbs (`getMyLocations`, `createLocation`, `updateLocation`, `deleteLocation`), hooks `useMyLocations`, components PascalCase (`components/shared/LocationPicker.tsx`), tests `src/test/<Component>.test.tsx`; UI copy Polish ("krąg" internally, "grupa" in UI).

### Architecture Patterns

- Backend groups BC: `models.py` / `schemas.py` / `service.py` facade / `application/<usecase>.py` (ownership checks, commit+refresh) / `infrastructure/repository.py` (reads only) / `infrastructure/*_acl.py`, `*_bridge.py` (only files allowed to import other BCs) / `domain/` / `router/` package. Smaller modules (`organizations`, `families`) are flat.
- Auth: `DbSession`, `ReadPrincipal = Depends(require_any("READ","mcp:read"))`, `EditPrincipal = Depends(require_any("EDIT","mcp:edit"))`; owner from `get_profile_by_principal(db, principal).party_id`, never from body. Ownership order: lookup → 404, then non-owner → 403; soft-deleted → 404 for PATCH/DELETE.
- Partial PATCH via `model_fields_set` with `ConfigDict(extra="forbid", str_strip_whitespace=True)` (organizations) — required for clearable `location_id`/`capacity`; the groups' current "`if x is not None`" style cannot clear values.
- Unique-race handling: `async with db.begin_nested(): ... except IntegrityError: re-fetch` (`circulation/application/inventory.py:40-70`).
- Frontend: TanStack Query hooks wrapping `src/api/*.ts`; key constant + module-level empty fallback; `{data, loading: isPending, error: string|null, refetch}`; mutations `await invalidateQueries(prefix)` and rethrow `serverMessageOr`. No combobox/autocomplete exists anywhere — the Google autocomplete and the "select a saved location" list are new UI; closest precedents are `role="radiogroup"` button grids and the inline edit/delete list in `EditTermDialog` (181-280, 329-429).
- Accessibility: krag `ModalSheet` (trapFocus, Esc ignoring `defaultPrevented`, focus return, `useRegisterOpenSheet`); panel `ModalSheet` lacks these — do not build new sheets on it. LocationPicker should render inline inside existing sheets; a nested "add place" sheet must use krag `ModalSheet` and the autocomplete must `preventDefault` on Esc.
- Styling: Tailwind tokens, `inputClass = "rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink"`, primary button `rounded-[13px] bg-mint ... text-white`, `<Field label>`, errors `role="alert"` `text-danger`.
- Dates only via `import dayjs from "../utils/dayjs"`; backend groups code never calls `datetime.now()`/`date.today()`.

### Convention checklist (from Pattern Mining)

1. Model extends `BaseEntity` (UUID id, `created_at`, `updated_at` optimistic lock); `__tablename__`, `Mapped[]`/`mapped_column`, `StrEnum` via `_enum_column` (VARCHAR), named FKs, nullable `deleted_at: DateTime()`; `lat`/`lng` as `Numeric(9,6)`; no `__eq__` (no business key).
2. Cross-module references are plain FK-id columns, never `relationship()`; reads via explicit joins or batched lookups through an ACL in `groups/infrastructure`.
3. Migration 0057+: UUID PK `gen_random_uuid()`, named pk/fk/ix/uq, partial unique via `postgresql_where` (`uq_locations_owner_party_id_google_place_id WHERE google_place_id IS NOT NULL`, decide whether `AND deleted_at IS NULL`), reverse-order downgrade, schema and data migrations separate; group/term FK columns in their own migration (0058).
4. Router: full `/api/...` paths, `ReadPrincipal`/`EditPrincipal`, owner from profile, `/mine` before `/{id}`, 201 on POST, 204 `response_model=None` on DELETE.
5. Matrix rows before the catch-all + asserts in `test_authorization_matrix.py`.
6. Ownership: 404 missing/soft-deleted, 403 non-owner, 409 conflicts.
7. Moderation via `check_text` before assignment if location texts are moderated (new `TextField` members).
8. Backend tests via `client`, camelCase names; non-owner 403 test; "deleted gone from /mine but still renders on term" test; migration test.
9. Frontend: `src/api/locations.ts`; `src/hooks/useMyLocations.ts` with key constant (consider token in key), stable empty array, `{data, loading, error, refetch}` + mutations invalidating the prefix and rethrowing `serverMessageOr`.
10. Accessibility: labelled inputs, `role="alert"` errors, `aria-label`s on row buttons, radiogroup/listbox semantics; any sheet uses krag `ModalSheet` + `useRegisterOpenSheet`.
11. Dates via `utils/dayjs`; Google key via `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`, manual mode when missing; add `vite-env.d.ts`, `.env.example` entry with a placeholder (never a value), Dockerfile `ARG` and compose build arg.

---

## Complexity Assessment

| Factor | Value | Level |
|---|---|---|
| File count | ~25 production files modified + ~8 new (backend module 5, migrations 2, ACL 1, frontend api/hook/component/env 4-5) | High |
| File size | `PanelDataContext.tsx` 1221, `repository.py` 1025, `schemas.py` 816, `groups.ts` 610, `public_view.py` 510, `EditTermDialog.tsx` 491 | High |
| Dependencies | Party, users, moderation, clock, notifications, Query, Google Maps JS (new external) | Medium-High |
| Consumers | Response types used by panel, public, admin, organizer pages, notifications; ~20 test files | High |
| Test coverage | Good existing coverage, but ~12 frontend and ~10 backend test files will break and need deliberate updates; Location module has none | Medium |

### Overall: Complex

Two independent scopes (A: UX/flow restructuring of the panel; B: new entity across DB, API, ACL, three frontend surfaces and an external API) sharing the same forms and tests. Scope B alone touches both migrations and every group/term response model; Scope A requires restructuring the panel's either/or data model.

---

## Key Findings

### Strengths
- Clear module templates exist for every backend piece (`organizations` module, `organizations_acl.py`, `0054`/`0056` migrations, soft-delete and partial-unique precedents, SAVEPOINT race handling).
- Frontend hook/api conventions are documented and have clean exemplars (`useCategories`, `useMyOrganization`, `useUpdateOrganization`).
- `organizer_slug ?? "krag"` guards and the slug-agnostic route already make `/krag/...` work mechanically; only the backend slug derivation decides what the link looks like.
- `CreateOwnCircleRequest.visibility` already exists; only `/mine` needs to honour it.
- `count_active_attendances_by_term` already provides the number needed for "Brak wolnych miejsc".

### Concerns
- The 13 contradictions above; especially the default-visibility and `/krag` decisions, which change acceptance criteria or dozens of tests.
- `PanelDataContext.tsx` is a 1221-line imperative `load()`; adding "both contexts" and removing `groupExtras` touches many line ranges in one file plus three views.
- Query budgets on organizer endpoints and exact-key/exact-text assertions make naive per-term lookups or text changes fail tests.
- No Google integration, env plumbing, Docker build args, or CSP exist; the key must be referrer-restricted and must never be printed in tool output, reports, or commits (`.env` stays git-ignored; only `.env.example` with placeholders).
- `FirstTermStepperOrganizer.test.tsx` and PanelPage/EditTermDialog tests mock whole API modules; an unmocked `../api/locations` causes real network calls in jsdom.
- Groups' `update_group`/`update_term` cannot clear fields; `location_id`/`capacity` need `model_fields_set` semantics or they can never be reset to null.
- Soft-deleted Location must still render on existing terms/groups: ACL lookup by id must not filter `deleted_at`; only `/mine` filters.

### Opportunities
- Replace `groupExtras` entirely with server data (`GroupResponse.default_location`/`default_capacity`), removing the frontend-only state.
- Reuse `PublicCircleOrganization`-style allowlisted public mapper for `PublicLocationResponse` (no `owner_party_id`).
- Update stale standards (`models.md` UUID/soft-delete, `migrations.md`, `backend-testing.md`) as a follow-up `/maister:standards-update`.

---

## Impact Assessment

- **Primary changes (backend)**: new `app/locations/{__init__,models,schemas,service,router}.py`; `alembic/versions/0057_locations.py` (table + indexes + partial unique) and `0058_group_term_location_capacity.py` (`groups.default_location_id`, `groups.default_capacity`, `terms.location_id`, `terms.capacity`, named FKs); `app/groups/models.py`; `app/groups/schemas.py` (GroupResponse, CreateOwnCircleRequest wiring, UpdateGroupRequest, TermResponse, CreateTermRequest, UpdateTermRequest, ModerationTermResponse, PublicTermResponse incl. `attendee_count`, optionally OrganizerTermResponse/MyAttendanceResponse); `application/circles.py` (visibility through `create_own_circle`, location/capacity on create/update), `application/terms.py` (inherit defaults, validate ownership, clearable updates), `application/public_view.py`, `router/circles.py`, `router/terms.py` (batched location attach), new `infrastructure/locations_acl.py`, `repository.py` (batch lookups), `core/authorization_matrix.py`, `main.py`, optionally `domain/organizer_slug.py` (krag) and `moderation/text_guard.py`.
- **Primary changes (frontend)**: `api/locations.ts`, `hooks/useMyLocations.ts`, `components/shared/LocationPicker.tsx` (+ Google loader), `src/vite-env.d.ts`, `src/frontend/.env.example`; `api/groups.ts`, `api/terms.ts` types; `FirstTermStepperGuest.tsx` (drop org step, send visibility + location/capacity, done-screen "Stwórz wizytówkę" CTA), `FirstTermStepperOrganizer.tsx`, `PanelModals.tsx`, `PanelDataContext.tsx` (remove `groupExtras`, both-contexts `load()`, forms, hints), `HomeView.tsx`, `SpotkaniaView.tsx`, `panelHelpers.ts` (`ModalKind`), `AccountMenu.tsx` ("Załóż grupę"), `EditTermDialog.tsx`, `AdminTermsPage.tsx`, `krag/PublicTermView.tsx` + `components/TermCard.tsx`.
- **Related changes**: `src/frontend/Dockerfile`, `docker-compose.yml` (build arg), root/frontend `.env.example` placeholders, notification text builders (`term_item_listings.py`, `outbox_listener.py`, `term_end_scan.py`, `pledges.py`) if place is appended, organizer public pages (optional), `organizerSteps.tsx` only if shared components force it, standards docs.
- **Test updates**: as inventoried above; new backend `tests/test_locations.py`, `tests/test_locations_migration.py`, matrix rows; new frontend `FirstTermStepperGuest.test.tsx`, `LocationPicker.test.tsx`, `useMyLocations.test.ts`; wrap `FirstTermStepperOrganizer.test.tsx` in `createQueryWrapper()`; add `vi.mock("../api/locations")` to PanelPage/EditTermDialog tests; update exact-key sets and exact-args assertions.

### Risk Level: Medium-High

Cross-cutting schema changes with many exact-assertion tests, two chained migrations with downgrade tests, a large stateful panel context to restructure, a new external dependency that must degrade gracefully without a key, and several acceptance criteria that conflict with current backend behaviour. Mitigated by strong templates and existing test coverage.

---

## Recommendations

This is a "modify existing + create new capability" task.

1. **Resolve the contradictions in the specification first**: (a) `/krag` — change `derive_organizer_slug` to return `"krag"` for groups without an Organization, or rewrite the criterion to "link to the public term page" (decide explicitly; changing the slug affects `ItemDetailPage.test.tsx`, `calendar.test.ts`, and OG links). (b) Visibility — keep backend default PUBLIC; frontend sends `visibility` (PRIVATE when `organizationSlug === null`, PUBLIC otherwise), `POST /mine` passes `body.visibility` to `create_own_circle`; keep idempotency. (c) `attendee_count` on `PublicTermResponse` from active attendances. (d) Notifications — append place text with the 500-char cap or leave for a later iteration; update exact-text tests either way.
2. **Backend Location as a new `app/locations` module** (not inside groups): ownership is party-scoped (`profile.party_id`, a PERSON Party), reused across groups/terms, whereas `Group.party_id` is a per-circle ORGANIZATION Party. Groups consume it through `groups/infrastructure/locations_acl.py` (`get_owned_location`, batched `get_locations_by_ids` including soft-deleted, `location_response`/`public_location_response`). Matrix rows: `(PATCH,DELETE) ^/api/locations/[^/]+$ EDIT`, `GET ^/api/locations(/.*)?$ READ`, `POST ^/api/locations(/.*)?$ EDIT`, placed before the catch-all.
3. **Migrations**: 0057 `locations` table (template 0054; `Numeric(9,6)` lat/lng; `source` VARCHAR(10); `ix_locations_owner_party_id`; partial unique on `(owner_party_id, google_place_id) WHERE google_place_id IS NOT NULL`), 0058 FK columns on `groups`/`terms` (template 0056). Downgrade 0058 drops FKs/columns before 0057 drops the table. Add migration tests on the `test_group_soft_delete_migration.py` template.
4. **Term inheritance** in `create_term` step 5: if `data.location_id is None` copy `group.default_location_id`; if `data.capacity is None` copy `group.default_capacity`; copy values, never link. Validate a supplied `location_id` belongs to the caller via the ACL (404/403 as per convention). Use `model_fields_set` for `UpdateTermRequest`/`UpdateGroupRequest` so null can be set explicitly.
5. **Batched reads**: resolve locations with one `IN` query per list endpoint and attach after `model_validate`, like `organizer_slug`/`attendee_count`, to respect `test_organizer_page_queries.py` budgets.
6. **Frontend**: `api/locations.ts` + `useMyLocations` (useCategories/useMyOrganization template, token in key), `LocationPicker` inline in existing sheets (saved list as radiogroup/listbox; "+ Dodaj nowe miejsce" with Google autocomplete when `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` is set, manual form otherwise; session tokens; lazy script load on interaction; Esc `preventDefault`). Remove `groupExtras`; read `default_location`/`default_capacity` from `GroupResponse`; pre-fill term forms from the group. Make all new TS fields `| null`/optional and update `SpotkaniaView.tsx:127-156` literals.
7. **Panel both-contexts**: restructure `load()` to populate `myGroups` and `guestCircles` independently; replace `relevantGroupsForForm` and the `isOrganizer` view branches; rename hints ("Załóż grupę" / "Stwórz wizytówkę"); add hamburger item; remove `"zostan-organizatorem"` modal kind or repurpose it as the organization-only action pointing at `createMyOrganization`/`/organization`.
8. **Testing strategy**: backend 2-8 tests per group — Location CRUD + non-owner 403 + soft-delete visibility + unique place_id 409 + term inheritance + public response shape + matrix rows + migration; frontend — new Guest stepper test (2 steps, PRIVATE default, done link), LocationPicker manual mode and Google mode via `vi.stubEnv` + fake `window.google`, updated PanelPage/EditTermDialog/AdminTermsPage/TermPage fixtures and exact-arg assertions. Do not run `env`/`cat .env`; presence checks only.
9. **Config**: `src/frontend/src/vite-env.d.ts`, `src/frontend/.env.example` with `VITE_GOOGLE_MAPS_API_KEY=` placeholder, `ARG VITE_GOOGLE_MAPS_API_KEY` in `src/frontend/Dockerfile` builder stage and `docker-compose.yml` build args; document Google caching terms (place_id storable indefinitely; lat/lng/address subject to cache limits, refresh out of scope).
10. **Follow-up standards update**: `models.md` (UUID PKs, soft delete exists, no relationships in groups), `migrations.md`, `backend-testing.md` (pytest/testcontainers), via `/maister:standards-update` after user approval.

---

## Next Steps

Invoke the gap-analyzer with this report and the task description. The gap analysis should start from the "Contradictions" table and produce explicit decisions for: `/krag` slug behaviour, visibility wiring, `attendee_count` on the public term, notification text scope, Location module placement (recommended `app/locations`), and clearable-field semantics, before the specification is written.
