# Implementation Verification — Publiczna strona wydarzenia

## TL;DR
⚠️ **Passed with issues, after 1 fix and re-verify cycle.** Plan 75/75 (100%). Full suite after fixes: backend 959/959 (the one regression, an exact index-set assertion, was fixed), frontend 1233/1246 (the 13 failures also fail on a clean HEAD, so none are regressions), tsc clean.
12 of 12 selected issues fixed (W1–W7, W10, W11, I1, I3, I5) and confirmed resolved by every re-check. 3 warnings remain open as accepted follow-ups (W8 guest rate limit, W9 participant cap, W12 alembic env.py) and 0 critical issues. Production: GO with mitigations (readiness 88%, up from 82%).

## Open Questions / Risks
- W8: public guest sign-up has no rate limit. Guests can't be removed and they block event deletion. Accepted, but there is no tracked follow-up task yet.
- W9: the public event page returns every attendee and every listed item, uncapped. Accepted follow-up.
- 0071 still validates FKs under an ACCESS EXCLUSIVE lock (`lock_timeout` only bounds the wait). If it times out, the backend crash-loops (`alembic upgrade head && uvicorn`) and the whole API is down until 0071 succeeds. Check the row counts of `messages`/`conversation_reads` before deploy (runbook step 1).
- The `messages`/`conversation_reads` cascade applies to **all** conversation kinds (documented in the runbook).
- No browser visual-fidelity check yet; Phase 12 E2E will produce `visual-fidelity.md`.

## Executive Summary
Every scoped requirement is implemented, reachable from the UI and tested at the integration points. The re-verification cycle confirmed all 12 selected fixes in code and tests, and the reality re-check gives a final verdict of ✅ Complete. What remains is two accepted product and design follow-ups (W8, W9), one tooling task (W12) and 18 optional info items.

## Implementation Plan Verification
- 75/75 steps (85 checkboxes including group headers). Re-check: plan complete, no spot-check issues.
- Term components are untouched. `AccountMergeForm` only gained optional props whose defaults keep the current Term copy.

## Test Suite Results
| Run | Backend | Frontend | tsc | ruff / mypy |
|---|---|---|---|---|
| Initial | 955/955 | 1225/1238 (13 pre-existing) | clean | 53 pre-existing / 16 (none in changed files) |
| After fixes | 958/959 → **959/959** after the test fix below | 1233/1246 (the same 13 pre-existing) | clean | unchanged |

Regression found in the re-run: `tests/test_events_migration.py::test_upgradeHead_eventConstraints_namedAndPartial` asserted the exact index sets that existed before 0072. The orchestrator updated both expected sets, keeping the exact-match assertions (`ix_events_author_party_id`, `ix_event_attendances_party_id`), and re-ran the event migration tests: 3/3 passed, ruff clean. Details: `test-suite-results.md`, `test-suite-results-reverify.md`.

## Standards Compliance
Re-check: compliant. 0072 follows migrations.md (explicit `ix_` names, partial index via `postgresql_where`, reverse-order downgrade, downgrade→upgrade test), models.md (`__table_args__` matches the migration) and backend-testing.md (naming, flat placement). The one accepted deviation: `useEventSignUp` doesn't take `view.kind`, because that would be circular with `guestProfileId` (documented).

## Documentation Completeness
Re-check: complete.
- `architecture.md` now covers the Events context (routes, read model, ACLs, public page, OG preview, reserved slug), the Messaging EVENT kind, and a deploy/rollback runbook for 0071–0072.
- The `INDEX.md` Architecture entry is refreshed, and the `app/messaging/__init__.py` docstring lists EVENT.
- The work log documents the fix cycle.

## Optional Review Results
| Review | Initial | After fixes |
|---|---|---|
| Code review | issues found: 0 critical / 4 warning / 8 info | 0 critical / 0 warning / 7 info (W1–W4 resolved) |
| Pragmatic | appropriate: 0 / 0 / 7 | appropriate: no new complexity; 7 earlier infos still open (cleanup not chosen) + 1 low |
| Production readiness | GO with mitigations, 82% | GO with mitigations, **88%**, 0 blockers, 2 accepted warnings (W8, W9) |
| Reality check | complete with minor gaps (~97%) | ✅ complete, all user-visible fixes traced end-to-end, no regressions |
| Completeness | passed with issues: 0 / 4 / 6 | **passed**: 0 / 0 / 2 |

## Visual Fidelity
Pending: produced by the Phase 12 E2E run (report-only). Known deviations: the copy-link button uses `CopyIcon` instead of 🔗; "Twoje wydarzenie" is kept as an `h2`; the guest-sheet date has an extra dot; the merge card shows a dashed `SUB_FORM` border.

## Overall Assessment
| Dimension | Status |
|---|---|
| Implementation | ✅ 100% |
| Tests | ✅ 0 regressions (after the test fix) |
| Standards | ✅ compliant |
| Documentation | ✅ complete |
| Code review | ✅ 0 warnings |
| Production | ⚠️ GO with mitigations (W8, W9 accepted) |
| Reality | ✅ complete |
| **Overall** | **⚠️ Passed with Issues**: only accepted follow-ups remain |

## Issues Requiring Attention (remaining)

### Warnings (accepted follow-ups)
| # | Issue | Location | Status |
|---|---|---|---|
| W8 | Public guest sign-up has no rate limit; guests can't be removed and block deletion | `app/events/router.py`, `service.py` | accepted. Suggested: nginx `limit_req` or the `send_limiter` pattern, plus author/moderator guest removal; create a follow-up task |
| W9 | Public page returns all attendees and items, uncapped | `app/events/page.py` | accepted. Suggested: show the first N + `attendee_count`, cap items per attendee |
| W12 | `alembic/env.py` sets `target_metadata = None`, so the `alembic check` drift guard is disabled | `src/backend/alembic/env.py` | separate task |

### Info (optional)
| # | Source | Issue | Location |
|---|---|---|---|
| N1 | code review, production | The guest sign-up path keeps a pooled connection and an open transaction during `check_text` (the row lock is gone, the connection hold is not) | `app/events/service.py:395-406` |
| N2 | code review, production, completeness | 0071 `downgrade()` and 0072 set no `lock_timeout` | `alembic/versions/0071_…py:65-69`, `0072_…py` |
| N3 | code review | `useEvent.remove` doesn't invalidate `UNREAD_MESSAGES_KEY`, so the badge stays stale for up to 20 s | `hooks/useEvent.ts:91-95` |
| N4 | code review | No test for an event deleted or ended between the unlocked pre-check and the `FOR SHARE` re-read | `tests/test_event_attendance.py` |
| N5 | reality | `attendee_count` includes attendees with an unresolvable profile, who are dropped from `participants` (predates the fixes; needs a broken profile row) | `app/events/page.py` |
| N6 | completeness | The docs don't say the `event_attendances.party_id` index is partial | `architecture.md:139,266` |
| N7 | production | The runbook has no row-count threshold for the `NOT VALID` split and doesn't say a 0071 timeout takes down the whole API | `architecture.md` runbook |
| N8 | pragmatic | Optional comment explaining the double event read in guest sign-up | `service.py:399-406` |
| I2 | carried | The OG description holds the full description (escaped) | `public_preview.py:94-98` |
| I4 | carried | The cascade applies to all conversation kinds (documented) | 0071 |
| I6–I11 | pragmatic, carried | Unused `EventContentView`, `visitor.isLoggedIn`, `refreshError`, always-false `busy`; duplicate attendee query; batched org lookup / positional `Access` / duplicated retry markup | `eventViewState.ts`, `useEvent.ts`, `EventPage.tsx`, `page.py`, `access.py` |
| I12 | carried | `party_id` in the anonymous public payload (spec-defined) | `app/events/schemas.py` |
| I13 | carried | An invalid token on one-click sign-up → guest branch → "Podaj swoje imię." | `service.py`, `useEventSignUp.ts` |
| I14 | carried | The IntegrityError double-submit re-select path has no test | `service.py:413-418` |
| I15–I18 | carried | Sign-up error shown only as a toast; EVENT thread header doesn't link to the event; no canonical-slug redirect; old `/events/:id` links have no redirect | various |
| I19 | carried | Pre-deploy checks (`slug='event'`, row counts), now in the runbook | `architecture.md` |

**Dismissed:** the claim that the EVENT chat `participant_count` includes guests. It doesn't: `_participant_count` counts only parties with an account (`messaging/application/conversations.py:181-190`).

## Fix & Re-Verification History
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 backslash in event name → 500 | `_inject` uses a callable `re.sub` replacement (`public_preview.py:56-57`); test with `Swap \o/ \1` | ✅ resolved (code review, reality) |
| W2 missing party indexes | Migration `0072_event_party_indexes` (`ix_events_author_party_id`, partial `ix_event_attendances_party_id WHERE withdrawn_at IS NULL`) + models + round-trip test; `test_events_migration.py` exact sets updated | ✅ resolved; every party query filters `withdrawn_at IS NULL`, so the partial index can be used |
| W3 lock held during moderation | Guest name validated and moderated before the `FOR SHARE` get; `_require_open` re-checked under the lock with `populate_existing`; ordering test | ✅ resolved for the row lock; connection-hold residual logged as N1 |
| W4 guest state carried across events | `EventPage` → `<EventPageContent key={eventId}>`; navigation test | ✅ resolved; router-state toast still works |
| W5 empty-list sign-up nudge for author/ended | `EventAttendeeList canSignUp`; only the not-ended visitor view gets the nudge | ✅ resolved |
| W6 Polish verb plural | `pluralPl` for the verb; `it.each` for 1/2/5/12/22 | ✅ resolved |
| W7 0071 without `lock_timeout` | `SET LOCAL lock_timeout = '5s'` as the first upgrade statement | ✅ resolved; scoped to 0071's transaction (`transaction_per_migration=True`) |
| W10 stale project docs / no runbook | `architecture.md` Events, Messaging and 0071–0072 runbook; `INDEX.md` entry | ✅ resolved; runbook checked against the code |
| W11 messaging docstring | Lists EVENT + `events_acl` | ✅ resolved |
| I1 author KeyError → 500 | `UNKNOWN_AUTHOR_NAME = "Użytkownik"` fallback; test | ✅ resolved |
| I3 deleted event chat lingers in the inbox | `useEvent.remove` also invalidates conversations | ✅ resolved (unread badge residual logged as N3) |
| I5 guest name length | `maxLength={255}` | ✅ resolved |
| Regression from W2 | `test_events_migration.py` expected index sets extended (exact match kept) | ✅ 3/3 event migration tests pass |

Re-verify count: 1. Reviewer side files: `test-suite-results-reverify.md`, `completeness-reverify.md`, `code-review-reverify.md`, `pragmatic-reverify.md`, `production-readiness-reverify.md`, `reality-reverify.md`.

## Recommendations
1. Create follow-up tasks for W8 (guest rate limit + guest removal) and W9 (participant cap) before wide rollout.
2. Before deploy, follow the runbook: row counts, the `slug='event'` check, a dump of the messaging tables, an off-peak window.
3. Optional quick wins: N2 (`lock_timeout` in the 0071 downgrade/0072), N3 (unread badge), N6/N7 (runbook precision), N1 (`db.rollback()` before moderation).
4. Separate task: W12 (`alembic env.py target_metadata`).

## Verification Checklist
- [x] Completeness checker: initial + re-check, reports on disk
- [x] Full test suite: initial + re-run, reports on disk; the re-run regression fixed and re-tested
- [x] Code review: initial + re-check
- [x] Pragmatic review: initial + re-check
- [x] Production readiness: initial + re-check
- [x] Reality check: initial + re-check
- [x] Canonical report rewritten with the post-fix verdict and fix history
- [ ] Visual fidelity: pending Phase 12 E2E
- Roadmap: `.maister/docs/project/roadmap.md` does not exist; no update
