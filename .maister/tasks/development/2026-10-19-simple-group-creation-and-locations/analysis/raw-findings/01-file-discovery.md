# Raw findings: File Discovery (Explore agent)

Paths relative to repo root. Frontend: `src\frontend\src\` (React 19, Vite 8, TS 5.9, react-query 5, Chakra only in admin pages, Tailwind). Backend: `src\backend\app\` (FastAPI, async SQLAlchemy, hand-written Alembic).

## Things the spec will need to handle

1. **The `/krag/` fallback is almost never reached.** Backend always returns non-null `organizer_slug` on GroupResponse from /mine, /mine/new, PATCH and GET /{id}. Without an Organization it uses `k-<blake2s hash>` (`groups/domain/organizer_slug.py:11-34`, `groups/infrastructure/slug_resolver.py:18`). Schema still types it nullable (`schemas.py:37`). URL slug segment is cosmetic: lookups go by group_id/term_id only. "krag" is a reserved Organization slug (`organizations/slugs.py:24`). Today's links look like `/k-abc123/grupa/...`, not `/krag/grupa/...`. Acceptance criterion "link pod /krag/..." means either changing `derive_organizer_slug` to return "krag", or changing the criterion.
2. **The panel cannot show both contexts at once today.** `load()` in `PanelDataContext.tsx:456-470` sets `guestCircles=[]` as soon as there is any active leadership. `relevantGroupsForForm` (`:1091`), `if (isOrganizer)` branches in SpotkaniaView (`:128`, `:158`) and HomeView card at `:133` are built on that either/or.
3. **No notification currently carries meeting details.** NotificationResponse is only `message` + `link_path`. The only term detail is the term-end message suffix "(day, group_name)", built from `details_by_term` (`term_end_scan.py:206-216`) and rendered by `_term_suffix` (`outbox_listener.py` ~85).
4. **Two places build fake GroupResponse/TermResponse objects by hand**: `SpotkaniaView.tsx:133-152` and test fixtures (`EditTermDialog.test.tsx:43`, `PanelPage.test.tsx:221-268`).
5. **Visibility defaults to PUBLIC on both sides today.** Backend: `Group.visibility` server_default "PUBLIC" (`models.py:113-117`), `create_own_circle` ignores visibility. Frontend: `groupForm` defaults PUBLIC (`PanelDataContext.tsx:310`). `organizationSlug` (`:215`, loaded `:416-422`) is the existing "has an Organization" signal.
6. **The public term payload has no attendee count.** PublicTermResponse (`schemas.py:284`) lacks `attendee_count`; the public page counts `guardians[]`.
7. **Google is not wired anywhere yet.** No `import.meta.env` usage, no `vite-env.d.ts`, no Maps package. `tsconfig.app.json` has `types: ["vite/client"]`. Root `.env.example` has backend keys only; `docker-compose.yml` and `src/frontend/Dockerfile` have no VITE entries.

## 1. Panel group-creation flow (ranked)

1. `src\frontend\src\pages\panel\PanelDataContext.tsx` (1221 lines)
   - isOrganizer: line 230 `profile?.is_organizer === true || myGroups.length > 0` (rationale comment 217-229).
   - groupExtras: line 293 `useState<Record<string,{location;freeSpots}>>`. Written 604-609 (handleAddGroup) and 970-984 (saveEditGroup); read 935-940 (startEditGroup); exported 1144.
   - Hint keys 259-281: `hint_first_term_dismissed`, `hint_become_organizer_dismissed`, `hint_org_first_term_dismissed`, `hint_org_polish_dismissed`, per account via `hintKey()` at 132.
   - `firstTermForOrganizer` 255. `editGroupForm` {name, location, freeSpots, layoutMode, visibility} 202-208. `groupForm` {name, location, freeSpots, visibility} 305-310. Add-term form 313-319. `load()` 332-488.
   - `handleAddGroup` 592 → `createAdditionalMyCircle`. `handleAddTerm` 647 → `createTerm` 660.
   - `signupSummaryChip` 818. `organizerTermCard` 851-930 (uses `termPublicPath`, copy-link 907).
   - `startEditGroup`/`cancelEditGroup`/`saveEditGroup` 934/948/954 (`updateGroupLayoutMode` 966). `relevantGroupsForForm` 1091. `editTermEntry` 1094.
2. `src\frontend\src\components\panel\FirstTermStepperGuest.tsx` (227)
   - `withOrganizationStep` prop 29/41; initial step 46; `createMyOrganization` 61. Circle step `createMyCircle` (75); term step `createTerm` (91).
   - "Zostań organizatorem": title line 102, comments 20-21, 27. Steps array 103.
   - Done screen 105-127: link 113 `/${circle.organizer_slug ?? "krag"}/grupa/${circle.id}/term/${createdTermId}`; "Gotowe" 123. Field "Nazwa kręgu" 165.
3. `src\frontend\src\components\panel\FirstTermStepperOrganizer.tsx` (111) — one-step term form. Done link 59; "Gotowe" 69; fields 78-95.
4. `src\frontend\src\pages\panel\PanelModals.tsx` (377)
   - "pierwszy-termin" modal 63-90. "zostan-organizatorem" modal 92-104: `withOrganizationStep={organizationSlug === null}` (95); toast "Jesteś organizatorem — dodano pierwszy termin" (100).
   - "Dodaj nową grupę" modal 139-198: "Lokalizacja" 151, "Ile miejsc" 159, visibility select 170-185, button 195.
   - "Edytuj grupę" modal 201-279: "Lokalizacja" 213, "Ile miejsc" 221.
   - "Dodaj termin zajęć" modal 282-374. EditTermDialog mount 119-136.
5. `src\frontend\src\pages\panel\views\HomeView.tsx` (290)
   - Hints: hint_first_term 71-83; hint_become_organizer 85-94 (title "Możesz zostać organizatorem" 88, `setModal("zostan-organizatorem")` 91); hint_org_polish 96-105; hint_org_first_term 107-119.
   - Term cards: organizer branch 133; guest Link card 134-163. "Zapisane zajęcia" links 190 use `/${a.organizer_slug}/grupa/...`.
6. `src\frontend\src\pages\panel\views\SpotkaniaView.tsx` (326) — reads `groupExtras` 85 and 183. Fake term/group objects 127-156. "+ Dodaj grupę" (`setModal("grupa")`) 172-176. Group tile shows `extra.location` and "wolne N miejsca" 220-229. FAB "Dodaj termin" 263-269. Guest term card 287-320.
7. `src\frontend\src\pages\panel\panelHelpers.ts` (111) — `ModalKind` 24-32 includes `"zostan-organizatorem"` (29), `"pierwszy-termin"`. `termPublicPath(group, termId)` 109-111 → `/${group.organizer_slug ?? "krag"}/grupa/${group.id}/term/${termId}`.
8. `src\frontend\src\components\shared\AccountMenu.tsx` (80) — hamburger: Profil, Ustawienia, "Moja organizacja" (63-70 → `/${slug}` or `/organization`), Mój dom, plus `extraItems`. No "Załóż grupę" item today. Comment 57-62.
9. `PanelPage.tsx` (96), `PanelNav.tsx` (56), `panelComponents.tsx` (203: ModalSheet, Field, HintCard ~107, FloatingAddButton), `panelDataStore.ts` (16).
10. `src\frontend\src\api\organizations.ts` (100) — `createMyOrganization` 69 (POST /organizations/mine), `getMyOrganization` 65. Other callers: `components/onboarding/steps/organizerSteps.tsx:5,35`, `pages/OrganizationPage.tsx:4,68` (the /organization create form — natural "Stwórz wizytówkę" target).
11. Other "organizator" wording (per-group role, probably stays): `RegisterPage.tsx:23-64`, `PrivateGroupGate.tsx:144-243`, `GroupVisualization.tsx:142/187/252`, `TermCard.tsx:31`, `GroupHeader.tsx:46`, `PublicTermView.tsx:155`, `RequestAccessDialog.tsx:120`, `problem.ts:60`.

Every "Zostań organizatorem" occurrence: `FirstTermStepperGuest.tsx` 20-21, 27, 102; `PanelModals.tsx` 92; `panelHelpers.ts` 29; `HomeView.tsx` 88, 91; `PanelPage.test.tsx` 614, 623, 627, 638, 652.

## 2. Group and term forms and displays

1. `components\panel\EditTermDialog.tsx` (491) — `occursOn`/`description` state 124-125; PATCH 187-197 (`updateTerm`); fields "Data i godzina" 285, "Opis" 297; needed-items sub-CRUD after.
2. `pages\AdminTermsPage.tsx` (65) — Chakra AdminTable columns Date, Circle, Description, Signups, Children (line 34). Uses `useModerationTerms`.
3. `pages\krag\PublicTermView.tsx` (251) — public term AND group page (no separate public group page). GroupHeader 203 (subtitle = `term.description`), TermCard 224, NeededItemsSection, AttendeeList 228, TermFooter (RSVP) 242, `organizer_slug ?? "krag"` 191.
4. `pages\krag\components\TermCard.tsx` (36) — date card taking only `{date}`. Natural spot for location and capacity.
5. `pages\krag\TermPage.tsx` (52) route element for `/:organizationSlug/grupa/:groupId/term/:termId`. Related: `PrivateGroupGate.tsx` (256), `GroupHeader.tsx` (57), `TermFooter.tsx` (28), `termViewModel.ts`, `hooks/useTermSignUp.ts`, `hooks/useTermAccess.ts`.
6. `router.tsx` — public term route 155, comment about removed `/krag/:groupId` route 144-153, `/organization` 78, `/:organizationSlug/terminy` 163.
7. Notifications: `components/shared/NotificationBell.tsx` (85) renders `n.message` (76), navigates to `link_path` (19). Also `components/pending/PendingActionsHost.tsx`.
8. Organizer public pages listing terms (optional): `pages/organizer/OrganizerTermsPage.tsx` (120), `blocks/UpcomingTermsBlock.tsx` (105), `blocks/NextTermCtaBlock.tsx`.

## 3. Frontend data layer

1. `api\groups.ts` (610) — `GroupResponse` 18-27 (id, party_id, name, organizer_slug, layout_mode, visibility, created_at, updated_at). `CreateCircleRequest` 29-32. `ModerationGroupResponse` 37 (term_count). `createMyCircle` 107 (POST /groups/mine, idempotent). `createAdditionalMyCircle` 114 (POST /groups/mine/new). `updateGroupLayoutMode(id, name, layoutMode, visibility?)` 126-137 (PATCH /groups/{id}). `PublicTermResponse` 187-193, `PublicCircleResponse` 216-226. `MyAttendanceResponse` ~514-523.
2. `api\terms.ts` (108) — `TermResponse` 4-16, `ModerationTermResponse` 20-29, `CreateTermRequest` 31-35, `UpdateTermRequest` 69-72, `createTerm` 65, `updateTerm` 74.
3. `api\client.ts` (108) — `api.get/post/patch/delete/upload`, `/api` prefix, Bearer from localStorage; `ApiError`.
4. `api\queryClient.ts` (17); `src/test/queryClient.tsx` (25).
5. Hooks templates: `hooks\useModerationTerms.ts` (38), `useMyOrganization.ts` (73), `useMyOrganizationSlug.ts` (7), `useUpdateOrganization.ts` (46), `useOrganizerTerms.ts` (65), `useTermAttendees.ts` (86).
6. `utils\dayjs.ts` (34); `utils/url.ts`, `utils/plural.ts` (`pluralPl`), `utils/calendar.ts`.
7. Env: none in frontend. `vite.config.ts` (23). Root `.env.example` backend keys only.

## 4. Backend groups bounded context

1. `app\groups\models.py` (416) — Group 97-123 (party_id, name, layout_mode, visibility server_default PUBLIC, deleted_at, deleted_by_party_id). Term 221-239 (circle_group_id, occurs_on, description; Index 227). TermAttendance 294-320 (child_count, withdrawn_at). GroupRole, Leadership, Membership, GroupJoinRequest. `_enum_column` helper.
2. `app\groups\schemas.py` (816) — GroupResponse 31-41. UpdateGroupRequest 72-81. CreateOwnCircleRequest 88-90. ModerationTermResponse 134-145. TermResponse 148-158. CreateTermRequest 161-164. UpdateTermRequest 167-169. PublicTermResponse 284-289. PublicCircleResponse 308-323. GroupAccessResponse 344. MyAttendanceResponse 500-515.
3. `app\groups\router\circles.py` (369) — POST /api/groups 64. POST /api/groups/mine 74 (`create_own_circle(db, party_id, body.name)`; visibility ignored). POST /api/groups/mine/new 89-106 (passes visibility). GET /public/{id} 115; /access 135; RSVP 153; /mine/attendances 227. PATCH /{id} 274-284. DELETE 287. GET /{id} 300. Each handler sets `response.organizer_slug = await service.resolve_organizer_slug(...)`.
4. `app\groups\router\terms.py` (134) — POST /api/terms 38, GET list with counts 46-64, /moderation 67, GET /{id} 77, PATCH /{id} 83.
5. `app\groups\router\__init__.py` (40) — sub-router order matters.
6. `app\groups\application\circles.py` (348) — `create_circle` 43 (creates ORGANIZATION Party). `create_own_circle` 65 (idempotent; no visibility). `create_additional_circle` 93. `update_group` 220. `soft_delete_group` 173. `_is_active_organizer`/`_require_active_organizer` 338/346.
7. `app\groups\application\terms.py` (279) — `create_term` 32-44. `list_terms_with_counts` 67. `list_terms_for_moderation` 86-110. `update_term` 113-129. Notification link_path "/panel" ~276.
8. `app\groups\application\public_view.py` (510) — `get_public_circle_view` 183-329 (PRIVATE reduced branch ~229; PublicCircleResponse 318). `list_my_attendances` 96. `create_rsvp` 401.
9. `app\groups\service.py` (175) — facade re-exporting application functions.
10. `app\groups\infrastructure\repository.py` (1025) — `get_term` 285, `list_terms_for_group` 318, `list_terms_for_moderation` 336, `count_active_attendances_by_term` 475, `list_groups_for_moderation` 103.
11. Slug: `groups\domain\organizer_slug.py` (34), `groups\infrastructure\slug_resolver.py` (36). Link builders: `application/pledges.py:52-60`, `application/term_end_scan.py:205-216`.
12. Notifications: `app\notifications\outbox_listener.py` (136), `notifications\service.py` (90), `groups\infrastructure\notifications_bridge.py` (38).
13. Party: `app\party\models.py` (54; Party(party_type, active), PartyType PERSON/ORGANIZATION). `owner_party_id` FKs point to "parties.id".
14. Module template: `app\organizations\` (models.py 228, schemas.py 134, service.py 204, router.py 141); `core/base_model.py` (68, BaseEntity UUID id, created_at/updated_at).
15. Alembic: `src\backend\alembic\versions\`. Head "0056" (`0056_group_soft_delete.py`, down "0055"). Next 0057. `env.py` `target_metadata = None` → hand-written. Examples: 0053 (index), 0054 (organization_media new table), 0055.
16. `app\main.py` (160) router registration 146-160: ... groups (154), organizations (155), families, circulation, notifications, moderation, system_router last.
17. `app\core\authorization_matrix.py` (269) — organizations pattern 195-201; catch-all AUTHENTICATED 248; group rows 81-135; term rows 163-166.
18. `app/users/schemas.py:55`, `users/router.py:53` define `is_organizer`.

## 5. Tests

Backend (`src\backend\tests\`; testcontainers Postgres + `alembic upgrade head`, `conftest.py` 153 lines): `test_groups.py` (762), `test_circles_router.py` (299), `test_promotion.py` (98), `test_public_term.py` (657), `test_groups_moderation.py` (248), `test_organizer_terms.py` (105), `test_rsvp.py` (281), `test_term_attendees.py` (260), `test_my_attendances.py` (242), `test_group_privacy.py` (360), `test_group_soft_delete*.py` (5 files; `_migration.py` 79 is a migration-test template), `test_terms_circle_occurs_on_index_migration.py` (43), `test_authorization_matrix.py` (216), `test_text_moderation_org_group_term.py` (264), `test_notifications.py` (232), `test_term_end_scan.py` (892), `test_public_preview.py` (149), `test_organizations.py` (452).

Frontend (`src\frontend\src\test\`):
- `PanelPage.test.tsx` (3204): guest 2-step flow 478, done link 537; "Zostań organizatorem" 3-step 614-640; hint tests 605, 646-681; auto-hide 730-774; "Gotowe" clicks 540, 768, 799, 960, 1000, 2802; "Edytuj grupę" 1530-1578 and 2991-3018 ("Lokalizacja" asserted absent at 3018); "+ Dodaj grupę" 2893-2937; termPublicPath links 1646, 1777, 1818, 1867; hamburger-promotion describe 397; fixtures 221-268, 128.
- `FirstTermStepperOrganizer.test.tsx` (50). No FirstTermStepperGuest test file.
- `EditTermDialog.test.tsx` (135; `organizer_slug: null` at 43), `AdminTermsPage.test.tsx` (73), `TermPage.test.tsx` (810; null slug 222), `GroupVisualization.test.tsx`, `DeleteGroupDialog.test.tsx`, `AdminGroupsPage.test.tsx`, `OrganizationPage.test.tsx`, `OnboardingWizard.test.tsx`/`OnboardingHandoff.test.tsx` (mock createMyOrganization), `useOrganizationHooks.test.tsx`, `NotificationBell.test.tsx`, `url.test.ts`.
- Theme guard tests (`themeDefects.test.tsx` 84-92, `themeTokenUsage.test.tsx` 69-88) list krag files by path.
