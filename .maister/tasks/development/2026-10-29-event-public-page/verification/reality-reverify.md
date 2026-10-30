# Reality Re-check — Event Public Page (after fix cycle 1)

## TL;DR
- **Status: ✅ Ready** (the remaining items are accepted follow-ups).
- I traced every user-visible fix through the uncommitted code, and each one works end-to-end: empty-list copy per view, the plural delete hint, the inbox refresh after a delete, the A→B navigation reset, backslashes in event names, and the author-name fallback.
- No regression found in the flows traced last time: sign-up (logged-in and guest), withdraw, delete, the stale/refresh view, OG preview, and the migrations.
- Tests (from `test-suite-results-reverify.md`, not re-run here): backend 958/959. The one failure was the old exact-index-set assertion in `tests/test_events_migration.py`. It is now updated: line 82 expects `ix_events_author_party_id`, lines 93–97 include `ix_event_attendances_party_id`. Frontend 1233/1246 with the 13 known HEAD failures; tsc clean.
- One new low-severity edge case: if an attendee's name cannot be resolved, `attendee_count` and the attendee list disagree. This existed before the fixes and does not block.

## Open Questions / Risks
- The `test_events_migration.py` fix was checked by reading the code only. It has not been executed since the orchestrator edited it. A single `uv run python -m pytest tests/test_events_migration.py` would confirm it.
- Accepted follow-ups are still open: W8 guest sign-up rate limit, W9 participant cap, W12 alembic `env.py` `target_metadata = None`.

## Prior issues: status

| ID | Issue | Status | Evidence |
|---|---|---|---|
| W5 | Empty-list copy invited the author and ended viewers to sign up | **Resolved** | `EventAttendeeList` takes `canSignUp`; the CTA sentence renders only when it is true. `EventPage` passes `canSignUp: !view.ended` only in the `visitor` case. `EventShell` defaults it to `false`, so author, attendee, guestAttendee and refreshing get the neutral copy. Tests: EventPage author/ended cases assert `NEUTRAL_EMPTY_COPY`, the visitor case asserts the full CTA. |
| W6 | Polish plural in delete hint | **Resolved** | `EventAuthorCard` uses `pluralPl` for both the verb and the noun. Results: 1 → "zapisała… osoba", 2/22 → "zapisały… osoby", 5/12 → "zapisało… osób". The `pluralPl` rule for the 12–14 exclusion is correct. `it.each` covers 1/2/5/12/22. |
| I3 | Inbox not refreshed after event delete | **Resolved** | `useEvent.remove`: `removeQueries([event, id])`, then awaits invalidation of `MY_EVENTS_KEY` and `CONVERSATIONS_KEY` (`["conversations"]`, a prefix of the per-user key `[...CONVERSATIONS_KEY, username]`). Only after that does `EventPage` navigate to Spotkania. |
| W4 | Navigating event A → B kept guest/sheet state | **Resolved** | `EventPage` renders `<EventPageContent key={eventId} …/>`, so the `useEventSignUp` state remounts per event: `guestProfileId` is re-read from `guest_profile_id:event:<B>`, and `sheetOpen`/`confirmingWithdraw` reset. Test "navigating to another event drops the previous event's guest sign-up and sheet state" covers it. |
| W1 | Backslashes in event names broke `<title>` | **Resolved** | `public_preview._inject` swaps the `<title>` with a callable `re.sub` replacement. The meta tags use `str.replace`, which is literal. Test with `r"Swap \o/ \1"` asserts both `<title>` and `og:title`. |
| I1 | Author name could be missing | **Resolved** | `page.py`: the organization name comes first, then the profile name via `names.get(author_party_id, ("Użytkownik",))`. `test_event_page.py:504-505` covers it. |
| W2 | Missing party_id indexes | **Resolved** | `0072` (down_revision 0071, nothing after it) creates `ix_events_author_party_id` and a partial `ix_event_attendances_party_id`. Models declare them. Its downgrade drops them in reverse order. |
| W3 | Guest moderation inside the FOR SHARE lock | **Resolved** | `sign_up` validates and moderates the guest name before the lock, re-reads with `with_for_update={"read": True}, populate_existing=True`, then re-checks `_require_open`. The author refusal and the idempotent attach path are unchanged. |
| W7 | 0071 lock timeout | **Resolved** | `SET LOCAL lock_timeout = '5s'` in 0071. |
| I5 | Guest name length | **Resolved** | `maxLength={255}` on the guest sheet input. |
| W10/W11 | Docs | **Resolved** (per work log; not re-traced) | — |
| #5 (prior) | "participant_count includes guests" | Dismissed earlier as a false positive | — |
| W8 / W9 / W12 | Guest rate limit / participant cap / alembic env.py | **Residual, accepted** | Not addressed by design. |

## New / residual issues

| Severity | Location | Issue | Fixable | Suggestion |
|---|---|---|---|---|
| Low | `src/backend/app/events/page.py` (`attendee_count=len(attendee_party_ids)` vs the list comprehension's `if party_id in names` filter) | When an attendee's profile name cannot be resolved, the attendee is skipped in `participants` but still counted in `attendee_count`. The author card can then say "zapisała się już 1 osoba" next to "Nikt jeszcze się nie zapisał." Existed before the fixes; needs a broken or deleted profile row. | Yes | Count only resolved attendees, or accept it as is (delete stays correctly blocked either way). |
| Info | `src/backend/tests/test_events_migration.py` | Fixed by the orchestrator after the re-verify test run, so not executed yet. | Yes | Run that one file once before committing. |

## Regression scan (flows from the previous check)
- **View resolution** (`eventViewState.ts`): order unchanged (notFound → stale → author → attendee → guestAttendee → visitor).
- **Logged-in sign-up / guest sheet / withdraw** (`useEventSignUp`, `useEvent`): unchanged apart from the remount key. The withdraw dialog and the conversations invalidation are intact.
- **Author delete:** blocked while `attendee_count > 0` (aria-disabled + describedby hint + handler guard); the confirm dialog awaits `onDelete`, then navigates.
- **OG preview:** `render_public_event_meta` unchanged apart from going through the fixed `_inject`.

## Completion Verdict
**✅ Complete.** Every fix the user selected works end-to-end in code. I found no regressions. The only open items are the three accepted follow-ups, plus one low-severity edge case that predates the fixes.
