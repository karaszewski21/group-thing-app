# Implementation Verification — System punktów i reputacji (stage 1)

## TL;DR
✅ **Passed** after one fix cycle. 0 critical and 0 warnings remain; W8 was kept by user decision. About 25 info items, all accepted or documented.
- Plan: 110 of 110 steps done. Full suite re-run: 0 regressions; 3748 of 3783 pass, and the 35 failures are the known baseline.
- Production readiness: GO. Code review re-check: clean. Reality check re-check: ready (about 98%).
- Fixed in verification: W1–W7 and W9. Also fixed: the late organizer-exclusion change (decision b) and three follow-up doc/a11y items.

## Open Questions / Risks
- `downgrade 0105` is refused once any award exists, so take a `pg_dump` before deploying 0103–0105 and follow the runbook.
- Not yet runtime-verified in a browser (Phase 12 E2E is next) and 0105 not run on production-sized data; running `npm run build` once before release is recommended.
- Accepted limit: a want resumed (WITHDRAWN/EXPIRED → ACTIVE) after the reservation still earns the „Szukam” bonus, because no status history is kept. It is bounded by the creation-time check and the pair limit.
- Accepted limit: on a closed list, `is_organizer` shows current leadership, while the frozen count used leadership at close. This affects display only.
- 8 standards suggestions from the work-log have not yet been raised with the user; that happens at finalization.

## Executive summary
Every stage-1 flow works end to end: item valuation, awards at confirm, attendance close and the job, owner reads, admin config and the frontend pages. The ledger contract, lock order, 409 mapping and R8 hold. The single verification cycle closed the two farming gaps (W1, W2), made ledger bugs surface as 500s (W3), removed the per-attendee query (W4), fixed cache invalidation (W5), made organizer handling visible on the attendance list (W6, W7) and brought the docs in line (W9).

## Implementation plan verification
110 of 110 steps (14 groups, 96 steps), code spot-checked for every group. Info: `TermEditView.tsx` is listed in the plan but untouched; the logic is in `TermEditForm.tsx`. Accepted.

## Test suite results (`test-suite-results.md`, re-run after fixes)
| Suite | Result | Baseline / previous run |
|---|---|---|
| Backend pytest | 1675 passed / 2 failed | same 2 stale tests; previous run 1673 / 2 |
| Matcher | 125 passed | 125 |
| Vitest | 1948 passed / 33 failed | same 33 by name; previous run 1946 / 33 |
| Typecheck / mypy / ruff | 0 / 15 / 64 | baseline |

Regressions: 0.

## Standards compliance
All standards applicable to the feature and the fixes are followed: exact key sets in backend tests, prefix invalidation in data fetching, `aria-describedby` on the organizer note, the domain clock guard in `app/points`, and `mapped_transaction_conflicts` for 409s. The nested-`ul` category list is a recorded deviation from the mockup, which `accessibility.md` requires.

## Documentation completeness
architecture.md (caller list, award/close bullets, ledger contract), INDEX.md and spec.md are consistent with the code after the fixes. CHANGELOG.md has the Polish feature bullets.

## Optional review results
| Review | Initial | After fixes |
|---|---|---|
| Code review | 0 C / 4 W / 9 I | clean: 0 / 0 / 3 I (`code-review-reverify.md`) |
| Pragmatic review | appropriate, 0 / 1 / 8 | W8 kept by user decision; not re-run (fixes add no abstractions) |
| Production readiness | GO (95%), 0 / 0 / 6 | not re-run (fixes touch no migration, config or deploy path) |
| Reality check | ready, 0 / 4 / 5 | ready (~98%): 4 resolved, 3 new info (`reality-check-reverify.md`) |
| Completeness | 0 / 1 / 5 | 0 / 2 / 5 → both doc warnings fixed afterwards (`completeness-reverify.md`) |

## Fix & Re-Verification History
| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 „Szukam” bonus ignored reservation-time state | `wants_acl.wanted_at_reservation` (one EXISTS per leg) requires `wants.created_at <= reservation.created_at`; test case `createdAfterTake` | resolved (code review, reality check) |
| W2 monthly cap bypass via past-dated terms | `attendance_cap_month(clock.local_now())`, so the cap is per month of the close; `occurs_on` parameter removed; test with two terms 40 days apart | resolved; end-to-end check found no other code assuming the term month |
| W3 ledger invariant → 400 with internal text | `LedgerInvariantError(RuntimeError)` → catch-all 500, generic body; ledger tests updated | resolved |
| W4 per-attendee source-key queries | `ledger.existing_source_ids` (one IN query) | resolved |
| W5 config save did not refresh attendance levels | `invalidateQueries({queryKey: [POINTS_KEY]})`; `usePointsConfig.test.tsx` | resolved |
| W6 organizer ticks silently excluded | `TermAttendeeResponse.is_organizer` (same `holds_active_leadership` rule); UI label; „Teraz: X z Y” counts non-organizers; backend key set + vitest | resolved |
| W7 no below-minimum warning in close dialog | `closeDialogBody` adds „Za mało obecnych (N z min. M) — punkty nie zostaną naliczone.”; exact-text vitest | resolved |
| W8 dead PARTY-debit check | kept as a safeguard (user decision) | n/a |
| W9 architecture.md:270 caller list | caller list names the close exclusion and `is_organizer` | resolved |
| Re-check N1 (completeness) architecture.md said `ValueError` | now names `LedgerInvariantError` (500) | fixed after the re-check |
| Re-check N2 (completeness) spec.md missing W1/W6 | spec amended (R2.5 bonus rule, attendee response, key set) | fixed after the re-check |
| Re-check info: `domain/awards.py` docstring said term month | docstring now says month of the close | fixed after the re-check |
| Re-check info: organizer note not announced with checkbox | `aria-describedby` linking the checkbox to the note; TermAttendeesPage tests 14/14, typecheck 0 | fixed after the re-check |

## Remaining info (accepted)
- Code review: no CHECK on `size_class`/`points_value`; 0105 single UPDATE on `inventory_items` (off-peak per runbook); category PUT without `size_class` resets it; PARTY accounts created even when nothing is posted; withdraw/close race window; history date has no year; two functions over 50 lines.
- Pragmatic: duplicated config-to-rules mapping; duplicate except branches in the job; `skip_locked` doubles as a job flag; enum mirror constants; near-duplicate eligibility queries; `max_points_offers` stage-2 stub.
- Production: no alerting on the job (health = `attendance close:` log line); 0105 without `lock_timeout`; `next build` not run; the runbook does not name the retry command; no project-wide Sentry, metrics or rate limiting.
- Reality: duplicate-skip uses a pair slot (race only); level-0 terms closed; giver = holding inventory; offset paging; resumed-want and closed-list `is_organizer` limits (above).

## Verification checklist
- [x] Completeness checker (initial + re-check)
- [x] Test suite (initial + full re-run after fixes)
- [x] Code review (initial + re-check)
- [x] Pragmatic review (initial)
- [x] Production readiness (initial)
- [x] Reality check (initial + re-check)
- [x] All report files present on disk
