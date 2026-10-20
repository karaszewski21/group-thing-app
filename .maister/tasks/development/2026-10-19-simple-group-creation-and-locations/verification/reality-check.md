# Reality Check: Simple group creation + Locations

**Date**: 2026-10-20
**Assessor**: reality-assessor (read-only)
**Status**: ⚠️ Issues Found. Conditional GO: fix R1 first (small backend change).

## 1. Summary

The feature does what the brief asks, for the most part. The evidence below is independent of the work log:

- **Targeted test re-run (this session)**:
  - Backend: 8 files (locations, locations migration, group defaults, term location/capacity, public term, my attendances, group privacy, authorization matrix) gave **112 passed**.
  - Frontend: 12 files gave **218 passed, 2 failed**. The 2 failures are the documented baseline ones: TermPage anonymous footer, and PanelPage "409 inline".
- **Live API run against the restarted local backend on :8080**: `POST /api/locations` now returns 401 without auth (previously 405), so the stale process is gone. With a throwaway account, all of these worked end to end:
  - a MANUAL place was created (201)
  - `/mine` listed it
  - `POST /api/groups/mine/new` took the defaults and returned a PRIVATE group with the nested `default_location` and `default_capacity`
  - a term created without the fields inherited place and capacity by value
  - the anonymous public view of a PUBLIC group returned `term.location` (no `owner_party_id`), `capacity` and `attendee_count`
  - after a soft delete, the place disappeared from `/mine` while the existing term still rendered it with `deleted_at`
  - `capacity: 0` was rejected with 400
- **Code read of stepper, picker, add form, Moje miejsca view, Google loader, ACL and use cases**: the 2-step flow has no organization step. The status-level "organizator" copy is gone (grep: zero hits). `groupExtras` is gone. The `?nowa=grupa` deep link works. `/panel` sits under `PublicLayout`, so the hamburger with "Załóż grupę" and "Moje miejsca" is reachable from inside the panel too.

There is one real functional gap: re-sending a soft-deleted default place, which the frontend always does. Live testing confirmed it. It breaks acceptance criterion 8 in a normal user flow, and the new "Moje miejsca" view makes deleting a place prominent. Beyond that, there is one privacy question and one unverified path (a real Google key).

## 2. Reality vs claims

| Claim (work-log) | Reality | Evidence |
|---|---|---|
| Backend 873 green | Plausible; the subset I re-ran is green | 112/112 on the 8 relevant files |
| Frontend 965 pass, 6 baseline failures | Consistent | 218/220; the 2 failures are the documented baseline ones |
| Deleting a place does not break groups/terms (spec §11.8) | **Partly false** | Live: soft-delete the place, then `PATCH /api/groups/{id}` with the unchanged `default_location_id` → **404** "Location with id … not found". `POST /api/terms` with the prefilled default → **404**. Only an omitted field inherits (201) |
| Public payloads never include `owner_party_id` | True for public, attendance and moderation payloads; **not** for authenticated READ endpoints | Live: a *second, unrelated* account calling `GET /api/terms?circle_group_id=<PRIVATE group>` sees `formatted_address`, `notes` and `owner_party_id` |
| Google Places (New) path works | **Unverified at runtime**. Only mocked tests cover it | No key configured locally; the loader relies on `loading=async` + `importLibrary` |
| Local runtime blocked by a stale uvicorn | Resolved | `/api/locations` routes are live (401 without auth) |

## 3. Critical gaps

None that block every use. R1 is classed High, but it should be fixed before release because it is cheap and it hits the main new flow.

## 4. Issues

| ID | Severity | Location | Description | Fixable | Suggestion |
|---|---|---|---|---|---|
| R1 | **High** | `src/backend/app/groups/application/circles.py` `update_group`; `application/terms.py` `create_term` / `update_term`; triggered by `src/frontend/src/pages/panel/PanelDataContext.tsx` `saveEditGroup` / `handleAddTerm`, `CreateGroupStepper.tsx`, `FirstTermStepperOrganizer.tsx:67` | Once the group's default place is soft-deleted (for example from "Moje miejsca"), every group save fails with 404, even a plain rename. Every new term from the term modal or `FirstTermStepperOrganizer` also fails with 404 until the user manually changes the place select. The cause: the frontend always sends the prefilled id, and the backend ownership check (`get_owned_location`) treats an *unchanged* id as a new assignment. The same path gives 403 after a leadership handover, when the new leader re-sends the previous leader's place. Confirmed live. No test covers it. Same finding as code-review W1 | Yes, ~30 min | Skip the ACL check when the id is unchanged: `data.default_location_id != group.default_location_id` (update_group), `data.location_id != term.location_id` (update_term), and `location_id != group.default_location_id` (create_term). Add 3 regression tests: delete the place, then (a) PATCH the group name with the same id gives 200, (b) POST a term with the prefilled id gives 201, (c) PATCH the term with the unchanged id gives 200 |
| R2 | High (privacy, product decision) | `src/backend/app/groups/router/circles.py` `list_groups`, `get_group`; `router/terms.py` `list_terms`, `get_term`; `schemas.py` `GroupResponse.default_location`, `TermResponse.location` | Any logged-in account can read the full owner view of the place (address, notes such as entrance hints, coordinates, `owner_party_id`) for **every** group and term, PRIVATE circles included. Confirmed live with a second account. Groups and terms being readable by any logged-in user is not new, but a physical meeting address is a new, more sensitive kind of data, and it contradicts the PRIVATE intent. Code-review W2 and production-readiness Concern 4 report the same thing | Yes, 1–2 h | Embed a narrow `LocationRefResponse` (`id`, `name`, `formatted_address`, `notes`, `google_place_id`, `deleted_at`) and drop `owner_party_id`. Or attach the place only when the caller is the active organizer, as `attendee_count` already is. Get the user's decision |
| R3 | Medium | `src/frontend/src/lib/googleMaps.ts` | The Google path has never run against the real Maps JS API: the script is injected with `loading=async` and no `callback`, `importLibrary("places")` comes next, and `fetchFields` has no explicit session token. Typings and mocks pass, but a wrong assumption only shows up with a key. The manual fallback limits the damage: a null result switches to manual mode with an alert | Yes | Before release, test by hand with a referrer-restricted key that has "Maps JavaScript API" + "Places API (New)" enabled. Search, pick and save, check the 200 on a duplicate place_id, and check that the Network tab shows one session per pick |
| R4 | Medium (pending decision) | `app/groups/application/public_view.py` (`PublicTermResponse.attendee_count`) | The public, unauthenticated `attendee_count` reverses the older rule that only organizers see the count (Group 9 relaxed the privacy test `_CHILD_DATA_KEYS`). The work log lists this as a pending user decision | Yes | Confirm with the user. The alternative is a boolean `is_full` plus a "Zapisanych X z Y" line only for organizers |
| R5 | Low | `PanelDataContext.tsx` (`myGroups` loaded imperatively) vs `MiejscaView` (`useMyLocations`) | Renaming or deleting a place in "Moje miejsca" leaves the old name or address on the group tiles and term cards until the panel reloads. The data is stored correctly; only the display is stale | Yes | Call `load({ silent: true })` when the view is entered, or after location mutations |
| R6 | Low | `components/shared/LocationPicker.tsx` (deleted check) | Any `fallbackLocation` that is not in the caller's own list gets the label "(usunięte)". After a leadership handover, the previous leader's *active* place is wrongly labelled deleted | Yes | Base the label on `fallbackLocation.deleted_at` |
| R7 | Low | `CreateGroupStepper.tsx` `parseCapacity`, `GroupFormFields`, term modal | Capacity 0, negative or fractional values are only rejected by the server (400), so the user sees the backend message (likely English or generic) | Yes | Validate on the client: an integer ≥ 1, with a Polish inline error |
| R8 | Info (deferred by spec) | notifications, `OrganizerTermsPage` / `UpcomingTermsBlock` | The brief listed "place in notifications" as acceptance; the spec deliberately deferred it, along with the organizer public pages. Groups that have an Organization show no place on their organizer pages | n/a | Keep these as the documented follow-ups (work-log 2, 3) |
| R9 | Info | local dev DB | This assessment created 3 throwaway accounts in the local DB (`reality-check-*@example.test`, `oreality-check-*@example.test`, `reality-pub-*@example.test`). Their groups and places are soft-deleted | n/a | Remove them if you want a clean dev DB |

## 5. Functional completeness

| Area | Estimate | Notes |
|---|---|---|
| A: 2-step "Załóż grupę" for anyone, default visibility, optional org CTA, `/krag` fallback, both contexts | ~95% | Works; per-group role wording kept |
| B: Location entity + CRUD + ownership + soft delete | ~95% | Correct, except that an unchanged id is re-validated (R1) |
| B: group defaults, inherit by value, override, clear | ~85% | Inheritance works only when the field is *omitted*, but the frontend never omits it (R1) |
| B: display (public page, panel cards, admin, capacity pill) | ~95% | Covered by tests; public payload confirmed live |
| B: Google Places | Unknown at runtime | Mocked tests only (R3) |
| Scope addition: "Moje miejsca" + select with "+" | ~95% | Reachable via the hamburger (panel is under `PublicLayout`); add/edit/delete covered by MiejscaView tests |

## 6. Action plan

1. **R1 (High, ~30 min)**: skip the backend check for unchanged ids, plus 3 regression tests. Done when the soft-delete → rename and soft-delete → add-term flows return 200/201, both via the API and in the UI.
2. **R2 (High, decision + 1–2 h)**: ask the user. If the answer is "hide", switch to a narrow ref response without `owner_party_id`, or restrict it to organizers, and adjust the exact-key tests.
3. **R4 (decision)**: confirm whether the public `attendee_count` stays.
4. **R3 (Medium, ~30 min manual)**: smoke test with a real key before enabling the key in production.
5. R5–R7 (Low): optional polish.

## 7. Deployment decision

**Conditional GO.** Without a Google key (manual mode), the main flows work end to end on the live backend. Ship after R1 is fixed and R2/R4 are decided. Turn on the Google key only after the R3 smoke test.
