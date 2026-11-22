# Reality Check: Points and reputation system, stage 1

## TL;DR
- **Status: ✅ Ready, with minor issues.** Every stage-1 flow is wired end to end: item valuation, the awards at confirm, attendance (ticks, manual close, auto-close job), the owner reads, the admin config with its 409, and the frontend pages.
- I traced the code paths myself. I also re-ran the 9 points and attendance test files against real Postgres: **80 passed**. The full-suite run in `test-suite-results.md` found 0 regressions.
- No critical gaps. There are 4 warnings (UX/data-honesty edges, none blocking) and 5 info items.
- Not verified: a live browser walkthrough, and the deploy itself (migrations 0103–0105 on production data).

## Key Decisions
- I checked two things against the code, not against the work log: the single fulfil path, and the scheduler/router registrations.
- Out of scope by decision, so not counted as gaps: stage 2 (POINTS mode / spending), START_BONUS, auto-confirm, notifications.
- The soft-deleted-group behaviour is the user's option (b): guests are paid, organizers excluded via `holds_active_leadership`. I treat it as accepted.

## Open Questions / Risks
- **Deploy is one-way after the first award.** A `downgrade 0105` is refused once any `point_transactions` row exists, and there is no image-only rollback. A `pg_dump` before deploy is mandatory, as the runbook says.
- **Organizer self-farming is accepted, not prevented.** Example: a past-dated term, a few RSVP accounts, then close. It is bounded only by the monthly cap and `attendance_min_present`. Product owners should know this is live on day 1.
- **The organizer's confirm dialog does not show the consequence of closing below the minimum.** Closing then permanently forfeits the points (warning W2).

---

## 1. Reality vs claims

| Claim | Reality | Evidence |
|---|---|---|
| `points_value` set on create, recomputed on condition/product change | ✅ True | `inventory_items.py::register_item` sets it before the first flush. `update_item` recomputes only on an actual change. `register_item` is the only item insert in `app/` (grep). Migration 0105 backfills existing items. |
| GIVE_FREE + reputation, EXCHANGE each side, WISHLIST_MATCH at confirm | ✅ True | `term_item_listings.confirm_transaction` calls `points_acl.award_exchange` inside `mapped_transaction_conflicts`, after `_may_confirm` and before the preference delete and `fulfill_exchange`. `fulfill_exchange` has one caller (grep), so every context goes through the award: term, event and personal. |
| Pair limit, family rule, eligible persons only | ✅ True | `points/application/awards.py`: `eligible_party_ids` (PERSON with login), `share_active_family`, `lock_accounts` before `_used_pair_slots`. Tests `pairLimitReached`, `sameFamily`, `ineligibleParty` pass. |
| Idempotent under parallel confirms | ✅ True | Accounts are locked first, then `source_key_exists`, with the unique source key as a backstop. Test `parallelConfirmsOnCommittedSessions_postsExactlyOneAward` passes ([200, 409]). A failed fulfil rolls the award back (test passes). |
| Attendance level → ticks → close / auto-close → cap, organizers excluded | ✅ True | `groups/application/attendance_points.py`: term `FOR UPDATE` (job: `SKIP LOCKED`), re-check OPEN, frozen snapshot, `_not_an_organizer` via `holds_active_leadership` (includes deleted groups), `plan_attendance_awards` clipping to the Warsaw cap month. Tests for cap, minimum, organizer, soft-deleted group and idempotent job pass. |
| Scheduler registered, routes mounted | ✅ True | `main.py` registers `_run_attendance_close` every 15 min on the existing scheduler, wrapped in a catch-and-log. `points_router` is included. Three attendance routes are added to `groups/router/circles.py`. |
| Matrix rows | ✅ True | Row 70 (presence PUT, EDIT/mcp:edit) is placed ahead of rows 26–27. Rows 68 (config ADMIN) and 69 (`/api/points` READ, no mcp) sit ahead of the catch-all. |
| `/api/points/me` + history, private cache | ✅ True | `points/router.py` + `application/reads.py`: they never create an account, `set_personalised_cache_headers`, one batched name lookup. |
| Admin config PUT with 409 | ✅ True | `config.update_config`: `FOR UPDATE`, `updated_at` compare → 409 Polish message, Polish 400s. |
| Frontend wired | ✅ True | `/account/points` page → `AccountPointsView`; „Moje punkty” row in `AccountView`; `/admin/points` + „Points” in Sidebar/MobileDrawer; term create/edit picker (`AttendancePointsPicker`); `TermAttendeesPage` with ticks, close dialog and banners. All endpoint URLs in `api/points.ts` and `api/groups.ts` match the backend routes. |
| No points in public/list/search responses | ✅ True | The R8 probe test plus unchanged key-set tests (from the suite). `size_class` in public `/api/categories` is intentional (spec). |

**Functional completeness (stage-1 scope): about 95%.** The rest is UX polish, not missing function.

## 2. Critical gaps
None.

## 3. Quality gaps (warnings)

**W1: The present count ignores the organizer's own tick without saying so.**
- Location: `attendance_points.get_attendance` and `close_attendance`; `TermAttendeesPage.tsx`, banner and confirm dialog.
- An organizer can tick themselves (or a co-organizer). The checkbox shows as ticked, but `present_count` in the banner („Teraz: X z Y”) and in the dialog („Obecnych: N”) excludes them.
- Visible effect: the organizer sees 3 ticks but „Teraz: 2”, and may close below the minimum without understanding why.
- Fixable: yes. Disable or annotate organizer rows („organizator — bez punktów”), or have the attendee response say who is an organizer.

**W2: The close dialog does not warn when below the minimum.**
- Location: `TermAttendeesPage.tsx` (`ConfirmDeleteDialog` body).
- With level > 0 and `present_count < min_present`, confirming closes the list unrewarded, permanently. The dialog says only „Obecnych: N…”.
- Fixable: yes. Add a below-minimum sentence to the body, e.g. „Za mało obecnych (N z min. M) — punkty nie zostaną naliczone.”

**W3: The wants bonus checks the want's current status, not a true historical state.**
- Location: `points/infrastructure/wants_acl.py::qualifying_match_items`.
- `status = 'ACTIVE'` qualifies even if the want was created after the reservation. A MATCH row is needed, so it is still a real need. This is a low-impact deviation from „ACTIVE at reservation time”.
- Fixable: yes, by adding `wants.created_at <= reservation.created_at`. Optional.

**W4: Saving the config does not refresh the add-term form's levels.**
- Location: `hooks/usePointsConfig.ts`.
- `update` invalidates only `[points, "config"]`. The attendance-rules query stays stale in the same browser session until it refetches, so an add-term form can show retired levels and get a 400.
- The 400 message is clear Polish, so this is only a nuisance.
- Fixable: yes. Invalidate the `POINTS_KEY` prefix, per `data-fetching.md` ("invalidate the whole resource prefix").

## 4. Integration issues
None found. Checks:
- **Lock order**: term → accounts by party id → items, consistent across confirm, close and presence. Presence locks only the term.
- **Term edits racing the close**: protected by the `updated_at` version column.
- **Single commit owner**: `fulfill_exchange` stays the only commit on the confirm path, and the award only flushes.

## 5. Info
- **I1**: An award skipped by `source_key_exists` still used a pair slot during planning. This only matters inside the parallel-confirm race, where the loser 409s anyway.
- **I2**: The job closes level-0 terms too (rewarded = false). This is harmless and keeps the backlog empty.
- **I3**: Who earns points for an item depends on whose inventory holds it. `giver_user_id` is that inventory's owner user. Organizations have no own user or inventory today, so all awards go to persons. Revisit if Organization-owned inventories arrive.
- **I4**: History uses offset paging, so an award landing between pages may repeat an entry (accepted in the code docstring).
- **I5**: Not verified at runtime: no browser E2E run, and migration 0105 was not run on a production-sized copy. The backfill is a single `UPDATE … FROM` with a recursive CTE, fine for the current item volumes.

## 6. Pragmatic action plan (none blocking)

| # | Task | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Below-minimum warning in the close dialog (W2) | Dialog text names the shortfall when level > 0 and present < min; vitest case | High | 30 min |
| 2 | Mark or disable organizer rows in the attendee list (W1) | An organizer's tick is not offered, or is labelled; the counts match what is visible | Medium | 1–2 h (needs an `is_organizer` flag on the attendee response, key-set test updated) |
| 3 | Invalidate the `POINTS_KEY` prefix on config save (W4) | Attendance rules refetch after save; hook test | Low | 15 min |
| 4 | Optional: `wants.created_at <= reservation.created_at` in the bonus query (W3) | Test: a want created after the take earns no bonus | Low | 30 min |
| 5 | Before deploy: `pg_dump`, run the runbook guard count, and run the matcher suite (already green) | Runbook steps ticked | Critical (ops) | — |

## 7. Completion verdict
**✅ Complete for stage 1.** The implementation does what the task asked: points and reputation are earned from real confirms and closed attendance, stored in an append-only ledger, visible only to their owner, and tunable by the admin. Error paths are covered and tested: deadlock → 409, stale config → 409, closed or not-started list → 409, failed fulfil rolls the award back, job failures are logged and the loop continues. The warnings are UX clarity issues around the attendance close, not functional defects.

## Issue counts
- critical: 0
- warning: 4
- info: 5
