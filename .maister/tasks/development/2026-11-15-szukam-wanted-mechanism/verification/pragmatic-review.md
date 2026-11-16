# Pragmatic Review: "szukam" (wanted posts)

## TL;DR

- Status: **Appropriate, with small cleanups**. No critical over-engineering. The ACL-per-module layout, the `*ViewState.ts` resolvers and the matcher's tuned SQL are team conventions or were measured, and they earn their keep.
- 3 warnings: a "replace unread" notifications API whose replace half has no production caller (`previous_id` / `previous_deleted`); the closing prompt's wants lookup goes around `useWants`, so `findMatching` is dead and the prompt fetches with `useEffect`; and the form spots the 30-wants cap by comparing the Polish error text character for character.
- 7 info items: `CLOSE_OUTCOMES` is used only by a test, a dead `subtitle` field, a copied haversine, two small backend duplications, frontend focus-ring and action-runner copies, and two write-only measurement columns.
- The matcher after levers (a)+(b) pays for itself (38.3 s down to 5.7 s at the budget point, forward plans unchanged). No simplification of it is recommended.
- Estimated cleanup: about 1.5–2 h, about −80 LOC net, no behaviour change.

## Key Decisions

- The ACL-per-module layout (9 files, 165 LOC) is **not** flagged. `tests/test_module_boundaries.py` requires it. Each file is a thin re-export, and only one exported name (`WrittenNotification`) is unused.
- The view-state resolvers (`wantedListViewState.ts`, `wantFormViewState.ts`, `wantMatchesViewState.ts`) are **not** flagged. They follow `standards/frontend/components.md`, they are small (28/109/52 LOC) and they are table-tested.
- **The matcher's complexity is accepted.** The `_Listing` record with `dataclasses.fields()` reflection, the `MATERIALIZED` window CTE, the lateral category path and the `CASE` evaluation-order trick are each tied to a measured gain in `implementation/measurement/results.md`. The module docstring and comments explain them.
- The `want_scan_markers` table, together with the `StaleDataError`/`IntegrityError` skip handling in `app/main.py`, is **accepted**. It follows the existing `GiveawayTermEndMarker` pattern, and the window needs to survive downtime.

## Open Questions / Risks

- `want_matches.opened_at` and `want_matches.source` are written and never read. The spec calls them "measurement only" (spec.md:186-189). Keep them only if someone will actually query them for the threshold release gate. Otherwise they cost a route, an API call, a hook method and a POST on every card click.
- The `CASE WHEN <plain columns> THEN <name match>` ordering (matcher.py:216-222) depends on the PostgreSQL planner. A future PostgreSQL upgrade could change the cost model. The measurement scripts can re-check it; no code change is needed.

---

## 1. Complexity Assessment

| Dimension | Observation | Verdict |
|---|---|---|
| Project scale | Early production: a real user-facing marketplace with runbooks, migrations and module-boundary guards (architecture.md) | Medium complexity is expected |
| Backend size | `app/wants/` ≈ 2,140 LOC: application 1,348, domain 220, infrastructure 165, models 190, router 106, schemas 101 | Proportional to 10 routes, 3 tables, a scan job and 2 notification kinds |
| Frontend size | `features/wanted/` 1,467 + api 109 + hooks 158 + shared chips 30 ≈ 1,760 LOC | Proportional to 3 pages and a prompt |
| Tests | Backend: 66 tests in 8 files, ≈ 2,900 LOC. Frontend: ≈ 1,750 LOC | On the high side but tied to the spec's FR-T rows. Only the notification tests for the unused replace path (W1) are surplus |
| Infrastructure | No new infrastructure: APScheduler job, PostgreSQL pg_trgm/full text already in place | Appropriate |

Overall complexity is **Medium**, which is appropriate for this scale.

## 2. Key Issues Found

### Critical

None.

### Warning

**W1. The notifications service's "replace" semantics have no production caller.**
- Evidence: `src/backend/app/notifications/service.py:37-117` adds `NotificationEntry.previous_id`, `WrittenNotification.previous_deleted` and a delete step inside `replace_unread_notifications`. The only production caller, `src/backend/app/wants/application/match_notifications.py:242-251`, always passes `previous_id=None`. It deletes the old rows itself beforehand (`:293-296`, through `delete_unread_notifications`) and reads only `.id` from the result (`:343`).
- Problem: this is a speculative API. Readers will look for a replace path that never runs, and `tests/test_wants_notifications.py:80-142` spends two tests (≈ 60 LOC) proving it works.
- Fix (fixable, ~20 min): turn it into `create_notifications(db, entries) -> list[uuid.UUID]` (one INSERT), drop `previous_id`, `WrittenNotification` and its ACL export (`infrastructure/notifications_acl.py:11,20`), and cut those tests down to the insert/id-order/no-statement cases.

```python
# before
written = await notifications_acl.replace_unread_notifications(db, entries)
... zip(pointed, written[: len(pointed)]) ... row.id
# after
ids = await notifications_acl.create_notifications(db, entries)
... zip(pointed, ids[: len(pointed)])
```

**W2. The closing prompt goes around the wants hook, and `findMatching` is dead.**
- Evidence:
  - `src/frontend/src/hooks/useWants.ts:379-380,429`: `findMatching` is referenced only in `test/useWants.test.tsx`.
  - `src/frontend/src/features/product/blocks/ItemPickupActions.tsx:44-60` calls `getMyWants(takenItemId)` itself in a `useEffect` with `useState`.
  - `src/frontend/src/features/wanted/CloseWantSheet.tsx:27,35-36` calls `closeWant` and invalidates `[WANTS_KEY]` itself instead of using `useWants().close`.
- Problem: the same feature has two data paths, one of them dead. `ItemPickupActions` breaks `standards/frontend/data-fetching.md` ("no `useState`+`useEffect` fetching, no ad hoc ... in components"). Spec FR-F-04 says the hook "serves ... the `matched_item_id` lookup", and the code no longer does.
- Fix (fixable, ~30 min): replace `findMatching` with a small query hook, `useWantsMatchingItem(itemId: string | null)` (`enabled: itemId !== null`, key `[WANTS_KEY, "matching", token, itemId]`), and use it in `ItemPickupActions`. `CloseWantSheet` can keep calling the API directly, because it needs the raw `ApiError` status for its 404/409 tolerance, which `passingMessageThrough` throws away. Say why in one comment. If you'd rather not add a hook, at least delete `findMatching` and its test.

**W3. The cap error is recognised by comparing message text.**
- Evidence: `src/frontend/src/features/wanted/WantFormView.tsx:44,193` hard-codes `"Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe."` and compares it with `===` against the server message from `src/backend/app/wants/domain/messages.py:126-128`.
- Problem: any wording change or change to `MAX_ACTIVE_WANTS` silently drops the "Zobacz listę" link. It is also a third copy of the number 30.
- Fix (fixable, ~15 min): keep the HTTP status through the hook. For example, `passingMessageThrough` could rethrow an `Error` carrying `status`, or rethrow the `ApiError` with its message replaced. Then test `status === 409` on create; the cap is the only 409 that `create_want` can raise.

### Info

**I1. `CLOSE_OUTCOMES` is unused.** `src/backend/app/wants/domain/lifecycle.py:24` is referenced only by `tests/test_wants_domain.py:130`. `CloseWantRequest.outcome: Literal[FULFILLED, WITHDRAWN]` (`schemas.py:396`) already enforces the rule. Delete the constant and that assert. Fixable, 2 min.

**I2. `WantMatchResponse.subtitle` is always `None`.** It is set at `src/backend/app/wants/application/reads.py:277`, declared at `schemas.py:444` and in `src/frontend/src/api/wants.ts:307`, and never read (`MatchCard.tsx` ignores it). Drop the field from both sides and from the key-set assertion. Fixable, 10 min.

**I3. The haversine expression is copied.** `src/backend/app/wants/application/matcher.py:58,90-103` repeats `src/backend/app/search/application/search.py:133,183-196`, `EARTH_RADIUS_KM` included. Module boundaries forbid importing `app.search`, but both modules already reach `app.locations` through an ACL. A `locations.service.distance_km(lat1, lng1, lat2, lng2)` SQL-expression helper would remove the copy. Fixable, 20 min. It is low priority while there are only two copies.

**I4. Small backend inconsistencies.**
- `WantMatchNotFound` is defined in `src/backend/app/wants/application/writes.py:44-49`, while every other want error lives in `application/errors.py`. Move it there.
- `resume_want` (`writes.py:287-288`) writes out `_start_new_period` (`:125-127`) by hand instead of calling it.
- `category_acl.py:1-4`: the docstring promises "its existence check and its name and path", but the file only re-exports the table. Trim the docstring.

All three are fixable in about 5 min.

**I5. Frontend duplication introduced alongside a new shared helper.**
- This task created `components/shared/chipStyles.ts` with `FOCUS_CLASS`, yet `WantMatchesView.tsx:20` (`FOCUS`) and `WantedListView.tsx:22` (`FOCUS_RING`) declare the same string again. Import `FOCUS_CLASS`.
- The busy/error action runner exists twice: `WantedListView.tsx:130-147` (`useWantAction`) and `WantMatchesView.tsx:58-68` (`run`). Acceptable at two uses; keep it in mind if a third appears.
- The "closed N days ago" label differs: the list shows "0 dni temu" (`WantedListView.tsx:230`) while the match page shows "dzisiaj" (`WantMatchesView.tsx:305-307`, `agoLabel`). Moving `agoLabel` to `wantText.ts` and using it on both pages fixes the inconsistency.

Fixable, about 15 min.

**I6. Two columns are written and never read (`opened_at`, `source`).** See Open Questions. They are specified, so they are not a defect, but `POST /matches/{item_id}/opened`, `markWantMatchOpened`, `useWantMatches.markOpened` and the `onClick` on each card exist only to fill `opened_at`.

**I7. The scan's log line costs a statement.** `src/backend/app/wants/application/scan.py:81-99` (`_window_sizes`) runs an extra count statement every 15 minutes only for the log. It is cheap (about 1 ms at 20k listings), so leave it. Noted only so nobody "optimises" it later.

## 3. Developer Experience

- **Good:** module docstrings explain *why*, for example the matcher's two directions and the scan's race handling. Polish texts sit in one place (`domain/messages.py`), and validation is pure and unit-tested. Writes are linear and readable, one use case per function, with a shared `_own_want`/`_ensure_allowed` pair.
- **Good:** the measurement can be reproduced from the task folder (`measurement_db.py` with safety guards), so later tuning has a baseline.
- **Friction:** the three items under W2 and W3 are the main traps. A developer adding a "matching wants" read will find two mechanisms, one of them dead. A copy editor who rewords the cap message breaks the form.
- **Friction (minor):** `lifecycle.py` keeps two parallel dicts keyed by `WantAction` (`_ALLOWED_IN`, `_REFUSALS`). It is readable at four actions, so no change is needed.

## 4. Requirements Alignment

- The implementation matches spec scope. Nothing outside the spec was found except the unused `replace` half of W1, which is speculative generality.
- FR-F-04 is drifted: the spec places the `matched_item_id` lookup in `useWants`, but the code does it ad hoc in `ItemPickupActions` (W2).
- Performance: forward matching meets its 300 ms budget. The reverse scan misses its 2 s budget at the largest point (5.7 s), and the user accepted that. No unrequested future-proofing was added: no `created_at` index, no outbox fallback, no want-side trigram index. These were deliberately deferred.

## 5. Context Consistency

| Indicator | Evidence |
|---|---|
| Same thing done two ways | Wants lookup and close: hook vs direct API (W2). Focus-ring constant (I5). Haversine (I3) |
| Unused code | `CLOSE_OUTCOMES` (I1), `findMatching` (W2), `previous_id`/`previous_deleted`/`WrittenNotification` (W1), `subtitle` (I2) |
| Inconsistent placement | `WantMatchNotFound` in `writes.py` (I4) |
| Stale docs | `category_acl.py` docstring (I4) |
| Abandoned patterns | None. The measurement report says the rejected correlated-subquery attempt is "not in the code", and that checks out |

## 6. Matcher Complexity vs Measured Value

| Construct | Location | Gain measured | Keep? |
|---|---|---|---|
| `window_listings AS MATERIALIZED` + `_Listing` record shared by both directions | matcher.py:106-118,159-183 | 38.3 s → 24.0 s (lever a) | Yes |
| `CASE` to compare plain columns before names (window only) | matcher.py:216-222 | Part of 24.0 s → 5.7 s (lever b) | Yes |
| Lateral per-product category path + `= ANY` | matcher.py:74-87,194 | Part of lever b; keeps forward index plans | Yes |
| Short words checked before `<%` | matcher.py:200-213 | Part of lever b | Yes |
| `_matchable_wants`, `_store` helpers | matcher.py:64-71,274-277 | Tiny readability helpers | Neutral |

The `dataclasses.fields()` reflection (`:175,182`) is the one spot that is slightly clever. In return, a new listing attribute is added in one place for both directions, which is the guarantee that the two directions apply the same rules. It is worth keeping.

## 7. Top 3 Recommended Simplifications

1. **W1:** collapse `replace_unread_notifications` into `create_notifications`. About −45 LOC (service, ACL, 2 tests); removes one dataclass and one parameter.
2. **W2:** one wants-lookup path: a query hook instead of `useEffect` in `ItemPickupActions`, and delete `findMatching`. About −15 LOC net, and it complies with the data-fetching standard again.
3. **W3:** branch on the status, not the message. About −2 LOC, and the hard-coded Polish/"30" copy goes away.

Then the quick sweep: I1, I2, I4 and I5 (about −20 LOC).

## 8. Summary Statistics

| Metric | Current | After simplifications |
|---|---|---|
| Unused production symbols | 5 (`CLOSE_OUTCOMES`, `findMatching`, `previous_id`, `WrittenNotification`, `subtitle`) | 0 |
| Data paths for "wants matching item" | 2 | 1 |
| Copies of the cap message / limit | 3 (backend message, frontend text, frontend "30") | 1 |
| Haversine copies | 2 | 2 (or 1 with I3) |
| Net LOC | — | ≈ −80 |
| New dependencies / infrastructure | 0 | 0 |

## 9. Conclusion

The feature is sized to its problem. The layered layout comes from project rules, and the only intricate code (the matcher) is backed by measurements. The cleanups are small: remove dead or speculative surface (W1, I1, I2), bring one stray data path back to the standard (W2), and stop matching the error by its text (W3). Estimated effort is about 1.5–2 hours with no behaviour change. None of this blocks the release.
