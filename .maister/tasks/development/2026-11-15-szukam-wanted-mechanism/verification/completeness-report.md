# Implementation Completeness Report — "Szukam" (wanted) mechanism

## TL;DR
- Status: **passed_with_issues**. All 139 plan steps are checked (158 boxes = 139 steps + 19 group headers); spot checks found code for every group.
- Standards: mostly compliant. The one new finding: the item page fetches wants with `useState` + `useEffect`, and `CloseWantSheet` calls `closeWant` directly, both against `frontend/data-fetching.md`. The work log records this as a deviation, but it still breaks the standard.
- Documentation: complete. The work log has an entry for every group plus a reading log; architecture.md has the Wants section, the 0099 runbook and the release gate; INDEX.md is updated.
- Known items: 4 confirmed. One (`CLOSE_OUTCOMES` unused) is confirmed with a correction: no app code uses it, but `tests/test_wants_domain.py:130` asserts it, so it is dead code in production that a test keeps alive.
- No critical issues; 4 warnings and 7 info items.

## Key Decisions
- The deviation on the item page (direct `api/wants.ts` calls instead of `useWants`) is counted as a standards **warning**, not critical. The reason is documented and sound (it avoids loading the whole list on every item page and keeps the HTTP status), but it breaks the data-fetching standard and FR-F-04's wording, and the `findMatching` hook member it bypasses is now dead code.
- Cross-file test-helper imports (`from tests.test_term_item_listings import _auth, _register`, ...) contradict `testing/backend-testing.md` ("each test file defines its own small private helpers"). They are rated **info**, because 65 of the existing 164 test files already do the same (the standard has drifted from practice).
- The reverse-scan budget miss is not raised (the user accepted it).

## Open Questions / Risks
- Should `standards/frontend/data-fetching.md` allow a documented exception for one-shot lookups after a mutation (the closing-prompt case), or should the lookup move into a hook (e.g. a `useMutation`-style `findMatching` with status kept)? The answer decides whether the item-page code or the standard changes.
- `standards/testing/backend-testing.md` says per-file helpers, but practice shares them across files. The team should pick one.

---

## 1. Plan completion

| Measure | Value |
|---|---|
| Steps (plan Overview) | 139 |
| Checked step boxes | 139 (158 `[x]` incl. 19 group headers; 0 `[ ]`) |
| Completion | 100 % |
| Status | complete |

### Code spot checks (per group)

| Group | Evidence found |
|---|---|
| 1 Baseline | `implementation/baseline/` (6 files + `final-comparison.md`), work-log "Baseline (Group 1)" |
| 2 Visibility annotations | `git diff` of `app/groups/infrastructure/visibility.py`: 13 lines, annotations/docstrings |
| 3 Notifications/moderation | `app/notifications/service.py` (+78: `replace_unread_notifications`, `delete_unread_notifications`), `text_guard.py` (+6) |
| 4 Model + 0099 | `alembic/versions/0099_wants.py:54,149` `SET LOCAL lock_timeout`; named `pk_`/`fk_`/`ck_`/`uq_`/`ix_` constraints; generated columns at :100-104; `app/wants/models.py` `Computed(..., persisted=True)` + `deferred_raiseload=True` (:108-118), business-key `__eq__` |
| 5 Domain + ACLs | `app/wants/domain/*.py` (6 files), 9 `infrastructure/*_acl.py`; `tests/test_module_boundaries.py:17` `MODULES = ("pages", "search", "wants")`; `tests/test_domain_clock_guard.py:28-35` includes `wants` |
| 6 Matcher | `app/wants/application/matcher.py` (300 lines), `text_queries.py` |
| 7 Measurement | work log: `implementation/measurement/results.md`, the lever changes in `matcher.py`; no 0100 (decision recorded) |
| 8 Want API | `app/wants/router/wants.py` (7 routes of the group, no DELETE), `authorization_matrix.py:246-247` rows 66-67, `app/main.py:194` `include_router(wants_router)` |
| 9 Match list API | `router/wants.py` `/matches`, `/matches/seen`, `/matches/{item_id}/opened` (204); `reads.list_matches` |
| 10 Scan | `application/scan.py`, `match_notifications.py` (`clock.fit_notification_message` at :105); `app/main.py:90-100` wrapper, `:146` interval job |
| 11 Data layer | `api/wants.ts`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`, `test/fixtures/wants.ts` (no `as` casts) |
| 12 Shared components | `components/shared/RadiusChips.tsx`, `chipStyles.ts`; props on `ItemCard`, `CategoryTreePicker`, `LocalityCombobox` |
| 13-15 Views | `features/wanted/` (13 files), three `*ViewState.ts` with `it.each` tests |
| 16 Routes | `app/(site)/(panel)/wanted/[id]/page.tsx`, `[id]/edit/page.tsx`, `add/wanted/page.tsx`; `add/hunting/page.tsx`, `WantedView.tsx`, `HuntingCreateView.tsx` deleted (git status `D`) |
| 17 Closing prompt | `features/wanted/CloseWantSheet.tsx`, `ItemPickupActions.tsx:43-59` |
| 18 Docs | `architecture.md:290` "## Wants", `:642` 0099 runbook, `:644` release gate |
| 19 Test review | 6 added tests (work log); `final-comparison.md` |

No unchecked step was found, and no step lacks code.

---

## 2. Standards compliance

### Applicability reasoning

| Standard | Applies? | Reasoning | Result |
|---|---|---|---|
| global/error-handling.md | Yes | New typed errors, 503 on timeout, inline UI errors | Followed (typed exceptions in `application/errors.py`; one stray class, see W3) |
| global/validation.md | Yes | Name/note/radius rules, form | Followed (server 400s; inline `role="alert"`, `aria-invalid`, `aria-describedby` in `WantFormView.tsx:217-218,273-274`; no numeric inputs) |
| global/conventions.md | Yes | Docs, structure | Followed |
| global/coding-style.md | Yes | All code | Followed (spot check) |
| global/commenting.md | Yes | All code | Followed; docstrings explain intent, no change-log comments seen |
| global/minimal-implementation.md | Yes | New module | Gaps: `CLOSE_OUTCOMES` (I1), `useWants.findMatching` unused in production (W2) |
| backend/api.md | Yes | `/api/wants` | Followed (plural resource, ≤2 nesting levels, 201/204) |
| backend/models.md | Yes | 3 new entities, 9 ACLs | Followed (BaseEntity, `_enum_column`, no `relationship()`, one ACL per foreign module, no `..schemas` import) |
| backend/queries.md | Yes | Matcher, reads, scan | Followed (statement counts pinned constant: create 9, list 3, match list 6, scan 13) |
| backend/jooq.md (Core) | Yes | Hand-built Core statements | Followed (bind params; the only f-string SQL is `SET LOCAL statement_timeout` with a module constant, `writes.py:80`) |
| backend/migrations.md | Yes | 0099 | Followed (lock_timeout, explicit names, reverse-order downgrade, round-trip test, runbook) |
| backend/security.md | Yes | New routes | Followed (`require_any("READ"/"EDIT")` per route, matrix rows 66-67 + tests) |
| backend/time.md | Yes | Expiry, scan | Code complies (`datetime.utcnow()` naive UTC for audit-type timestamps, guard extended). The standard's text is stale (W1) |
| backend/plugin-auth.md | No | No plugin code touched | — |
| frontend/components.md | Yes | Views, routes | Followed (thin `"use client"` routes, `resolve…View()` + `it.each`, navigation via facade, no `next/navigation` imports) |
| frontend/accessibility.md | Yes | Form, sheet, switch, dialog | Followed (`role="switch"`/`aria-checked`, `aria-expanded`/`aria-controls`, `aria-disabled` + hint with native `disabled` only while busy `WantFormView.tsx:300-304`, `ModalSheet` registers via `useRegisterOpenSheet` by default, `ConfirmDeleteDialog` for withdraw, every button `type="button"`/`submit`) |
| frontend/data-fetching.md | Yes | Hooks, item page | **Gap (W4)**: `useState` + `useEffect` fetch in `ItemPickupActions.tsx:43-59`; direct mutation call in `CloseWantSheet.tsx:35-36` |
| frontend/css.md | Yes | Tailwind classes | Followed (shared `chipStyles.ts` tokens) |
| frontend/responsive.md | Yes | New pages | Not contradicted by the code; not checked in a browser |
| testing/backend-testing.md | Yes | 8 new test files | Mostly followed (count_queries, exact key sets, leaf_category_ids, camelCase names: all but 2 names match `test_<op>_<scenario>_<expected>`). Cross-file helper imports (I4) |
| testing/frontend-testing.md | Yes | 14 new/changed test files | Followed (explicit `from "vitest"`, `useFakeTimers({ toFake: ["Date"] })` + `useRealTimers`, typed fixtures, `src/test/`) |

Checked 23 standards; 22 apply; 18 fully followed, 4 with gaps (time.md text, minimal-implementation, data-fetching, backend-testing).

### Gaps with evidence

- **W1 — backend/time.md (warning, fixable)**: `.maister/docs/standards/backend/time.md:9` says the guard covers "`app/groups/application`, `app/groups/router`, `app/events` and `app/pages`", but `tests/test_domain_clock_guard.py:28-35` also guards `app/search` and `app/wants`. The INDEX.md "Domain Clock" summary repeats the stale list. **Confirmed** (the known item).
- **W4 — frontend/data-fetching.md (warning)**: `features/product/blocks/ItemPickupActions.tsx:43-59` fetches `getMyWants(takenItemId)` in a `useEffect` into `useState`. The standard says "no `useState`+`useEffect` fetching". `features/wanted/CloseWantSheet.tsx:35-36` calls `closeWant` directly and invalidates the prefix itself instead of using the hook's mutation. FR-F-04 also says `useWants` "serves … the `matched_item_id` lookup of the closing prompt". The work log (group 17) and architecture.md:410 document the deviation; the code still breaks the standard.
- **W2 — minimal-implementation (warning, fixable)**: `hooks/useWants.ts:19,68,80` `findMatching` has no production caller. Only `test/useWants.test.tsx:123` uses it, because the item page bypasses it (W4).
- **I1 — minimal-implementation (info, fixable)**: `app/wants/domain/lifecycle.py:22` `CLOSE_OUTCOMES` has no app caller; the request schema restricts `outcome`. **Confirmed, with a correction**: `tests/test_wants_domain.py:130` asserts it, so a test keeps the dead constant alive.
- **W3 — error placement (warning, fixable)**: `app/wants/application/writes.py:44` `WantMatchNotFound`, against the plan's key decision that exceptions live in `application/errors.py`. **Confirmed.**
- **I4 — backend-testing.md (info)**: the wants test files import private helpers from other test files (e.g. `tests/test_wants_api.py:30-33`, `tests/test_wants_matches_api.py:21-28`, `tests/test_wants_lifecycle.py:20-23`), against "Each test file defines its own small private helpers". 65 existing test files do the same, so the standard has drifted.
- **I5 — test naming (info)**: `tests/test_wants_domain.py:41` `test_cleanNote_trimsBlankToNullAndRejectsOverLength` and `:127` `test_lifecycle_closeOutcomesAndValidityPeriod` have two parts, not the `test_<operation>_<scenario>_<expected>` three.

---

## 3. Documentation completeness

| Artifact | Finding |
|---|---|
| implementation-plan.md | Intact; all 139 steps `[x]` |
| work-log.md | Start entry, baseline section, one dated completion entry for each of the 19 groups, each with a "Standards Reading Log" subsection, a resume entry, the user decision on the reverse budget, and the final "Implementation Complete" entry with open items. Complete. Note: the top "Loaded Per Group" placeholder ("Entries added as groups execute") was never filled; the per-group subsections replace it (I6, cosmetic) |
| Spec alignment | 151 FR ids and 50 AC ids in spec.md; the plan's traceability table maps all of them. Spot checks: FR-A-01 (`matched_item_id`, `router/wants.py:39-44`), FR-A-14 (matrix rows), FR-L-04 (close WITHDRAWN), FR-F-41 (`AccountView.tsx:12-15,56`), FR-F-53 (`CloseWantSheet.tsx:47` title/ariaLabel), FR-N-04 cap (`match_notifications.py:105`) all present. Deviation: FR-F-04 / FR-F-51 (lookup through `useWants`), see W4 |
| architecture.md | "## Wants (`app/wants/`)" at :290, frontend notes :405-419 incl. the cap-link limitation, fold_pl note :640, "Deploy / rollback for wants (migration 0099)" at :642 with the release gate (:644) and the notifications-row cleanup before rollback |
| INDEX.md | Architecture entry updated with the wants summary. The Domain Clock summary is still stale (W1) |
| Old search user guide | Updated (group 18); the screenshot `12-lista-szukam-wypelniona.png` still shows the mock (left for the user-documentation phase, I7) |
| User docs for this feature | `documentation/` folder empty; the plan assigns it to a later phase (FR-D-13 note) |

### Known items — confirm/refute
| Known item | Verdict |
|---|---|
| time.md lists guarded packages without `app/search`, `app/wants` | Confirmed (`time.md:9`, also the INDEX summary) |
| "Zobacz listę" link keyed on cap text | Confirmed: `WantFormView.tsx:44` `LIMIT_MESSAGE`, `:193` `serverError === LIMIT_MESSAGE` (I2) |
| `WantMatchNotFound` in `writes.py` | Confirmed: `writes.py:44` |
| `CLOSE_OUTCOMES` unused | Confirmed in app code; a test still asserts it (`test_wants_domain.py:130`) |
| Many "to confirm" Polish texts | Confirmed: listed in the work log for groups 3, 5, 10, 11, 13, 14, 15, 16, 17 (I3); includes a mismatch, "0 dni temu" in the list vs "dzisiaj" on the match page (group 15 note) |

---

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| W1 | standards | warning | time.md / INDEX summary list of clock-guarded packages misses `app/search`, `app/wants` | `.maister/docs/standards/backend/time.md:9`, INDEX.md Domain Clock entry | true | Run `/maister:standards-update` to add both packages |
| W2 | standards | warning | `useWants.findMatching` has no production caller | `src/frontend/src/hooks/useWants.ts:19,68,80` | true | Remove it and its test, or route the item-page lookup through it (see W4) |
| W3 | standards | warning | `WantMatchNotFound` outside `application/errors.py` | `src/backend/app/wants/application/writes.py:44` | true | Move it to `errors.py` beside `WantNotFound` |
| W4 | standards | warning | `useState`+`useEffect` fetch and a direct mutation call bypass the hooks (data-fetching standard, FR-F-04) | `features/product/blocks/ItemPickupActions.tsx:43-59`, `features/wanted/CloseWantSheet.tsx:35-36` | false (design choice) | Either add a hook (query keyed on `[WANTS_KEY, "matching", itemId, token]`, enabled after a take; keep the status in a typed error) or record a standards exception |
| I1 | standards | info | `CLOSE_OUTCOMES` unused in the app, kept alive only by a test | `app/wants/domain/lifecycle.py:22`, `tests/test_wants_domain.py:130` | true | Delete the constant and its assertion, or use it in `CloseWantRequest` |
| I2 | documentation | info | Cap link depends on the message text | `features/wanted/WantFormView.tsx:44,193` | true | Keep the HTTP status in the `useWants` error (e.g. an `ApiError` with status) and key the link on 409 |
| I3 | documentation | info | Polish texts marked "to confirm" need user sign-off; "0 dni temu" (list) vs "dzisiaj" (match page) differ | `implementation/work-log.md` groups 3-17 | true | Have the user review the list; align the same-day wording across the two views |
| I4 | standards | info | Cross-file test-helper imports against the per-file-helper rule | `tests/test_wants_*.py` import blocks | false | Update `testing/backend-testing.md` to reflect practice, or leave as is |
| I5 | standards | info | Two test names lack the three-part pattern | `tests/test_wants_domain.py:41,127` | true | Rename to `test_<op>_<scenario>_<expected>` |
| I6 | documentation | info | Work-log "Loaded Per Group" placeholder never filled (per-group subsections cover it) | `implementation/work-log.md:13-14` | true | Remove the placeholder line |
| I7 | documentation | info | Old guide screenshot still shows the mock | `2026-11-12-global-search-group-description/documentation/` | true | Retake in the user-documentation phase |

Issue counts: critical 0, warning 4, info 7 (incl. I7).
