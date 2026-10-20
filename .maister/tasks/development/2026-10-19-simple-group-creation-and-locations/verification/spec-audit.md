# Spec Audit: Simple group creation + Location entity

**Spec**: `implementation/spec.md` (490 lines)
**Date**: 2026-10-19
**Method**: every cited file:line, import chain, migration head, test assertion and router/param mechanism was checked directly in the repo (`src/backend`, `src/frontend`). Test suites were not run. No secrets were read or printed (presence check only: no `VITE_` entry exists in the root `.env.example`, no `src/frontend/.env.example`, no `src/vite-env.d.ts` — as the spec states).

## Verdict: PASS WITH CONCERNS

- Critical: 0
- Major: 3
- Minor: 11
- Ambiguities / clarification questions: 6

The spec is thorough, nearly every citation is accurate, the architecture is implementable (no import cycle, migration chain correct, `model_fields_set` feasible, query budgets untouched), scope A1–A7 / B8–B17 is fully covered, every acceptance criterion maps to §11 with the `/krag` reinterpretation and notification exclusion made explicit, and out-of-scope items are not silently pulled in. Three issues should be resolved before planning: an unstated behaviour regression for family-member guests, a wrong assumption that the panel has a hamburger menu (which also makes one test-plan item unimplementable), and an open choice between the legacy and the new Google Places API.

---

## Verified as correct (evidence)

| Claim | Evidence |
|---|---|
| Alembic head is `0056`, next are 0057/0058 | `alembic/versions/0056_group_soft_delete.py:23-24` (`revision="0056"`, `down_revision="0055"`); no 0057 exists |
| Migration tests downgrade below head and back | `tests/test_group_soft_delete_migration.py:63-79` runs `alembic downgrade 0055` then `upgrade head` — crosses 0058→0057→0056, so the ordering "0058 drops FKs before 0057 drops the table" is the right requirement |
| No import cycle via `locations_acl` | `app/groups/schemas.py` imports only `app.circulation.models`, `app.users.schemas`, `.models` (lines 12-15). A `locations_acl.py` importing `app.locations.*` + `app.core.errors` + `app.users.service` is cycle-free: `app/users/service.py:15-30` imports auth/config/core/moderation/outbox/party/storage — none import `app.groups` (grep over `app/` shows `app.groups` is imported only by `families`, `circulation/router`, `product/router`, `main`, `system`, `users/router` — never by `users/service`). `app/groups/infrastructure/__init__.py` is empty. Caveat: the template `organizations_acl.py:17` imports `..schemas`; the new ACL must NOT do that (spec §6.7 already implies this) |
| `model_fields_set` feasible | `router/terms.py:88` passes the whole `UpdateTermRequest` to `service.update_term`; `router/circles.py:279-281` passes `body.name, body.layout_mode, body.visibility` positionally, so `update_group` needs a signature change — spec §6.8 says so. `CreateTermRequest` is passed whole (`terms.py:32`), so omitted-vs-null is feasible. `UpdateGroupRequest` has no `extra="forbid"` today (`schemas.py:72-81`) — consistent with the spec |
| Template `model_fields_set` pattern exists | `app/organizations/schemas.py:93-112`, `service.py:157-172` |
| `count_active_attendances_by_term` signature | `repository.py:475-492`, returns `{term_id: (count, child_sum)}`; terms without active RSVPs absent |
| `list_my_attendances` structure | `public_view.py:96-133`; `list_my_attendances_joined` already excludes withdrawn rows (`repository.py:498-510`) |
| Query budgets unaffected | `tests/test_organizer_page_queries.py` budgets only `/api/groups/public/organizers/{slug}` and `/terms` (lines 60-85) plus a `product_photos`-only count on `/access` (105-115); `test_organizer_bridges.py:168,202` count bridge calls with empty input. None of the extended endpoints is budgeted; the spec's "one batched query" rule plus the new count-does-not-grow test is sound |
| Exact-key assertions | `tests/test_public_term.py:180-198, 243-249`; `tests/test_my_attendances.py:114-123`; `tests/test_groups.py:565-571` ("child" check — `attendee_count` is safe) |
| Matrix | rows 177-201 and catch-all at `:248` match; methods in the three new rows are disjoint so order among them is irrelevant; the test file structure (`:43-60, 161-192`) matches |
| `main.py` router order | `:146-160`, `organizations_router` at 155, `system_router` last |
| Soft delete / SAVEPOINT / enum helpers | `circles.py:173-201` (`datetime.utcnow()` at 193), `repository.py:69-80`, `inventory.py:40-70`, `models.py:28-35` `_enum_column`, `base_model.py:41-66` UUID PK |
| Clock guard | `tests/test_domain_clock_guard.py:25-38` guards `app/groups/application` and `app/groups/router` only — `app/locations` is outside, as the spec says |
| Frontend citations | `PanelDataContext.tsx` 202-208, 230, 293, 305-310, 455-470, 600-609, 818, 851, 935-940, 966-984, 1091, 1144; `HomeView.tsx` 70-119, 134-163, 190; `SpotkaniaView.tsx` 127-156, 158-176, 220-229, 263-269, 287-321; `PanelModals.tsx` 63-104, 139-198, 170-185, 201-279, 331-363; `panelHelpers.ts` 24-32, 109-111; `FirstTermStepperGuest.tsx` 20-27, 102, 105-127, 165; `FirstTermStepperOrganizer.tsx` 59, 78-95; `AccountMenu.tsx` 50-75; `EditTermDialog.tsx` 122-128, 186-197; `TermCard.tsx` (`{date}` only); `AdminTermsPage.tsx` 33-60; `api/groups.ts` 18-27, 107-139, 187-193, 514-523; `api/terms.ts` 4-35, 69-77; `ColorsTab.tsx:53-75`; `useMyOrganization.ts:45-49`; `useCategories.ts` hook shape; `DeleteGroupDialog.tsx` (`alertdialog`, `useRegisterOpenSheet`, Esc ignoring `defaultPrevented` at :61); `krag/ModalSheet.tsx:47-50` — all match |
| Test citations | `PanelPage.test.tsx` 68-81, 397-416, 507, 522-528, 614-653, 1314, 1476-1482, 1522, 3018; `FirstTermStepperOrganizer.test.tsx:10-16` (no QueryClient, mocks only `createTerm`); `AdminTermsPage.test.tsx:15-24, 52-53`; `TermPage.test.tsx:46-80`; `createQueryWrapper` in `test/queryClient.tsx:16` — all match |
| `?nowa=grupa` entry | `/panel/:view` route exists (`router.tsx:100-102`); `PanelDataContext` derives `view` from `useParams` (`:171, 232`) and uses `useLocation` only for pathname transitions (`:512-521`), so a query param does not trigger a reload; `useSearchParams` is used elsewhere (`AuthGuard`, `EditorSheet`) so the pattern is established. `PanelPageView` is inside `PanelDataProvider` (`pages/panel/PanelPage.tsx:33-38`) and can call `setModal` |
| Env/build plumbing gaps | `tsconfig.app.json:8` has `"types": ["vite/client"]`; no `src/vite-env.d.ts`; `src/frontend/Dockerfile` has no `ARG`; `docker-compose.yml` has no `args`; no Google package in `package.json` |
| Standards respected | data-fetching (hook in `src/hooks/`, prefix key, token in key per `useMyOrganization`, `await invalidateQueries`, `extractProblemMessage` rethrow), a11y (`useRegisterOpenSheet`, no nested anchors, labelled inputs, radiogroup/combobox roles), time (`datetime.utcnow()` for `deleted_at`), models (plain FK ids, `Numeric(9,6)`, no `__eq__`) — stale PK/soft-delete parts of `models.md`/`migrations.md` are flagged, not followed |

---

## Major

### M1. Family-member guests lose their circle terms (unstated behaviour regression)

**Spec**: §3 A6 and §7.7 — "Led terms (`getTerms` + `getNeededItems`) for `myGroups` only; attended terms come from `myAttendances`"; `guestCircles` is still populated "(no longer zeroed)" but nothing in the spec consumes it (`relevantGroupsForForm` becomes `myGroups`).

**Evidence**: today a user with no leadership gets `relevantGroups = guestCircles` (family memberships) and `terms` is built from `getTerms()` over those circles (`PanelDataContext.tsx:461-481`). Those terms feed Home "Najbliższe terminy" (`HomeView.tsx:133-163`) and Spotkania (`SpotkaniaView.tsx:127-156`, `guestTerms`) even when the user has not RSVPed. Under the spec, a family member of a (typically PRIVATE) circle who has not yet RSVPed sees nothing about that circle's upcoming terms anywhere in the panel; `guestCircles` becomes dead state. The brief's A6 asks for "grupy, w których jestem gościem" (membership), not only RSVPs. No existing PanelPage test covers non-empty memberships (`getMembershipsForFamily` is mocked to `[]` everywhere — `PanelPage.test.tsx:362`), so this would ship silently.

**Category**: Incomplete / Ambiguous. **Severity**: Major — removes an existing capability for the private-circle persona the product is built around.

**Fix**: decide explicitly in §7.7 and the mockups: either (a) keep loading `getTerms` for `guestCircles` and show them in "Zapisane" (or a third "Moje grupy" block) deduped against attendances, with a new PanelPage test for a family member with no RSVP; or (b) drop them deliberately, delete `guestCircles`/`getMembershipsForFamily` from `load()` (minimal-implementation standard) and record the decision in requirements.md.

### M2. The panel has no hamburger; "hamburger" entry point and its test-plan item are mis-targeted

**Spec**: A1 lists "hamburger `AccountMenu` item" as one of three panel entry points; §9.1 says `PanelPage.test.tsx:397-445` "hamburger promotion" tests are to be "rewritten for the hamburger 'Załóż grupę' link"; mockup 5 draws "≡ 🔔 ☰" on the PanelPage header and mockup 7 says "Mój panel (only outside the panel)".

**Evidence**: `AccountMenu` is rendered only by `components/layout/PublicLayout.tsx:36`; the `/panel` and `/panel/:view` routes are siblings of the `PublicLayout` layout route, not children (`router.tsx:78-102`), and neither `PhoneFrame` nor `PanelNav` renders a menu (`grep aria-label="Menu"` hits only `AccountMenu.tsx:29`). The 6 "hamburger promotion" tests fail at baseline precisely because `openMenu()` (`PanelPage.test.tsx:392-395`) finds no "Menu" button in `renderPanel()` (`:311-319`, PanelPage only). Rewriting them for a "Załóż grupę" menuitem cannot pass.

**Category**: Incorrect. **Severity**: Major — one of the three advertised entry points does not exist inside the panel, and a listed test deliverable is unimplementable as written.

**Fix**: state that the hamburger entry lives on public pages (item pages, public term pages, organization pages) and deep-links into the panel via `?nowa=grupa`; replace the §9.1 item with "delete the 6 baseline-failing hamburger-promotion tests in `PanelPage.test.tsx:397-445`; cover the new menuitem in `PublicLayout.test.tsx` (href `/panel/spotkania?nowa=grupa`) and the `?nowa=grupa` -> stepper opening in `PanelPage.test.tsx` via `renderPanel("/panel/spotkania?nowa=grupa")`". Correct mockup 5's header and mockup 7's "(only outside the panel)" note. If an in-panel hamburger is actually wanted, that is a new UI element and must be specified (and `NotificationBell` placement reconsidered).

### M3. Google Places: legacy vs new API left open; loader contract under-specified

**Spec**: §7.2 — "`AutocompleteService.getPlacePredictions` (or Places API New `AutocompleteSuggestion.fetchAutocompleteSuggestions`)"; loader "injects `libraries=places&loading=async`" and "resolves when `window.google.maps.places` exists"; `resolve(placeId)` "fetches `formatted_address`, `geometry.location`, `name` with the same token".

**Evidence**: the two APIs have different request/response shapes (`PlacePrediction`/`PlaceResult` vs `AutocompleteSuggestion`/`Place.fetchFields`), different session-token plumbing and different field names (`displayName`/`formattedAddress`/`location` in the new API), so the fake `window.google` in `LocationPicker.test.tsx` and the `createAutocompleteSession` wrapper cannot be written until one is chosen. Google stopped offering the legacy Places library to new Cloud projects (March 2025), so a freshly created, referrer-restricted key may only work with the new API. With `loading=async` Google's documented pattern is `google.maps.importLibrary("places")`, not polling `window.google.maps.places`.

**Category**: Ambiguous. **Severity**: Major — blocks the Google path implementation and its tests; wrong choice yields a dead search box in production.

**Fix**: mandate Places API (New): `importLibrary("places")` after script load, `AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken })`, `suggestion.placePrediction.toPlace().fetchFields({ fields: ["displayName","formattedAddress","location"] })`, new `AutocompleteSessionToken` per session; define the exact fake `window.google` shape for tests. If the legacy API must be supported for the user's existing key, say so and pin that instead — not both.

---

## Minor

### m1. `Decimal` lat/lng serialize as JSON strings
`LocationResponse.lat: Decimal | None` (§6.4) under pydantic v2 (`pyproject.toml:14`) is emitted as `"52.406"` (string) in JSON. The TS types in §7.3/§7.9 are not pinned. Fix: declare `lat: string | null` in `api/locations.ts` (nothing in the UI uses them), or serialize as `float` in the response models.

### m2. `MyAttendanceResponse.attendee_count: int | None` is never null
§6.4 says "0 when the term has no active RSVPs" but `list_my_attendances_joined` excludes withdrawn rows (`repository.py:498-510`), so every listed term has at least the caller's own active RSVP. §7.9 then branches on "count is null". Fix: type it `int` on both sides and drop the "Y miejsc when the count is null" branch for attended cards.

### m3. Hint matrix: stacking and orphaned key
Rows 2 ("Stwórz wizytówkę") and 4 ("Dodaj swój pierwszy termin") can both be true; the spec does not say whether they stack (current code stacks org-polish + org-first-term, `HomeView.tsx:96-119`). The old `hint_first_term_dismissed` key (`PanelDataContext.tsx:270-271`) is neither reused nor listed for removal (only `hint_become_organizer_dismissed` is). Fix: state "hints stack in matrix order" and list `hint_first_term_dismissed` for removal.

### m4. Attended terms appear twice on Home
§7.7 merges attended terms into the top-3 while mockup 5 keeps the "Zapisane zajęcia" section "unchanged" (`HomeView.tsx:186-194`). Same attendance can render in both blocks. Fix: state that this is intended, or exclude attended terms already shown in the top-3 from "Zapisane zajęcia".

### m5. Stepper closed at step 2 leaves an empty group
§3 A2 "the stepper is not done until the term is created" but step 1 already persisted the group (same as today, `FirstTermStepperGuest.tsx:75`). The brief's spam risk is only partly mitigated. Fix: state explicitly that closing at step 2 keeps the group (it then shows under "Prowadzę" with the "Dodaj swój pierwszy termin" hint) — or require confirmation on close.

### m6. `GET /api/groups` returns `default_location: null` even when set
§6.8 "GET /api/groups list is not extended" while `GroupResponse` gains `default_location` with default `None` (and `default_capacity` will be populated by `from_attributes`). A half-populated row is misleading. Fix: either batch-attach there too (one `IN` query) or document the asymmetry in the schema docstring; the panel uses `getGroup(id)` so behaviour is unaffected.

### m7. `vi.stubEnv` only works if the key is read at call time
§7.2 `isGoogleMapsConfigured()` must read `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` inside the function, not into a module-level constant, or the stubbed Google-mode tests in §9.1 cannot flip modes. Say so.

### m8. File path of `PanelPage.tsx`
§7.6 cites `PanelPage.tsx`; the file is `src/frontend/src/pages/panel/PanelPage.tsx` (the codebase analysis listed it under `src/frontend/src/pages/PanelPage.tsx`, which does not exist).

### m9. Esc requirement is only meaningful inside krag `ModalSheet`
Every host listed in B13 uses the panel `ModalSheet` (`panelComponents.tsx:167-203`), which has no Esc handler, and `EditTermDialog.tsx:15,283` also uses the panel sheet. The `preventDefault`/`stopPropagation` rule is harmless but the rationale ("respects host sheets") only applies to `DeleteGroupDialog`/krag sheets. Keep it, but state that the delete-location confirm (alertdialog, Esc-aware) is the real reason.

### m10. "Verify unchanged" backend tests not listed
Codebase analysis names `test_circles_router.py`, `test_organizer_terms.py`, `test_organizer_page*.py`, `test_public_preview.py`, `test_notifications.py` as "build/inspect group and term responses; verify". §9.1 omits them. Add them to the "verify unchanged" line. (`app/system/public_preview.py:21` consumes `PublicCircleResponse` for OG previews — additive fields are safe but worth a glance.)

### m11. `ModerationTermResponse.location: PublicLocationResponse` for an ADMIN view
§6.4 gives moderators the public shape (no `owner_party_id`). Acceptable, but `AdminTermsPage` is an ADMIN tool; if moderators ever need to trace a location's owner the owner view would be the natural choice. Confirm the choice is deliberate.

---

## Ambiguities / clarification questions

1. (M1) Should a family member of a circle who has not RSVPed still see that circle's upcoming terms in the panel? Where?
2. (M2) Is an in-panel hamburger wanted, or is the public-page `AccountMenu` link sufficient for A1?
3. (M3) Places API (New) or legacy Places library? Is the user's Google Cloud project new (post-March-2025)?
4. (m4) Should an attended term shown in Home's top-3 also appear in "Zapisane zajęcia"?
5. (m3) Do the four hint cards stack, and is `hint_first_term_dismissed` to be removed?
6. (m5) On closing the stepper at step 2, keep the orphan group silently, or confirm?

---

## Coverage checks

- **Scope A1–A7, B8–B17**: each has a numbered requirement in §3 with decisions carried from `clarifications.md`/`scope-clarifications.md`/`technical-clarifications.md`. Phase 5 decision (`MyAttendanceResponse` extended) is in §6.4/§7.9 and `test_my_attendances.py:114` is in the test plan.
- **Acceptance criteria (brief)**: all nine map to §11 items 1–9 plus 10–12; the `/krag/...` criterion is explicitly reinterpreted (§3 A5, §11.1) and the "w powiadomieniu" clause is explicitly excluded (§11.7, §10).
- **Out of scope**: nothing from the brief's list is pulled in. Additions beyond the brief are all recorded decisions (`attendee_count` on public/attendance responses, `updateGroup()` api function, hint keys, capacity bounds 1..10000, `?nowa=grupa`).
- **Tests flagged "will break" in codebase-analysis.md**: all backend and frontend entries appear in §9.1, except the "verify" set in m10 and the hamburger set in M2 (listed, but with an unimplementable instruction).
- **Secrets rule**: present in the spec header, §7.1, §9.1 and §12.

## Recommendations (ordered)

1. Resolve M1 (guest circle terms) and M2 (hamburger location) in `requirements.md` and patch §3 A1/A6, §7.7, §9.1 and mockups 5/7 accordingly.
2. Pin the Google Places API variant (M3) and define the test fake shape in §7.2/§9.1.
3. Apply the minor type/wording fixes (m1, m2, m7, m8) before the planner attaches them to task groups; decide m3–m6 in one short clarification round.
