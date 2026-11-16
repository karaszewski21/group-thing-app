# Completeness Re-verification (cycle 1) — "Szukam" (wanted) mechanism

## TL;DR
- Status: **passed_with_issues**. The plan is still 100 % done (158 `[x]`, 0 `[ ]`). The fixes did not break plan completion or spec alignment, and the re-run test suite has no new failures (`verification/test-suite-results.md`).
- All 4 previous warnings are fixed: W1 (time.md and INDEX), W2 (`findMatching` removed), W3 (`WantMatchNotFound` moved to `errors.py`) and W4 (the useState + useEffect fetch is gone). I1 and I2 are fixed in code. I3 is half done. I4–I7 remain (all info).
- New **warning**: `architecture.md` no longer matches the code in 3 places in the Wants section: the `subtitle` field (:399), the closing-prompt lookup (:410) and the "Known limits" note on the cap link (:419).
- The new `hooks/useWantsMatchingItem.ts` follows `data-fetching.md` on keys, prefix and the empty fallback. It returns only `data`, which is a documented, minor departure. `create_notifications` follows the backend standards.
- Counts: critical 0, warning 1, info 9.

## Key Decisions
- `CloseWantSheet` still calls `closeWant` directly. This is now rated **info**, down from part of warning W4. The standard's hard rule ("no useState+useEffect fetching") is now met. The direct call still awaits invalidation of the whole `[WANTS_KEY]` prefix, as the standard requires, and a code comment (`CloseWantSheet.tsx:34`) gives the reason: it needs the raw 404/409 for each want.
- `useWantsMatchingItem` returns only `{ data }`, without `loading`/`error`/`refetch`. This is rated **info**. The docstring says a failed lookup counts as no wants, and the only caller needs nothing more.

## Open Questions / Risks
- W10 (sweep locks / unbounded window after downtime) and W11 (no rate limit) remain recorded risks, as the user decided. FR-L-02 auto-extension and the FR-F-40 tile target stay as specified. None of these is raised here.
- The fixed behaviour has no dedicated new test for the status filter and lock in the scan. The test-suite report notes this. The downgrade deleting WANT_* rows is covered (`tests/test_wants_migration.py:80-91`), and so is `create_notifications` (`tests/test_wants_notifications.py:85,119,129`).

---

## 1. Previous findings → status

| Prev | Finding | Status | Evidence |
|---|---|---|---|
| W1 | time.md / INDEX list of clock-guarded packages stale | **Resolved** | `.maister/docs/standards/backend/time.md:9` lists all six packages, including `app/search` and `app/wants`; `INDEX.md:77` matches; `tests/test_domain_clock_guard.py:28-35` matches |
| W2 | `useWants.findMatching` dead | **Resolved** | No `findMatching` left in `src/frontend/src` (grep); `hooks/useWants.ts:9-19` interface has no such member |
| W3 | `WantMatchNotFound` outside `errors.py` | **Resolved** | `app/wants/application/errors.py:26`; `writes.py:40` imports it, `:326` raises it |
| W4 | useState+useEffect fetch on the item page; direct mutation call | **Resolved (fetch) / residual info (mutation)** | `features/product/blocks/ItemPickupActions.tsx:49` uses `useWantsMatchingItem(...)`; no fetching effect remains (the `useState` at :45-46 is for the prompt only). `features/wanted/CloseWantSheet.tsx:35` still calls `closeWant` directly and awaits `invalidateQueries({ queryKey: [WANTS_KEY] })` at :36 |
| I1 | `CLOSE_OUTCOMES` unused | **Resolved** | Not found in `app/wants` or `tests/`; `test_wants_domain.py:127` is now `test_lifecycle_validityPeriod` |
| I2 | Cap link keyed on message text | **Resolved in code**; doc is stale (see N1) | `hooks/useWants.ts:23-34` `WantWriteError` with `status`; `features/wanted/WantFormView.tsx:164` `err instanceof WantWriteError && err.status === 409`; `LIMIT_MESSAGE` is gone; tested in `test/WantFormView.test.tsx` |
| I3 | "To confirm" Polish texts; "0 dni temu" vs "dzisiaj" | **Partly resolved** | Wording aligned: `features/wanted/wantText.ts:60-64` `agoLabel` returns "dzisiaj", used by `WantMatchesView.tsx:307`, tested in `test/wantText.test.ts:99-100`. User sign-off on the other texts is still pending |
| I4 | Cross-file test-helper imports | Residual (info, not fixable here) | Unchanged; the standard has drifted from practice |
| I5 | Two-part test names | Residual (info) | `tests/test_wants_domain.py:41` `test_cleanNote_trimsBlankToNullAndRejectsOverLength`, `:127` `test_lifecycle_validityPeriod` |
| I6 | Work-log "Loaded Per Group" placeholder | Residual (info) | `implementation/work-log.md:13-14` |
| I7 | Old guide screenshot shows the mock | Residual (info, deferred) | Left for the user-documentation phase |

## 2. Plan completion

| Measure | Value |
|---|---|
| Steps | 139 (158 `[x]` incl. 19 group headers; 0 `[ ]`) |
| Completion | 100 % |
| Status | complete |

The fix cycle checked or unchecked nothing. The work-log entry "Verification fixes (Phase 11, cycle 1)" (`work-log.md:443-449`) records the user's choice, the backend and frontend fixes, the changed ItemDetailPage assertion (two `getMyWants` calls) and the standards update.

## 3. Standards compliance (fix-cycle code)

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| frontend/data-fetching.md | Yes | New hook `useWantsMatchingItem`, changes to `useWants` and `CloseWantSheet` | Mostly followed. The hook is in `src/hooks/` and wraps `api/wants.ts`. Its key is `[WANTS_KEY, "matching", token, itemId]` under the wants prefix, so every wants write invalidates it. It has `enabled` gating and a module-level `NO_WANTS` fallback (`useWantsMatchingItem.ts:6,14-16`). Departures (info): it returns only `data`; `CloseWantSheet.tsx:35` makes a direct API call (it does await the prefix invalidation). `WantWriteError` still passes `extractProblemMessage` through (`useWants.ts:29`) |
| frontend/components.md | Yes | ItemPickupActions changed | Followed. The prompt state resets during render on `takenItemId` change (`ItemPickupActions.tsx:47-50`), with no effect |
| backend/models.md | Yes | `create_notifications` inserts Notification rows | Followed. App-side `uuid.uuid4()` ids match the BaseEntity default; `created_at`/`updated_at` are set because a multi-row insert evaluates the default once (`notifications/service.py:75-102`). Wants reaches it only through `infrastructure/notifications_acl.py:12,20` |
| backend/queries.md | Yes | Bulk insert/delete, scan lock | Followed. One multi-row INSERT and one DELETE … RETURNING; the lock is one statement in id order, ACTIVE only (`match_notifications.py:71-75`) |
| backend/time.md | Yes | `create_notifications` timestamps | Followed: `datetime.utcnow()` naive UTC audit timestamps. The text is now correct (W1) |
| backend/migrations.md | Yes | 0099 downgrade now deletes WANT_* notification rows | Followed. The round-trip test asserts it (`tests/test_wants_migration.py:80-91`); the runbook describes it |
| global/error-handling.md | Yes | Error moved; wrapper logs failures | Followed. `errors.py:26`; `main.py:97-105` uses `logger.exception` and then re-raises |
| global/minimal-implementation.md | Yes | Dead code removal | Followed. `findMatching`, `CLOSE_OUTCOMES`, `WantMatchResponse.subtitle` and the `replace_unread_notifications`/`WrittenNotification` API are all removed |
| testing/backend-testing.md, frontend-testing.md | Yes | Changed tests | Followed, apart from I4 and I5 |
| Others (api, security, jooq, css, accessibility, responsive, validation, conventions, coding-style, commenting, plugin-auth) | Unchanged scope / N/A | The fixes touch no routes, matrix, SQL DSL or UI markup patterns. plugin-auth: no plugin code | No change from the previous report |

## 4. Documentation consistency after the fixes

| Artifact | Finding |
|---|---|
| `standards/backend/time.md`, `INDEX.md` Domain Clock | Consistent (W1 resolved) |
| `INDEX.md` architecture entry | Consistent: names `create_notifications`/`delete_unread_notifications`, the 0099 downgrade deleting the `WANT_*` rows, and the stop → delete → start order |
| `architecture.md` 0099 runbook (:645-670) | Consistent with the fixes: the verify step uses `want_scan_markers.scanned_through` (:652); the rollback order is stop → delete → start old image, and the downgrade deletes the rows itself |
| `architecture.md` Scan / notifications (:340-363) | Consistent. :363 describes `create_notifications`. :352 says "Any other error propagates", which is true; the new `logger.exception` is not mentioned (N2, info) |
| `architecture.md` Wants API/Frontend/Known limits | **Stale (N1)**: :399 still lists `subtitle` (always null) in `WantMatchResponse`, but the field was removed from the backend and from `api/wants.ts`. :405 "Data" names only `useWants` and `useWantMatches`, not `useWantsMatchingItem`. :410 says the closing-prompt lookup "calls `api/wants.ts` directly, not `useWants`", but it now goes through `hooks/useWantsMatchingItem.ts`; only the close call is direct. :419 Known limit "cap-error link … keyed on the server's message text" is no longer true (409 via `WantWriteError`) |
| `implementation/spec.md` | FR-F-04 (:370) says `useWants` "serves … the `matched_item_id` lookup", but a separate hook under the same prefix serves it now. FR-F-51 (:413) is met. The intent holds; the wording drifts (N3, info) |
| work-log | The fix entry is present and dated (`work-log.md:443-449`) |

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| N1 | documentation | warning | The Wants section still describes code from before the fixes: removed `subtitle`, the old direct lookup, the old cap-link limit, and the new hook is missing from "Data" | `.maister/docs/project/architecture.md:399,405,410,419` | true | Drop `subtitle` from the card fields; add `hooks/useWantsMatchingItem.ts` to "Data"; say the lookup goes through that hook and only the close call is direct; delete the cap-link known limit |
| R-W4 | standards | info | `CloseWantSheet` calls `closeWant` directly instead of through a hook mutation (it awaits the prefix invalidation and a comment gives the reason) | `src/frontend/src/features/wanted/CloseWantSheet.tsx:34-36` | false (design choice) | Accept, or add a `closeMany` mutation in `useWants` that keeps `WantWriteError.status` per want |
| N4 | standards | info | `useWantsMatchingItem` returns only `data`, not the app-shaped `loading`/`error`/`refetch` | `src/frontend/src/hooks/useWantsMatchingItem.ts:11-19` | true | Accept as documented, or add the fields for uniformity |
| N2 | documentation | info | The Scan concurrency paragraph does not mention that other failures are logged with their traceback before they propagate | `architecture.md:352` vs `src/backend/app/main.py:97-105` | true | Add "logged with `logger.exception`" |
| N3 | documentation | info | FR-F-04 still assigns the `matched_item_id` lookup to `useWants` | `implementation/spec.md:370` | true | Note the separate hook under the wants prefix (spec note or work-log deviation) |
| I3 | documentation | info | Polish texts marked "to confirm" are still waiting for user sign-off (the same-day wording is now aligned) | `implementation/work-log.md` groups 3-17 | true | Review with the user |
| I4 | standards | info | Cross-file test-helper imports | `tests/test_wants_*.py` | false | Update `testing/backend-testing.md` to match practice |
| I5 | standards | info | Two test names are still two-part | `src/backend/tests/test_wants_domain.py:41,127` | true | Rename to `test_<op>_<scenario>_<expected>` |
| I6 | documentation | info | Placeholder never filled | `implementation/work-log.md:13-14` | true | Remove the line |
| I7 | documentation | info | Old guide screenshot shows the mock | `2026-11-12-global-search-group-description/documentation/` | true | Retake in the user-documentation phase |

Issue counts: critical 0, warning 1, info 9.
