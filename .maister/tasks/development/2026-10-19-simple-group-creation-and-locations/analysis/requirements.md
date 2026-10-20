# Requirements

## Initial description
See `task-description.md` (Polish, full brief with scope A1–A7, B8–B17, out-of-scope, risks, acceptance criteria).

## Q&A rounds

### Phase 1 (codebase contradictions)
- Keep `k-<hash>` organizer slugs; "/krag" criterion means "public link works without an organization".
- Stepper calls `POST /api/groups/mine/new`; frontend sends `visibility` (PRIVATE when no Organization, else PUBLIC); backend default stays PUBLIC; `/mine` unchanged.
- Notifications unchanged this iteration (follow-up).
- Location = own module `app/locations/`, read by groups through `locations_acl.py`; no text moderation of location name/notes; hand-written lazy Maps JS loader (`libraries=places`), `@types/google.maps` devDependency; manual mode without `VITE_GOOGLE_MAPS_API_KEY`.

### Phase 2 (scope defaults, all accepted)
- `model_fields_set` for the four new PATCH fields only; group `name` stays required.
- `CreateTermRequest`: omitted = inherit from group defaults (copied by value), explicit null = none.
- `attendee_count` (active signups) added to `PublicTermResponse`.
- `formatted_address` required for GOOGLE and MANUAL.
- Partial unique index on `(owner_party_id, google_place_id)` WHERE `google_place_id IS NOT NULL AND deleted_at IS NULL`; `POST /api/locations` idempotent on active place_id (200 existing / 201 created) via SAVEPOINT re-fetch.
- Done-screen CTA "Stwórz publiczną wizytówkę / własny adres" links to `/organization`.
- Home: merged top-3 of led + attended terms (dedupe by term id, led wins); Spotkania: sections "Prowadzę" / "Zapisane".
- Shared `GroupFormFields` used by add-group modal, edit-group modal, stepper step 1.
- `FirstTermStepperOrganizer` kept, extended with LocationPicker + capacity prefilled.
- Hamburger "Załóż grupę" → `/panel/spotkania?nowa=grupa` opens the stepper.

### Phase 4 (mockups)
- AdminTermsPage new columns use Polish headers "Miejsce" / "Miejsca" (capacity rendered as "3 / 10" string).

### Phase 5
- Panel data: minimal change inside `load()`; only locations list via TanStack hook.
- One group-creation flow: the old guest "pierwszy-termin" path (hint "Dodaj swój pierwszy termin" → FirstTermStepperGuest) is replaced by the new "Załóż grupę" stepper for all entry points (Home hint, Spotkania button, hamburger, `?nowa=grupa`). Registration onboarding (`organizerSteps.tsx`) untouched.
- Reuse confirmed: backend `app/organizations` (layout, `model_fields_set`, 404-then-403), migrations 0054/0056, `organizations_acl.py`, `inventory.py` SAVEPOINT pattern; frontend panel `ModalSheet`/`Field`, `useCategories` hook shape, `EditTermDialog` inline-list pattern, `termPublicPath`, `serverMessageOr`. LocationPicker is inline inside the panel sheet (no nested sheet).
- Visual assets: Phase 4 ASCII mockups only (`analysis/design-context/INDEX.md`, 25 ids) — binding.

## Similar features identified
- `app/organizations` CRUD vertical with `/mine` endpoint and ownership checks.
- Group soft delete (migration 0056, repository filters, `get_group_including_deleted`).
- `organizations_acl.public_organization` nested-response mapper.
- Frontend `useCategories` / `useMyOrganization` hooks, `EditTermDialog` needed-items inline list, `ColorsTab` radiogroup.

## Functional requirements summary
A. Any logged-in user: "Załóż grupę" entry (Home, Spotkania, hamburger) → 2-step stepper (group name, visibility defaulted by org presence, optional default place + capacity → first term with date/description/place/capacity prefilled) → done screen with public link (`termPublicPath`) and optional "Stwórz wizytówkę" link to `/organization`. No organization step; "organizator" only as per-group role. Panel shows led and attended groups together; hints reworded by state.
B. Location entity + `/api/locations` (mine/POST/PATCH/DELETE soft), Group defaults, Term location/capacity inherited by value, public `LocationResponse` without owner, `attendee_count` on public term, LocationPicker (saved list radiogroup, Google autocomplete with session tokens or manual, inline edit/delete, empty state = search), display on public term page, panel cards, Spotkania tiles, AdminTermsPage; "Brak wolnych miejsc" status, RSVP unaffected; `groupExtras` removed.

## Scope boundaries
Out: role model/permission changes, RSVP blocking/waitlist, embedded map/distance search/server geocoding, shared locations, group picker in term form, item search, onboarding changes, notifications (deferred).

## Technical considerations
- Migrations 0057 (locations) and 0058 (groups/terms columns) with correct downgrades (migration tests downgrade below head).
- Batched `IN` lookups to respect query-budget tests; no `relationship()` in groups models; `lat`/`lng` as `Numeric(9,6)`.
- Exact-key-set assertions in `test_public_term.py`, exact-call assertions in `PanelPage.test.tsx`, `FirstTermStepperOrganizer.test.tsx` without QueryClientProvider, unmocked `../api/locations` in panel tests — all must be updated.
- New: `src/vite-env.d.ts`, `src/frontend/.env.example`, Dockerfile `ARG VITE_GOOGLE_MAPS_API_KEY`, compose build arg.
- Google terms: place_id storable indefinitely; lat/lng/address cache limits documented, refresh out of scope.

### Phase 5 (spec gate)
- `MyAttendanceResponse` IS extended with nested `location`, `capacity`, `attendee_count` so attended term cards in Home/Spotkania show place and "X/Y miejsc" (update `test_my_attendances.py` key set and the SpotkaniaView literal objects). Spec assumptions accepted: capacity 1..10000; hint keys `hint_create_group_dismissed` / `hint_create_org_dismissed`; "Wstecz" from step 2 keeps the created group and PATCHes edits; new `updateGroup()` api function; `LocationResponse` re-exported via `locations_acl`; `UpdateGroupRequest` without `extra="forbid"`.

### Phase 6 (spec audit, pass-with-concerns: 0 critical / 3 major / 11 minor — all resolved in spec rev 2)
- "Zapisane" = my RSVPs + terms of membership circles (guestCircles via getTerms), deduped led > attended > membership-only; new PanelPage membership test.
- No hamburger in the panel: "Załóż grupę" menuitem lives in AccountMenu on public pages and deep-links to /panel/spotkania?nowa=grupa; the 6 baseline-failing hamburger tests are deleted; PublicLayout.test.tsx + ?nowa=grupa test added; mockups corrected.
- Places API (New) mandated: loading=async + importLibrary("places"), AutocompleteSuggestion.fetchAutocompleteSuggestions with session token, place.fetchFields on selection; wrapper contract in lib/googleMaps.ts and test fake shape defined.
- Minors: lat/lng JSON numbers; attendances attendee_count non-null; hint stacking + orphan keys removed; Home dedupe; stepper closed at step 2 keeps group; GET /api/groups attaches default_location; vi.stubEnv call-time reads; PanelPage path; Esc scope; verify-unchanged test set; ModerationTermResponse uses PublicLocationResponse.
