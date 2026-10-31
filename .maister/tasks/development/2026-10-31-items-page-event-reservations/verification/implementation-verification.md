# Implementation Verification Report

**Task**: Owner items page, attendee items on event/term pages, event item reservations
**Location**: `.maister/tasks/development/2026-10-31-items-page-event-reservations`
**Verification cycle**: 1 (initial)

## TL;DR
⚠️ **Passed with Issues, after fixes**: 0 critical. 1 warning still open: W10, rate limiting across the whole platform, which is out of scope. The other 9 warnings are fixed (see Fix & Re-Verification History).
- Plan: 105/105 steps done; all 35 spec requirements and 13 design entries are covered.
- Cycle 1 results:
  - Backend tests: 1028/1028 pass.
  - Frontend tests: 1295/1308 pass. All 13 failures also fail on a clean HEAD.
- After fixes, tests were run only on the affected areas, not the full suite:
  - Backend: 177 + 175 pass.
  - Frontend: 198/199 pass. The one failure is a known one that predates this work.
  - tsc: 0 errors.
- The user chose to skip a full re-verification. E2E (Phase 12) is the runtime check.

## Open Questions / Risks
- resolved: **Owner identity is public (W2)** — user decision: name stays public, 404 for parties with nothing listed. Anonymous visitors see the item owner's `display_name` and `party_id` through `/api/items/{id}/actions` and `/api/groups/public/parties/{id}/items`, plus the owner's nearest date. This covers people who are not Organizations. Someone has to decide whether that is acceptable.
- resolved: **Lock released mid-flow (W1)** — single commit + proposal FOR UPDATE. The event `FOR SHARE` lock does not hold through take/propose/accept, because `create_reservation` and `confirm_reservation` commit inside the flow. A `delete_event` running at the same time can produce a 500 `StaleDataError` or leave a PROPOSED proposal that can never be resolved.
- **Rollback is forward-only once event reservations exist.** Rolling back after that point means following the 0073 runbook: purge the event rows manually or restore the dump.
- **New files are untracked.** All new files, including migration 0073, are still untracked in git and must be committed together.
- **Pre-existing test failures overlap this work.** The 13 failing frontend tests cover pending actions and the term page, which this task touched, so they could hide a regression there.

## Executive Summary
All four requested features are implemented end to end and traced through the code by the reality assessor:
- the owner items page;
- the shared 3-newest participants preview with context links;
- the public item page with Weź / Zamienię / Napisz / Zapisz się;
- event reservations, including the scan, cancel-on-delete and 409 after start.

The term take/swap regression gate passed with the term test files unchanged. The remaining issues are an event-delete concurrency edge, a privacy decision, and cleanup left over from groups that ran in parallel.

## Implementation Plan Verification (completeness-report.md)
- 18/18 groups, 105/105 steps, 100%. Spot checks found no gaps.
- All 35 requirements map to code.
- `visual-coverage.md` covers 13/13 design entries.

## Test Suite Results (test-suite-results.md)
| Suite | Result |
|---|---|
| Backend pytest | 1028/1028 passed (9m14s) |
| Frontend vitest | 1295/1308. 13 failures, all of which fail the same way on HEAD: auth 1, extension-points 2, foundation 1, PublicLayout 2, AppPage add-term 5, PendingActionsHost GIFT 1, TermPage sign-up 1 |
| tsc (app) | 0 errors |
| mypy | 15 errors, at baseline; none in this diff's hunks |
| ruff | Only E501/I001 that already existed, plus 1 UP017 in an untouched file |

Pass rate: 99.44% overall; 100% when the pre-existing failures are excluded. Regressions: 0.

## Standards Compliance
19 of the 20 applicable standards are followed. The one gap is `backend/models.md`: `groups/application/owner_items.py:24` imports `app.organizations.models` directly instead of going through `organizations_acl`.

## Documentation Completeness
- `architecture.md` now has an Event reservations section, an Owner items page section and the 0073 runbook.
- `INDEX.md` and `migrations.md` are updated.
- `work-log.md` is complete, but its Standards Reading Log placeholder was never filled (info).

## Optional Review Results
| Review | Status | Counts | Report |
|---|---|---|---|
| Code review | issues_found | 0 C / 5 W / 9 I | code-review-report.md |
| Pragmatic review | Appropriate | 0 C / 3 W / 7 I | pragmatic-review.md |
| Production readiness | GO with mitigations (82%) | 0 blockers / 4 W / 2 I | production-readiness-report.md |
| Reality check | Issues found, deployable | 0 C / 5 W / 7 I | reality-check.md |

## Visual Fidelity
Not run yet. E2E verification (Phase 12) will write `verification/visual-fidelity.md`.

## Issues Requiring Attention (deduplicated)

| # | Severity | Source | Issue | Location | Fixable |
|---|---|---|---|---|---|
| W1 | warning | code_review W1/W3, reality G1 | The event `FOR SHARE` lock is released by commits inside create/confirm. In addition, accept and reject load the proposal without locking it. A concurrent `delete_event` then gives a `StaleDataError` 500 or a stuck PROPOSED proposal. | `groups/application/term_item_listings.py:676-702, 752-813, 820-858`; `circulation/application/reservations.py:77` | yes (medium) |
| W2 | warning | code_review W2, reality G2 | Anonymous visitors see the owner's `display_name` and `party_id`, and the party items endpoint returns 200 for any party that has a profile. | `groups/application/item_actions.py:84-97`; `owner_items.py:117-214` | needs a product decision |
| W3 | warning | code_review W5 | A take or propose does not invalidate the `OWNER_ITEMS_KEY`, `EVENT_KEY` or organizer-page queries, so stale "available" items stay on screen. | `frontend/src/pages/term/hooks/useItemTake.ts` | yes |
| W4 | warning | code_review W4, pragmatic I1 | Query keys `"item-actions"` and `"itemDetails"` are hard-coded; `ITEM_DETAILS_KEY` is not exported. | `useItemTake.ts`, `hooks/useItemDetail.ts` | yes |
| W5 | warning | completeness | `owner_items.py` imports the Organization model directly, bypassing `organizations_acl`. | `groups/application/owner_items.py:24,47` | yes |
| W6 | warning | pragmatic W1 | Five mode-label maps exist for two modes. | `ItemContextActions.tsx:32`, `ParticipantItemsPreview.tsx:12`, `termLabels.ts:20` | yes |
| W7 | warning | pragmatic W2 | The owner-summary logic is duplicated. | `item_actions.py:84-97`, `owner_items.py:207-212` | yes |
| W8 | warning | pragmatic W3 | Two mappers exist only because the client uses lowercase `kind` where the server uses uppercase. | `useItemRoutes.ts:15-23`, `useItemTake.ts:15-30` | yes |
| W9 | warning | production C2 | Migration 0073 sets no `SET LOCAL lock_timeout`, unlike 0071. | `alembic/versions/0073_event_reservations.py` | yes |
| W10 | warning | production C4 | The new anonymous endpoints have no rate limit. This applies to the whole platform and is tied to follow-up W8. | `/details`, `/actions`, owner items | no (out of scope) |
| — | process | production C1, reality G4 | Migration 0073, 8 backend modules and 15 frontend files are untracked. | git | handled at commit |

**Info:**
- **Code review:**
  - a `ValueError` doubles as the 400 signal;
  - for terms, the already-resolved check now runs before `require_ended`;
  - `_scan_event_swaps` and `author_slugs` run one query per item;
  - `/actions` costs about 12 statements per call;
  - the AVAILABLE check in take/propose is not locked (this predates the task);
  - an anonymous visitor hitting a 404 is sent to the login page;
  - the 0073 downgrade is guarded;
  - a stale docstring in `circulation/schemas.py`.
- **Pragmatic review:**
  - a local `ItemAuthGateSheet` duplicates `AuthGateSheet`;
  - `ListingRowVM` has dead `title`/`subtitle`/`thumbUrl` fields;
  - the error view never shows its `message`;
  - `FOCUS_RING` is defined twice.
- **Production readiness:**
  - `s-maxage` has no effect because there is no CDN;
  - the scan's term pass and event pass share one transaction.
- **Reality check:**
  - the item page has no "already proposed" state;
  - `NearestHint` says "termin" for events;
  - the delete dialog compares "started" in the browser's time zone;
  - one context reader has no event test.
- **Completeness:**
  - the Standards Reading Log placeholder is empty;
  - Groups 9 and 16 never had a red test phase;
  - two test files were edited outside the planned scope.

## Recommendations
1. Decide W2 (owner identity for anonymous visitors) with the product owner.
2. Fix W1: flush-only create/confirm for the event paths, or lock and map `StaleDataError` to 409. Also lock the proposal `FOR UPDATE` in accept/reject.
3. Fix the quick wins: W3–W9.
4. Run E2E (Phase 12) for a runtime check.
5. Commit all untracked files together, then check `alembic heads` and `import app.main`.
6. Handle the 13 pre-existing frontend failures in a separate task.

## Verification Checklist
- [x] Completeness check
- [x] Full test suite (no regressions)
- [x] Code review
- [x] Pragmatic review
- [x] Production readiness
- [x] Reality check
- [ ] E2E / visual fidelity (Phase 12)

## Fix & Re-Verification History

**Cycle 1 → fixes applied.** The user approved fixing every fixable issue.

User decisions:
- **W2:** owner name stays public; the party items endpoint returns 404 when the party has nothing listed.
- **W1:** the single-commit approach applies to terms as well as events.
- **Re-verification:** the user chose to skip a full re-run of the reviews. The fixes were checked with targeted tests only.

| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 concurrency | Circulation `create_reservation`, `confirm_reservation` and `cancel_reservation` now take a `commit=False` flag that only flushes. Take, propose, accept and reject commit once at the end. The proposal is locked `FOR UPDATE` and its status re-checked, returning 409 "Ta propozycja została już rozstrzygnięta". Locks are taken event first, then proposal (same order as `delete_event`). `StaleDataError` already maps to 409 globally. | **Resolved.** 3 new tests (accept and reject after a concurrent reject → 409; accept commits once) fail without the fix and pass with it. Term test files pass unchanged. |
| W2 privacy | `get_party_owner_items` → 404 when the party has no ACTIVE+AVAILABLE items. | **Resolved per user decision.** `test_owner_items_page.py` updated. Residual (info): an item page for an unavailable item can link "Zobacz wszystkie rzeczy" to a 404 when the owner has no other listed items. |
| W3 stale lists | `useItemTake` invalidates six prefixes: ITEM_ACTIONS, ITEM_DETAILS, OWNER_ITEMS, EVENT, ORGANIZER_PAGE and NOTIFICATIONS. | **Resolved.** `useItemTake.test.tsx` asserts all six. |
| W4 hard-coded keys | `ITEM_DETAILS_KEY` exported; both key constants imported where they were hard-coded. | **Resolved.** grep finds no literals outside tests. |
| W5 ACL bypass | `owner_items.py` uses `organizations_acl.Organization`. | **Resolved.** |
| W6 label maps | Maps consolidated in `termLabels.ts` (`PICKUP_MODE_LABELS`, `PREVIEW_MODE_LABELS`). | **Resolved.** UI copy unchanged. |
| W7 duplicated owner summary | `owner_summary()` helper shared by `owner_items` and `item_actions`. | **Resolved.** |
| W8 casing mappers | A single `itemContextKind()` mapper in `useItemRoutes.ts`. | **Resolved.** URLs unchanged. |
| W9 lock_timeout | `SET LOCAL lock_timeout = '5s'` in the 0073 `upgrade()`, as in 0071. | **Resolved.** |
| W10 rate limiting | Not fixed. Platform-wide follow-up, tied to W8 (guest limits). | **Residual (warning)** |
| Info | Error view shows its message. Dead `ListingRowVM` fields removed. NearestHint uses event wording for events. Stale docstring fixed. | **Resolved.** New ItemDetailPage test for the event wording. |

**Post-fix verdict:** ⚠️ Passed with Issues. Open items: W10 (out of scope), the 13 frontend test failures that predate this work (separate task), and E2E pending.
