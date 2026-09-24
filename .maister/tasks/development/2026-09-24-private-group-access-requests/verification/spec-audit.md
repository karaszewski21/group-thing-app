# Spec Audit — PRIVATE group access requests (2026-09-24)

**Spec:** `implementation/spec.md`
**Auditor mode:** independent, read-only, evidence from the working tree (`src/backend`, `src/frontend/src`).
**Verdict:** **PASS WITH CONCERNS** (0 critical, 2 major, 11 minor)

The spec is complete against requirements, clarifications C1-C4, scope decisions D-1/D-2 and defaults 1-17, and the spec-phase decisions S-1..S-6. Almost every file, line and function it cites exists and matches the code. The route and matrix plans are collision-free, the migration chain is correct, and the privacy predicate is sound. Two gaps should be fixed in the spec, or pinned in the plan, before implementation. Both are local to the frontend.

---

## 1. Verified claims (evidence)

| Claim | Evidence | Result |
|---|---|---|
| `POST /api/memberships` at `router/memberships.py` L25-33; `create_membership` at `application/memberships.py` L23-39 | Read both files | Correct |
| `/join` route `router/circles.py` L166-186; `join_private_group` `public_view.py` L452-506 | Read | Correct (file is 506 lines) |
| Matrix `/join` row + comment L95-101; `/access` comment mentions `can_join` (L82); row 27 L117; row 31 L134 | `authorization_matrix.py` | Correct |
| `schemas.py` L2 stale docstring (`/api/memberships`) | Read | Correct |
| Redundant `get_group` at `public_view.py` L303; PRIVATE reduced branch before `term_id` validation (L190-210) | Read | Correct. This is the B13 root cause. |
| Migration head = `0036` (`revision="0036"`) | `alembic/versions/` listing | Correct. `0037`/`0038` are free. |
| `0031` has `_sequenced_id/_create_sequence/_own_sequence` + `OWNED BY NONE` downgrade; `0023` partial unique index pattern; `0032` pointer template | Read | Correct |
| `NotificationKind` column `String(30)`, `native_enum=False`, no CHECK (`0022` L55) | Read | Correct. Kinds are 20/19/19 characters, so no migration is needed. |
| Tests run `alembic upgrade head` (conftest L53), so the partial index is exercised in tests | conftest | Correct |
| `inventory.py` `begin_nested` + `IntegrityError` fallback template | L37-64 | Correct |
| No `StaleDataError` handler today; `IntegrityError` → generic 409 | `errors.py` L113-129 | Correct |
| `BaseEntity.updated_at` is `version_id_col` | `core/base_model.py` L65-66 | Correct, so the optimistic-lock race is detected as `StaleDataError` |
| Organizer helpers `_is_active_organizer`, `_require_active_organizer` (raises 403), `list_active_leaderships_for_party`, `get_current_leadership` | `circles.py` L227-253 | Correct |
| `resolve_organizer_slug` is never None (hash fallback) | `slug_resolver.py` | Correct |
| `list_profile_names_by_party_ids` batched | `repository.py` L375 | Correct |
| Formalize loop L149-158 builds `Membership` inline | `memberships.py` | Correct |
| `get_profile_by_principal` raises `EntityNotFoundException`, which must be remapped to 401 (the spec does this, mirroring `join_private_group`) | `users/service.py` L88-99 | Correct |
| All registered users get `["READ","EDIT"]` | `users/router.py` L31-35 | Correct: `ReadPrincipal`/`EditPrincipal` on the new routes work for GUEST and ORGANIZER alike |
| `PanelModals.tsx` L170/L248 "(link dołączenia)" | grep | Correct |
| `aria-labelledby` dangling at `NeededItemsSection.tsx` L36, `AttendeeList.tsx` L50 | grep: no matching ids | Correct |
| S4: `isLoggedIn && displayName` at TermPage L375 | Read | Correct |
| PanelPage.test fixed `../api/groups` mock at L61-73 | Read | Correct |
| `AuthGateLinks` builds `returnTo` itself from `useLocation()` | `AuthGateSheet.tsx` L5-8 | Correct. "with returnTo" needs no new prop. |

### Route ordering and collisions (independent check)
I enumerated every `/api/groups/...` route (grep across `app/groups/router/`):
- `GET /api/groups/mine/join-requests` versus `GET /api/groups/{group_id}/join-requests`: this is the only same-shape pair. The spec correctly requires the literal route to be declared first. No existing `GET /api/groups/{x}/{literal}` route conflicts (`memberships`, `leaderships`, `leadership` and `exchange-summary` all differ in the literal segment).
- `POST /api/groups/public/{gid}/join-requests/{rid}/withdraw` has 7 segments, versus 6 for `POST /api/groups/mine/attendances/{id}/withdraw`. They do not collide.
- `POST /api/groups/{gid}/join-requests/{rid}/approve|reject` versus `.../terms/{tid}/formalize`: different literals, no collision.
- After removal, `POST /api/memberships` and `POST /api/groups/public/{id}/join` have no path match, so they return 404. Red tests 4 and 5 accept 404 or 405.

### Authorization matrix (first match wins)
- The new row `POST ^/api/groups/public/[^/]+/join-requests(/[^/]+/withdraw)?$` → AUTHENTICATED, placed at the old `/join` slot before row 27. This is correct. Without it, row 27 would return EDIT, which does not match the route's `require_any()`.
- `GET mine/join-requests` and `GET {gid}/join-requests` fall to row 26 (READ). Nothing earlier matches: `GET ^/api/groups/mine/attendances$`, `GET ^/api/groups/public/[^/]+$` and `GET ^/api/groups/moderation$` all miss.
- Approve and reject fall to row 27 (EDIT). `PATCH ^/api/groups/[^/]+$` is PATCH-only.
- After the row is removed, `POST /api/groups/public/42/join` resolves to row 27 (EDIT). The spec's matrix test expectation is correct.
- Note: the matrix is a reference table only. `resolve_requirement` is not used at runtime, and enforcement is per-route `require_any`. The spec's pairing of dependencies (R7) with matrix rows (R8) is consistent.

### Privacy
- The B13 flag comes only from `_is_active_organizer` / `_is_active_member` (server side). PENDING and REJECTED callers never unlock content. An invalid token makes `get_current_principal` return None, which gives the anonymous branch. `GET /api/groups/public/{id}` is unchanged. Outsiders get no `term_id` validation, so they cannot probe whether a term exists. Red test 5 guards this. **Sound.**
- `join_request` only goes to the caller about the caller's own request, only for PRIVATE groups, and only to non-members. It exposes no other party's data.

### Test-breakage list (independently counted)

| File | Breaking tests | Spec coverage |
|---|---|---|
| `test_circles_router.py` | 3 (helper L52-65: L68, L99, L118) + 4 `/join` incl. matrix test L275-279 | Covered (L52-65, L191-279) |
| `test_exchange_summary.py` | 7 via helper L66-83 + 1 direct POST L313 (test at L251) = 8 | Covered |
| `test_group_privacy.py` | 1 (L216-245) | Covered. This test would actually still pass (404), but removing it as the spec says is fine. |
| `test_group_access.py` | 3 full-dict + 1 `can_join is True` = 4 | Covered |
| **Total** | **20** | Spec says "about 19", which is accurate enough |

No other backend or frontend test references `createMembership`, `joinPrivateGroup`, `can_join`, `JoinPrivateGroupDialog` or `PrivateGroupAccessDenied` (grep), except `TermPage.test.tsx` (L86, L265), which the spec covers.

---

## 2. Findings

### MAJOR

**M-1. A failed token-change fetch leaves the gate on an endless „Wczytywanie...”** (R11 + R12, Edge Cases "Token changes in-page")
- R11: "A failed refetch keeps `ready` and sets `refreshError`. Only a failed first load gives `error`." `isStale = ready && forToken !== current token`.
- R12: "`ready`, resolved to a gate, while `isStale`" renders „Wczytywanie...".
- Consequence: when the token changes, the fetch runs through the same `run` (FSM §7.3 sketch). If that fetch fails, the state stays `ready` with the old `forToken` and a non-null `refreshError`. `isStale` then stays true, so the gate shows „Wczytywanie...” forever and never shows the `refreshError` line. This contradicts "Refetch fails in the gate → keep the screen and show a `.kg-error` line".
- **Fix:** add a render rule: if `isStale && refreshError`, render the gate (or „Nie znaleziono”/retry) with the error line. Alternatively, treat a failed fetch for a *new* token as `error`. Add a `useTermAccess`/TermPage test for "token change + failed fetch".

**M-2. The PanelPage test plan does not give the new mocks a default resolution, so existing panel tests may crash** (Testing approach → `PanelPage.test.tsx`; R16)
- `PanelPage.test.tsx` uses `vi.resetAllMocks()` in `beforeEach` (see the comment at L66-70). A newly added `listMyPendingJoinRequests: vi.fn()` therefore resolves to `undefined`, not `[]`. R16 only says a *failure* is treated as an empty list. `undefined` is not a rejection, so merging `undefined` into `pendingActions` throws during render and can break every existing PanelPage test.
- **Fix:** require `vi.mocked(groupsApi.listMyPendingJoinRequests).mockResolvedValue([])` in the per-test defaults (`mockOrganizerDefaults()` or equivalent), and/or have `load()` coerce a non-array result to `[]`.

### MINOR

**m-1. Expired-token behaviour is described inconsistently** (Edge Cases table vs R12)
The Edge Cases table says an expired token shows `loginRequired`. With `identified = forToken !== null`, a request made with an expired token that the backend treats as anonymous still has a non-null `forToken`. The page therefore resolves to **`canRequest`**, not `loginRequired`. A member with an expired token also sees `canRequest`. The outcome is acceptable: the POST returns 401 and the client redirects to `/login`. Note that the `client.ts` 401 redirect drops `returnTo`, so the user loses the term URL.
**Fix:** correct the edge-case wording and accept or document the `returnTo` loss as a known limitation.

**m-2. `PendingJoinRequestAction.linkPath` cannot be built** (R16)
`PendingJoinRequestResponse` has no `link_path` or `organizer_slug`, so the frontend cannot build the term URL. The modal also never uses `linkPath` (there is no "Zobacz" button in Mockup 9).
**Fix:** drop `linkPath` (minimal implementation), or add `link_path` to `PendingJoinRequestResponse`.

**m-3. Location and export of the R6 helper are unspecified** (R6, Required rewrites)
The spec does not name the helper, and does not say whether it is re-exported through the `app.groups.service` facade. Project memory says to "import from app.<v>.service only". Test helpers need to import it.
**Fix:** name it (e.g. `add_active_membership(db, party_id, group_id)`) and state that tests import it from `app.groups.service`. Also say that the test helper functions gain a `db_session` fixture parameter.

**m-4. "Później" re-appearance is ambiguous** (Journey step 3 vs R16)
The journey says "comes back on the next panel load", but R16 says "next full panel load". `load({silent:true})` runs on panel re-entry and after every decision. The spec should state that the session-hidden set is **not** cleared by silent reloads, only by a provider remount.

**m-5. The single-group-load instruction in R2 is imprecise**
`get_public_circle_view` loads the group internally. "Use a single group load" is only achievable by reading `group_response.visibility` (or by passing the loaded `Group` in). Say which.

**m-6. The race fallback must not stage a notification** (R5 create, step 7)
The spec implies but does not state that the `GROUP_JOIN_REQUESTED` notification is staged only after a successful insert. `session.begin_nested()` flushes pending objects before opening the savepoint, so a notification staged earlier would survive the savepoint rollback. Flushing first for `join_request_id` naturally enforces the right order; one sentence would make it explicit.

**m-7. `0038` `down_revision` is not stated.** It should be `"0037"`. Also say whether the partial unique index is declared in the model's `__table_args__`. The precedent (pledges `uq_pledges_active_needed_item`) is migration-only, and there is no drift test.

**m-8. TermPage.test mock description is inaccurate** (Frontend tests)
The spec says to replace `joinPrivateGroup` in the mocks. The existing `../api/groups` mock (L10-13) spreads `...actual` and never mocks `joinPrivateGroup`. The new functions must be *added* as `vi.fn()` so tests do not hit the real client.

**m-9. The gate's no-organizer message depends on stale data** (R13 canRequest)
The 409 no-organizer line is shown only when `group.organizer_display_name` is null. If the organizer left after the page loaded, a 409 „Ta grupa nie ma teraz organizatora” refetches and then shows nothing. Acceptable; consider deciding after the refetch data arrives.

**m-10. Test scope wording** (Testing approach vs Success Criteria 1)
"Test verification runs only the new tests" sits oddly next to Success Criterion 1 ("full backend suite green"). Clarify that per-group verification runs the new tests and final verification runs the full suite. The removals touch 20 existing tests.

**m-11. Stale docstrings are not listed**
`router/memberships.py` module docstring ("create / end") and `components/krag/AuthGateSheet.tsx` L13 (mentions `PrivateGroupAccessDenied`). Add them to the delete/update list for completeness.

---

## 3. Decisions S-1..S-6 and requirement coverage

| Item | Spec location | Status |
|---|---|---|
| S-1 per-group list (organizer-only, 404/403, backend-only) | R5, R7, tests, Standards exception, Decision Record | Covered and consistent. The minimal-implementation exception is documented. |
| S-2 `GET /api/groups/mine/join-requests` (row 26) | R7, R8 | Covered |
| S-3 duplicate create → 201, same row, no 2nd notification | R5 step 6, R7, tests | Covered |
| S-4 stale loader gate-only | R12 | Covered (see M-1) |
| S-5 REJECTED links to term / `/panel` | R4 table | Covered |
| S-6 "Wysłano {data}" optional | Visual Design, Known Limitations | Covered |
| C1-C4, D-1, D-2, defaults 1-17 | R1-R16, Out of Scope | All present. Default 13 (PRIVATE→PUBLIC) is in Edge Cases. Default 14 (`forToken`) is in R11/R12. |
| Mockups 1-11 | Visual Design table | Copy and a11y attributes match `ui-mockups.md`. The suggested prop shapes in Mockups 2 and 9 differ from the spec's (the spec's shapes are better and the mockup labels them "suggested"), so this is not a violation. |

## 4. Over-engineering check (minimal-implementation standard)
- The per-group list endpoint has no caller, but the user explicitly chose to keep it (S-1) and the exception is documented. Acceptable.
- The global `StaleDataError` handler is justified: it is needed for the approve/withdraw races and also fixes existing 500s.
- The new router module and use-case module follow the `term_item_listings` precedent.
- No speculative fields: no message, expiry or organizer column.
- The only speculative bit is `linkPath` on `PendingJoinRequestAction` (m-2).

## 5. Recommendations (in priority order)
1. Fix M-1: add a render rule for `isStale && refreshError`, plus a test.
2. Fix M-2: default `listMyPendingJoinRequests` to `[]` in the PanelPage test defaults and coerce non-arrays in `load()`.
3. Name and place the R6 helper and its facade export (m-3). Drop or source `linkPath` (m-2).
4. Tidy the wording in m-1, m-4, m-5, m-6, m-7, m-8, m-10 and m-11. None of these blocks planning.

## 6. Clarification questions (non-blocking)
1. After an in-page token change fails to load, should the gate show the previous gate with an error line, or „Nie znaleziono”? (M-1)
2. Should "Później" survive silent panel reloads and only reset on a full page reload or remount? (m-4)
