# Implementation Completeness Re-verification

**Task:** Product-page reservations, physical location, reserved items on lists, item visibility
**Branch:** `feat/product-page-reservations` (uncommitted, base `bf55353`)
**Checked:** 2026-11-01. This pass re-checks the work after the verification fixes W1–W11 (see `orchestrator-state.yml` → `verification_context.fixes_applied`).

## TL;DR
- **Overall: passed with issues.** Nothing is critical. Of the 3 prior warnings, 2 are resolved (E501, spec 422) and 1 is partly addressed (concurrency test). The fix pass adds **3 new documentation-drift warnings** and 2 info items.
- **Plan:** still 136/136 checkboxes ticked. The fixes added no plan steps.
- **Standards:** the fix code complies. `cache_headers.py`, migration 0077 with its round-trip test, the index declared on the model, and `useReservationSettlement` (awaited prefix invalidation, typed fixtures, explicit vitest imports) all follow the standards. No changed backend file has more ruff findings than at HEAD.
- **Documentation:** INDEX.md and the architecture runbook cover 0077 and `app/core/cache_headers.py`. However, `architecture.md` §Personalised public routes and spec §R(cache table) still describe the old helper and the old route scope. `architecture.md` also still gives the pre-move path of `useItemTake`.

## Key Decisions
- The **ruff baseline is measured per file**, not by total count. Plain `ruff check` reports 79 findings, while the work-log says 50 (the invocation is probably different). Every changed or new backend `.py` file was compared with its `HEAD` version through `--stdin-filename`. No file gained a finding: `circulation/infrastructure/repository.py` has 2→2, `circulation/router.py` 1→1, `exchange_summary.py` 3→3, `groups/application/term_item_listings.py` 3→2, and `tests/test_circulation.py` 4→4. `authorization_matrix.py` is clean with `--select E501`.
- **The work-log has no entry for the fix pass.** This is expected, because the orchestrator writes it. It is listed below as info, not as a gap.
- **The concurrency test counts as "partly addressed", not "resolved".** It is still a deterministic single-session stand-in. It now also asserts that `FOR UPDATE` is emitted and that the losing request re-checks after the lock (W4).

## Open Questions
- Should the W1 decision ("PRIVATE items of RSVP-only owners are not listed or offered") also be written into spec §R2/R13.5 and `architecture.md` §Item visibility? At the moment it is recorded only in `orchestrator-state.yml`.
- Is a real two-connection concurrency test still wanted, or is the forced-ordering test plus the asserted `FOR UPDATE` accepted as enough?

## Risks
- **Docs mislead the next reader about caching scope.** `architecture.md:191` says a private `_set_cache_headers` in `organizer_page.py` covers 3 routes. The spec table (`spec.md:324-334`) says `/actions`, `/events/{id}` and `/access` get "none set, and none added". In the code, the shared helper `app/core/cache_headers.py` is applied to 7 routes, so someone following the docs could remove the headers as "out of spec".
- The 79-vs-50 ruff total is inconsistent with the work-log. This is not a regression, but the test-suite verifier should restate the baseline.

---

## 1. Prior warnings: resolved or residual

| Prior warning | Status | Evidence |
|---|---|---|
| ruff E501 at `authorization_matrix.py:248` | **Resolved** | `ruff check app/core/authorization_matrix.py --select E501` returns "All checks passed". Lines 245-256 are rewrapped. No changed file gained findings compared with HEAD (see Key Decisions). |
| Spec said 422, code and tests use 400 | **Resolved** | `spec.md` lines 46, 102, 149, 408, 680 and 776 now say "400 (fieldErrors — the app's validation handler)". The only `422` left is at line 624, which is a test-file line range (`422–651`), not a status code. |
| Concurrency test uses a single session | **Partly addressed (residual, info)** | `tests/test_reserved_listings.py:162-216` `test_takeAndPropose_concurrent_secondReturns409`: a monkeypatched `lock_item_listing_preference` commits the rival proposal before the lock is taken. It asserts 409, that the SQL contains `FOR UPDATE` (`count_queries`), and that only one PROPOSED row exists. It still runs in one session and one connection, so real cross-connection blocking is not exercised. |

## 2. Plan completion

**Status: Complete.** 136 `[x]` and 0 `[ ]` in `implementation/implementation-plan.md`. The fixes are follow-ups to verification, not plan steps.

Spot checks on the fix code:

| Fix | Evidence |
|---|---|
| W2 migration 0077 | `alembic/versions/0077_swap_proposals_listing_item_index.py`: CONCURRENTLY in `autocommit_block()`, drops any leftover INVALID index first, and the downgrade drops it. The model declares it at `groups/models.py:350-354`. Round-trip test `tests/test_swap_proposals_listing_index_migration.py`. |
| W3 cache headers | `app/core/cache_headers.py` (`set_personalised_cache_headers`, `PUBLIC_CACHE_CONTROL`, `PERSONALISED_CACHE_CONTROL`). Used in `circulation/router.py:217` (`/details`), `events/router.py:98`, `groups/router/circles.py:174` (`/access`), `groups/router/item_actions.py:29`, and `organizer_page.py:49,89,109`. Tests: `tests/test_reserved_listings.py:414-446`, parametrised over actions/details/event/access, with anonymous, authenticated and invalid-token cases plus `Vary`. |
| W4 re-check after lock | Asserted by the concurrency test above. |
| W6 settlement hook | `src/frontend/src/hooks/useReservationSettlement.ts` (`RESERVATION_STATE_KEYS`, awaited `invalidateQueries` before `refetch`, `isAlreadyResolved` shared with `PendingActionsHost.tsx:113`). Test: `src/test/useReservationSettlement.test.tsx`. |
| W9 file move | `pages/term/hooks/useItemTake.ts`, `pages/term/modals/SwapProposeDialog.tsx` and `TakeSuccessSheet.tsx` were renamed to `pages/product/*` (git `RM`). No source file imports the old paths. |
| W11 spec | See §1. |

## 3. Standards compliance of the fix code

**Status: Mostly compliant.** The code is compliant. The gaps are in documentation and listed in §4.

| Standard | Applies? | Reasoning and result |
|---|---|---|
| backend/migrations.md | Yes (0077) | Reversible, explicit `ix_` name, partial index, the downgrade drops it, and a downgrade→upgrade-head pytest exists. CONCURRENTLY follows the 0053 precedent. **Followed.** |
| backend/models.md | Yes | The index is declared on `SwapProposal.__table_args__`, so autogenerate stays in sync. **Followed.** |
| backend/queries.md | Yes | 0077 is "strategic indexing via Alembic" for the pending-proposal lookup. **Followed.** |
| backend/api.md / security.md | Yes (headers on public routes) | No route or matrix changes. The headers are set only on success. **Followed.** |
| global/minimal-implementation.md | Yes | One helper replaces the per-router copies. The constants are all used (`PUBLIC_CACHE_CONTROL` is reused by the `/terms` route). **Followed.** |
| global/commenting.md | Yes | The comments in `cache_headers.py` and 0077 explain non-obvious reasons (why it is safe, why CONCURRENTLY). There are no change-log comments. **Followed.** |
| global/coding-style.md | Yes | No new ruff findings in changed files. **Followed.** |
| testing/backend-testing.md | Yes | Flat `tests/test_<feature>.py`, camelCase scenario names, exact header assertions. **Followed.** The long test name carries `# noqa: E501`, which is acceptable. |
| frontend/data-fetching.md | Yes (settlement hook) | Mutations `await invalidateQueries` on whole resource prefixes, `extractProblemMessage` errors are passed through verbatim, and the hook lives in `src/hooks/`. **Followed.** |
| testing/frontend-testing.md | Yes | Explicit `vitest` imports, `createQueryWrapper`/`createTestQueryClient`, `vi.resetAllMocks()` in `beforeEach`, a fully typed `AcceptedSwapProposalResponse` factory with no casts, `it.each` tables. **Followed.** |
| frontend/components.md, accessibility.md | Yes (W5 hint, W6 confirm dialog) | Not re-audited line by line in this pass. The prior report found them compliant and the fixes use the existing `aria-describedby` pattern. **Assumed followed** (code review covers it). |
| backend/time.md | Marginal | `useReservationSettlement` formats dates through `utils/dayjs`. No backend clock changes. **Followed.** |
| backend/jooq.md, plugin-auth.md, frontend/css.md, responsive.md | No | Not touched by the fixes. |

## 4. Documentation completeness

**Status: Adequate.** All required documents exist, but three drifts were introduced by the fixes.

| # | Artifact | Issue | Severity | Fixable |
|---|---|---|---|---|
| D1 | `.maister/docs/project/architecture.md:191` | §Personalised public routes still names `_set_cache_headers` in `app/groups/router/organizer_page.py` and lists only the 3 organizer and owner routes. The code uses `app/core/cache_headers.py.set_personalised_cache_headers` on `/api/items/{id}/actions`, `/api/inventory-items/{id}/details`, `/api/events/{id}` and `/api/groups/public/{id}/access` as well. This contradicts INDEX.md, which already names `app/core/cache_headers.py`. | warning | yes |
| D2 | `implementation/spec.md:324-334` | The R(cache) table still says `/access`, `/events/{id}` and `/actions` get "none set, and none added", that `/details` is not listed, and that "a single helper in `groups/router/organizer_page.py`" exists. This is spec drift from W3. | warning | yes |
| D3 | `.maister/docs/project/architecture.md:188` | It still says writes go through `pages/term/hooks/useItemTake.ts`. After W9 the path is `pages/product/useItemTake.ts`. | warning | yes |
| D4 | `implementation/spec.md` | Migration 0077 is not mentioned anywhere: §Docs/migrations list 0074–0076 only. The architecture runbook and INDEX do cover it. | info | yes |
| D5 | `implementation/spec.md` §R2.3 / R13.5, `architecture.md:184,194` | The W1 user decision (an RSVP-only owner's PRIVATE items are neither listed nor offered on that private term) is not written down. The spec offers PRIVATE-circle terms to an owner who "holds a non-withdrawn RSVP". | info | yes |
| D6 | `implementation/work-log.md` | There is no entry for the verification fix pass. **Expected**: the orchestrator logs it after re-verification. | info | yes |

The following are aligned and correct:
- INDEX.md architecture summary: "migrations 0074–0077 … 0077 partial index on pending swap proposals; personalised public GETs use `app/core/cache_headers.py`"; both guard counts are mentioned.
- architecture.md: line 176 names 0077. The runbook "Deploy / rollback … (migrations 0074–0077)" at lines 329-345 covers 0077 CONCURRENTLY, the rollback order 0077→0074, `lock_timeout` on 0074–0076, the mandatory step of running both guard counts before any downgrade (W7), and the guard on 0076.

## 5. Issue summary

| Source | Severity | Description | Location |
|---|---|---|---|
| documentation | warning | Cache-header doc names an old helper and covers only 3 routes | `architecture.md:191` |
| documentation | warning | Spec cache table contradicts W3 | `spec.md:324-334` |
| documentation | warning | Stale `useItemTake` path after the move | `architecture.md:188` |
| documentation | info | 0077 not in spec | `spec.md` |
| documentation | info | W1 decision not in spec or architecture | `spec.md:122-128`, `architecture.md:184` |
| documentation | info | Fix pass not yet in work-log (expected) | `work-log.md` |
| standards | info | Concurrency test still single-session (residual) | `tests/test_reserved_listings.py:162` |

Counts: critical 0, warning 3, info 4.
