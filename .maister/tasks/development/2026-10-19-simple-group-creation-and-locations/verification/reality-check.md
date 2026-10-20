# Reality Check: Simple group creation + Locations (iteration 2)

**Date**: 2026-10-20
**Assessor**: reality-assessor (read-only, re-verification)
**Status**: ✅ Ready. GO, with Google Places held behind the R3 manual smoke test.

## 1. Summary

All iteration-1 must-fix and agreed items are resolved. I confirmed this live against the **current** code. The term "Formalizuj stałych członków" feature is removed end to end.

Evidence:
- **Test results** (read from `verification/test-suite-results.md`, not re-run, per `skip_test_execution: true`):
  - backend: 869/869
  - frontend: 979/985, and the 6 failures match the baseline list proven at HEAD
  - tsc: green
  - mypy: 32 (baseline)
  - lint: 16 (baseline)
- **The local :8080 backend is stale.** It still serves `/api/groups/{group_id}/terms/{term_id}/formalize` in `openapi.json`, and its `LocationRefResponse` is missing. That process predates the latest commits, so it was **not** used for verification. I started a separate, non-reload uvicorn with the committed code (HEAD `42a92a0`) on 127.0.0.1:8093 against the same dev DB, ran the scenario, and stopped the server. Port 8093 is free again.
- **Code read** of the fixed paths: `application/circles.py:249-253`, `application/terms.py:43-46,152-155`, `app/locations/schemas.py` (`LocationRefResponse`), `LocationPicker.tsx:52-88`, `PanelPage.tsx:95` / `MiejscaView.tsx`, `panelHelpers.parseCapacity`, `panelComponents.CapacityField`.

## 2. Live scenario (current code, :8093)

| Step | Expected | Actual |
|---|---|---|
| Owner creates MANUAL place → PRIVATE group with that default + capacity 8 | 201 | 201; `default_location` keys = `deleted_at, formatted_address, google_place_id, id, name, notes` |
| Term with that place | 201 | 201 |
| Soft-delete the place | 204 | 204 |
| **R1a** PATCH group (rename), re-sending the same `default_location_id` | 200 | **200**; the default stays attached and shows its `deleted_at` |
| **R1b** POST term with the prefilled (deleted) default id | 201 | **201** |
| **R1c** PATCH term, unchanged (deleted) `location_id` | 200 | **200** |
| ACL: owner assigns another account's place | 403 | 403 (the ownership check is still enforced for *changed* ids) |
| **R2** second, unrelated account: `GET /api/groups/{id}`, `GET /api/groups`, `GET /api/terms?circle_group_id=` | no `owner_party_id`/`lat`/`lng` | All three return only `id, name, formatted_address, google_place_id, notes, deleted_at` |
| `POST /api/groups/{g}/terms/{t}/formalize` | 404/405 | 405 (route gone from OpenAPI) |
| `default_capacity: 0` | 400 | 400 |

Throwaway accounts created: `reality2-owner-1792500357@example.test` and `reality2-other-1792500357@example.test`. Their group and both places are soft-deleted.

## 3. Status of iteration-1 findings

| ID | Iter-1 | Now | Evidence |
|---|---|---|---|
| R1 unchanged location 404/403 | High | **Resolved** | Code skips the ACL when the id equals the current value (`!= group.default_location_id` / `!= term.location_id`). Live R1a/b/c gave 200/201/200. Work log reports 3 regression tests |
| R2 full location exposure | High | **Resolved as decided** | `LocationRefResponse` without owner/coordinates on `GroupResponse.default_location` and `TermResponse.location`; confirmed live for a second account. Address and notes stay visible to any logged-in user, by the user's choice |
| R3 Google path only mocked | Medium | **Open (manual)** | Still no key locally. The fixes added suggest-failure → manual fallback and script reuse on retry, so the damage stays limited |
| R4 public `attendee_count` | Decision | **Closed** | User confirmed it stays public (work log, Phase 11) |
| R5 stale panel after Moje miejsca | Low | **Resolved** | `PanelPage.tsx:95` passes `onPlacesChanged={() => load({ silent: true })}`; MiejscaView calls it after add/edit/delete; MiejscaView tests assert one call per mutation |
| R6 "(usunięte)" label | Low | **Resolved** | `LocationPicker.tsx:88` labels by `fallback.deleted_at === null`, not by list membership; test at `LocationPicker.test.tsx:150` |
| R7 capacity client validation | Low | **Resolved** | `parseCapacity` accepts only an integer from 1 to 10000. `CapacityField` shows an inline `role="alert"` error with `aria-invalid`/`aria-describedby`, and the host blocks submit |
| R8 notifications / organizer pages | Info | Unchanged (deferred by spec) | Work-log follow-ups 2, 3 |
| Formalize removal | (user request) | **Done** | No `formalize` in `app/`/`tests/`. Frontend has only the negative regression test (`EditTermDialog.test.tsx:158`). Endpoint returns 405 |

## 4. Critical gaps

None.

## 5. Remaining issues

| ID | Severity | Location | Description | Fixable | Suggestion |
|---|---|---|---|---|---|
| N1 | Medium (ops) | local dev process on :8080 (PID 13604 at check time) | The running local backend is stale: it still exposes `formalize` and returns the old full location shape. A manual or E2E check against :8080 would give misleading results | Yes | Kill every uvicorn listener and its `spawn_main` children on 8080, then restart from `src/backend` |
| R3 | Medium | `src/frontend/src/lib/googleMaps.ts` | The real Places (New) path has never run with a key | Yes (manual, ~30 min) | Before enabling the production key, smoke test with a referrer-restricted key: search, pick, save, re-pick the same place_id (200), and check that the Network tab shows one session per pick |
| N2 | Low (product) | `application/terms.py:43-48` | New terms can be created pointing at a soft-deleted place: the prefilled default, or inheritance when the field is omitted. The public view (`PublicLocationResponse`, no `deleted_at`) shows that place to guests as a normal address. This follows from "unchanged id is not re-validated" plus inherit-by-value, and is arguably intended. The organizer sees "(usunięte)" in the picker | Yes | Optionally hint "domyślne miejsce zostało usunięte" in the group form, or stop inheriting a deleted default. Not blocking |
| N3 | Low | `application/terms.py:152-154` | After a leadership handover, a new leader changing a term's place **to** the group default (still the previous leader's place) gets 403. Only `create_term` exempts the group default | Yes | Also accept `data.location_id == group.default_location_id` in `update_term`. Rare edge, not blocking |
| N4 | Info | `src/backend/app/groups/application/memberships.py:21` | New unused import `Group` (F401); ruff count unchanged | Yes | `ruff check --fix` |
| R8 | Info | notifications, organizer public pages | Deferred by spec | n/a | Keep as follow-ups |
| N5 | Info | local dev DB | Throwaway accounts from both iterations: `reality-check-*`, `oreality-check-*`, `reality-pub-*`, `reality2-*@example.test` (data soft-deleted) | n/a | Remove if you want a clean DB |

## 6. Functional completeness

| Area | Estimate | Notes |
|---|---|---|
| A: 2-step "Załóż grupę" for anyone, both contexts | ~95% | Unchanged from iter 1; capacity is now validated on the client |
| B: Location entity + CRUD + ownership + soft delete | ~98% | R1 fixed; ACL still enforced for changed ids |
| B: group defaults, inherit by value, override | ~95% | Prefilled re-send now works; edges N2/N3 only |
| B: display + privacy | ~95% | Narrow ref for READ, public payload without owner; panel refreshes after place changes |
| B: Google Places | Unknown at runtime | R3 |
| Moje miejsca view + select with "+" | ~97% | R5/R6 fixed |
| Formalize removal | 100% | Backend, frontend and tests |

## 7. Deployment decision

**GO** for manual-mode places (no Google key). Turn the Google key on only after the R3 smoke test. Restart the stale :8080 dev backend (N1) before any further manual or E2E checks. N2 to N4 are optional polish.
