# Reality Check: Public event page (Term-style)

## TL;DR
- **Status: ⚠️ Issues Found (minor).** The feature works end-to-end. It is safe to ship, and the remaining problems are polish.
- I traced every requested flow through the code (create → slug URL, guest sign-up → merge card, logged-in sign-up → chat → withdraw → 403, blocked delete, ended event, inbox EVENT row, Spotkania "Biorę udział", OG preview). Each one connects correctly between frontend and backend.
- Every frontend↔backend contract matches: endpoint paths, field names, the ListingMode and theme shapes, and the `event_id` body. No old `/events/:id` page links remain.
- Tests: backend 955/955 pass. Frontend 1225/1238 pass, and the 13 failures are the same ones that fail on HEAD. `tsc` is clean. Tests were not re-run (`skip_test_execution: true`).
- I found 0 critical issues, 2 warnings (copy shown in the wrong context and a Polish grammar error) and 6 info items.

## Key Decisions
- I classed the verdict as ⚠️ instead of ✅ only because of user-visible copy defects. No functional gap blocks deployment.
- The spec makes the slug cosmetic, so a wrong slug still renders the page. I record this as info, not as a defect.
- The item links open `/<slug>/product/<id>`, which sits behind AuthGuard, so an anonymous visitor who clicks an item gets the login page. This matches how organizer item pages already behave.

## Open Questions / Risks
- Migration 0071 changes the `messages` and `conversation_reads` FKs to `ON DELETE CASCADE` for **all** conversation kinds, not just EVENT. Before, a hard delete of a conversation was blocked when it had messages. Now it silently removes them. Today only events hard-delete conversations, but this changes the safety net for everything else.
- Guest localStorage key TTL (1h, inherited from Term): a guest who comes back later can sign up again and create a second guest party. This was a known risk from the spec audit and is still open.

---

## 1. Verification already done
| Source | State |
|---|---|
| implementation-plan.md | 85/85 steps checked |
| work-log.md | 10 groups done; G10 says it found no production bugs |
| test-suite-results.md | backend 955/955; frontend 1225/1238 (13 fail on HEAD too); tsc 0; ruff/mypy not worse than before |
| spec-audit.md | pass-with-concerns. M1 (toast handover), M2 (migration FK test), M4 (token pattern), M5 (batched org lookup), L3 (FOR SHARE), L4 (plain index), L6 (k- slug chip), L7 (withdraw invalidates conversations) and L10 (OG reserved guard) are now **fixed in code** (checked). M3 was resolved by a user decision. |
| visual-coverage.md | 11/11 mockup entries covered. visual-fidelity.md does not exist, so rendered screens were not checked in a browser. |

## 2. Claims vs reality (traced flows)

| Flow | Claim | Reality / evidence |
|---|---|---|
| Create → event page | /add/event lands on `/<slug>/event/<id>` with a toast | `EventCreateView.finish` → `navigate(eventPath(event.author_slug, event.id), {state:{toast}})`. `EventPage.routerToast` shows the toast once, then clears the history state. `author_slug` comes from `resolve_author_slugs` (one batched org lookup). ✓ |
| Routing | `/:organizationSlug/event/:eventId` public; old route removed; edit kept | `router.tsx:215` (no AuthGuard), old route removed, `/events/:eventId/edit` kept. `"event"` is in `RESERVED_SLUGS`. grep finds no stale `/events/<id>` page links. ✓ |
| Slug | org slug, or a random fallback | `derive_party_slug` gives the org slug, else `k-` hash of the party. That is the same prefix the author's term URLs use. `derive_organizer_slug` refactor gives the same results as before. ✓ |
| Always public | GET without auth | `GET /api/events/{id}` uses OptionalPrincipal. A bad token gives the visitor view, not a 401 (tested). ✓ |
| Anonymous → guest sign-up → merge card | name sheet → guest profile → merge form | Sheet → `signUp(name)` → `POST /api/events/{id}/attendances` (PUBLIC matrix row). Backend runs `_validate_guest_name`, `check_text` and `create_guest_profile`. The frontend stores `guest_profile_id:event:<id>`, and the view becomes `guestAttendee` with `EventGuestMergeCard`. The merge keeps the party (`account_merge.py` updates the profile in place), so after merging, `is_attending` is true and the page shows the attendee view with chat. ✓ |
| Logged-in sign-up → chat → withdraw → chat lost | | One-click `signUp(null)`. Idempotent, with a savepoint against double submits. `chat.open({kind:"EVENT"})` → `POST /api/conversations/event {event_id}` → `event_access`: author or active attendee. Withdraw → `POST …/attendances/withdraw` (EDIT) sets `withdrawn_at` and refreshes the event, attending and conversations queries. A withdrawn user gets 403 (`test_openEventConversation_access_…withdrawnGets403`). ✓ |
| Author delete blocked with attendees | | Backend `count_attendees` (active only) > 0 → 409. UI uses `aria-disabled` plus a hint. A delete after withdrawals cascades the conversation, messages and reads (migration 0071 + `test_deleteEvent_afterWithdrawals_cascades…`). ✓ |
| Ended event | 409 sign-up, "zakończyło" footer, list and chat remain | `has_ended` uses `clock.local_now()` against `ends_at or starts_at`. Sign-up gives `EventEnded` 409. The page shows the ended footer for visitor and attendee views, and chat stays open. ✓ |
| Inbox EVENT row / thread | | Inbox has an EVENT chip and a 🎉 icon. Thread title is "<event name> · czat wydarzenia" (because `group_name` is null). Backend title is the event name; `participant_count` is author + attendees. ✓ |
| Spotkania "Biorę udział" | | `useAttendingEvents` → `GET /api/events/attending` (declared before `/{event_id}`; matrix READ row). Merged into the attending list, rendered as `EventCard editable={false}`, sorted by `starts_at`. ✓ |
| OG preview | | `/{slug}/event/{id}` in `system/router.py`. Reserved or dotted first segments fall through to the SPA fallback. Unknown or invalid id gives the plain index. Meta includes name, when, place and banner. ✓ |
| Theme | author org theme | `OrganizerThemeScope theme={event.organization}`. The header chip links only when an org exists. ✓ |
| Items read-only | AVAILABLE + listing-pref only | `_listed_items_by_party` uses one statement plus a photo batch; `count_queries` test covers 1 vs 5 participants. No take/swap actions. ✓ |

### Contract check (frontend ↔ backend)
Each pair below matches.
- `api/events.ts` `EventDetailResponse` / `EventParticipant` / `EventParticipantItem` / `EventAttendanceResponse` ↔ `events/schemas.py`
- `mode` "GIFT"|"SWAP"
- `OrganizerTheme` fields ↔ `EventOrganizationResponse`
- `POST /conversations/event {event_id}` ↔ `messaging/schemas.py:58`
- withdraw is sent as POST with no body ↔ the route returns 204

## 3. Issues

| # | Severity | Location | Issue | Fixable | Suggestion |
|---|---|---|---|---|---|
| 1 | warning | `src/frontend/src/pages/events/components/EventAttendeeList.tsx` (empty copy) | When nobody has signed up, the page always says "Zapisz się jako pierwsza osoba…". That includes the **author view**, where the author cannot sign up (and gets 409 if they try), and the **ended** view, where sign-up is closed. | yes | Pass the view context in (`canSignUp`) and show neutral copy to the author and on ended events, e.g. "Nikt jeszcze się nie zapisał." |
| 2 | warning | `src/frontend/src/pages/events/components/EventAuthorCard.tsx` (delete hint) | Polish grammar error: for 2–4 people (and 22–24 etc.) the hint reads "zapisało się już 2 osoby". It should be "zapisały się już 2 osoby". Only the 1 and 5+ forms are right. | yes | Choose the verb with `pluralPl(n, "zapisała", "zapisały", "zapisało")`. |
| 3 | info | `src/frontend/src/hooks/useEvent.ts` `remove` | Deleting an event does not invalidate `CONVERSATIONS_KEY`. The inbox can show the deleted EVENT chat until its next refetch, and opening it gives 404. | yes | Also invalidate `CONVERSATIONS_KEY` in `remove`. |
| 4 | info | `src/backend/alembic/versions/0071_event_conversations.py` | The child FK cascade applies to every conversation kind (see Risks). | n/a | Add a sentence to the architecture/migration docs, or accept as is. |
| 5 | info | `src/backend/app/messaging/application/conversations.py` (EVENT branch) | `participant_count` includes guest attendees, who cannot open the chat. The number in the chat header can be higher than the number of people who can actually read it. | yes | Count only account-attached attendees, or accept the difference. |
| 6 | info | `src/frontend/src/pages/messages/ThreadPage.tsx` | The EVENT thread header has no link back to the event page (already noted in the work-log). | yes | Add `event_id` and `author_slug` to the conversation response if wanted. |
| 7 | info | `src/frontend/src/pages/events/EventPage.tsx` | The URL slug is ignored, so a wrong or old slug renders without canonicalizing. `onBack` = `navigate(-1)` leaves the site when someone lands from a shared link. Term has the same behavior. | yes | Optionally `replace`-navigate to `eventPath(author_slug,id)` when the slug differs. |
| 8 | info | `src/frontend/src/hooks/useEventSignUp.ts` / backend `sign_up` | If a token expires mid-session, the one-click sign-up is sent as a guest and gets 400 "Podaj swoje imię." (spec-audit L9, documented). | yes | Return 401 when an Authorization header is present but invalid, or document it. |

No critical issues.

## 4. Functional completeness
About **97%**. Every scoped requirement (1–9 in requirements.md) is implemented and reachable through the UI. What is left is copy and edge-case polish (issues 1–3). Visual fidelity against the mockups was checked only through visual-coverage.md and the group notes. visual-fidelity.md does not exist, so there was no runtime browser check.

## 5. Pragmatic action plan
| Priority | Task | Success criterion | Effort |
|---|---|---|---|
| High | Fix the empty-list copy for the author and ended views (#1) | The author and ended views never invite a sign-up; one EventPage test per view | 20 min |
| High | Fix the verb agreement in the delete hint (#2) | The hint reads correctly for 1, 2, 5 and 22; small component test | 10 min |
| Medium | Invalidate conversations on event delete (#3) | The inbox drops the EVENT row right after delete | 5 min |
| Low | Document the global conversation-child cascade (#4) | migrations/architecture docs mention it | 10 min |
| Optional | #5–#8 | n/a | 1–2 h |

## 6. Completion verdict
**⚠️ Complete with minor gaps.** The work actually solves the request: a public, Term-styled event page under the organizer's slug, with banner → date → participants and their items → event chat, guest and account sign-up, withdraw, and no "potrzebne rzeczy". Integration points (messaging, Spotkania, inbox, OG, theme, migration cascade) are wired and tested. It can ship after the two copy fixes. Neither blocks deployment.
