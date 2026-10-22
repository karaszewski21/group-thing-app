# Reality Check: Messenger (item questions, group chat, term chat)

## TL;DR
- **Status: ⚠️ Issues Found. Do not release until H1 is fixed.** All three user flows (item question, group chat, term chat) are wired end to end. The frontend/backend contract matches field for field, and the read-only, logged-out and badge paths work.
- **H1 (High): crossing messages disappear from the sender's view.** A message another participant sent in the up-to-5 s window before my send is never shown in my open thread. It is not shown after leaving and re-entering within about 5 min either (cached query), and the server marks it read. Only a full page reload shows it. No test covers this case.
- **The open inbox list does not poll** (Medium). The 💬 badge updates every 20 s, but `/panel/wiadomosci` stays stale until the user refocuses the window or navigates away and back. **The composer loses focus after every send** (Medium, UX).
- Tests (from test-suite-results.md, not re-run): backend 900/900, frontend 1094/1101 (6 failures already on HEAD + 1 flaky), tsc clean. SC1–15 and SC17 are backed by code and tests. **SC16 (mockup fidelity, side-by-side) is not verified yet**; that is Phase 12's job.
- Completion: about 90%. One fix in `useThread` plus inbox polling and composer focus would make it shippable.

## Open Questions / Risks
- **Discoverability is badge-only (user decision).** An item owner learns about a question only when they open the app and notice the 💬 badge (top bar on every PublicLayout page). There is no bell row, email or push. This was accepted, but expect slow replies.
- **Members have no stable entry to the group chat.** Members reach "Czat grupy" only from a term page of their PRIVATE group. Otherwise they use the inbox, which lists a chat only after its first message, so the organizer must post first. GroupDetailsPage is organizer-only. ("Moje grupy" is out of scope.)
- **A missing profile returns 401 on messaging, where notifications return 404.** `users_acl.get_caller_party_id` raises `AuthenticationRequiredException` (users_acl.py:31). `api/client.ts` handles a 401 by clearing the token and redirecting to `/login`. An account without a `UserProfile` would therefore be logged out by the 20 s badge poll on any page. The seeded dev users and registered users all have profiles, so this is low risk in practice, but worth knowing.
- **The rate limiter is in memory per uvicorn worker** (accepted). With N workers, the effective limit is N×30 messages per minute.
- **"Zapytaj o rzecz" creates the conversation row before anything is written.** Merely opening the thread counts against the limit of 20 new conversations per hour. Empty threads are hidden from the inbox, so this is harmless apart from the limit.

## Traced Flows (claimed vs actual)

| Flow | Path traced | Result |
|---|---|---|
| Item question | `ItemDetailPage.ItemViewContent` → `AskAboutItemButton` (shown when `!is_owner && !deleted`; `is_owner` = permanent home owner, `item_details.py:93`, matching the backend's owner rule) → `useOpenConversation.openItemConversation` → `POST /api/conversations/item` (404 → 409 own item → existing 200 → deleted 404 → limiter → savepoint insert → 201) → `navigate(/panel/wiadomosci/{id})` → `ThreadPage` (`useConversation` + `useThread`) → composer `send` → `POST /{id}/messages` | Works. On the organizer-palette route, `ItemDetailBody` reuses `ItemViewContent`, so the button shows there too |
| Owner sees it | `MessagesButton` (PublicLayout top bar, `useUnreadMessages` polls 20 s, `enabled: token !== null`) → `GET /unread-count` (exact sum, excludes own messages) → inbox `GET /api/conversations` (refetched on mount) → thread → `useThreadReadMarker` → `POST /{id}/read` → invalidates `unreadMessages` and `conversations` → badge drops | Works. The badge updates within 20 s or right after a mark-read. The inbox list does not poll while it is open (M1) |
| Reply | Owner sends; the asker's open thread polls `after=<last id>` every 5 s and merges | Works, except for crossing messages (H1) |
| Term chat | `PublicTermView.ChatRow` "Czat terminu" when `termId && isLoggedIn && (is_active_attendee \|\| is_organizer)` (server flags only) → `POST /term` (404 → 403 → existing → deleted-group 404 → insert) → thread | Works. A withdrawn attendee gets no button and a 403 from the server |
| Group chat, member | `ChatRow` "Czat grupy" when `isLoggedIn && visibility === "PRIVATE" && (is_member \|\| is_organizer)` → `POST /group` | Works |
| Group chat, organizer | `GroupDetailsPage` `GroupChatCard` (PRIVATE and `joinCode.status === "ready"`) and the `TermAttendeesPage` "Napisz do uczestników" button (term chat) | Works. The card depends on the join-code fetch succeeding (L2) |
| Read-only: deleted group | `access._read_only_reason` → `GROUP_DELETED` takes precedence; GET, messages and read work; send returns 409 with Polish copy; the inbox keeps the row (the audience queries have no `deleted_at` filter) | Works. `ThreadPage` shows the "Grupa usunięta" header and the banner in place of the composer |
| Read-only: public group | `GROUP_PUBLIC` for GROUP only; the TERM chat of a PUBLIC group stays writable; get-or-create with no existing chat returns 409 | Works. A send that hits 409 while the thread is open refetches the header, so the banner replaces the composer (tested) |
| Logged out | Item, inbox and thread routes are behind `AuthGuard` with `returnTo`; `MessagesButton` renders null without a token; the term-page buttons require `isLoggedIn`; an expired token on a poll gets a 401 → redirect to login with returnTo | Works. An unsent draft is lost on the 401 redirect (Low) |
| Contract | `api/conversations.ts` against `messaging/schemas.py`: `id, kind, title, item{id,name,deleted}, counterpart_name, group_name, term_occurs_on, unread_count, read_only_reason, participant_count, last_message{body,sender_name,is_mine,sender_is_organizer,created_at}`; `MessagePage{items,has_more}`; `{count}`; request bodies `item_id/group_id/term_id/body/message_id` | Matches exactly. Naive-UTC times are parsed with `dayjs.utc().local()`. A 204 mark-read is handled by `client.ts` |
| Routing | `/panel/wiadomosci` and `/:conversationId` under PublicLayout + AuthGuard; backend literal routes are declared before `/{id}`; matrix rows sit before the catch-all | Works. `ThreadShell` height `100dvh-57px` matches the top bar (py-2 + min-h-10 + 1 px border = 57 px) |

## Critical Gaps
None that block every user. H1 is a must-fix before release.

## Quality Gaps

### H1 (High): a message sent just before mine is never shown in my thread
- **Claim:** "an `after=` poll never skips a committed row" (spec M8, and the `useThread` doc comment).
- **Reality:** the server keeps that guarantee. The client breaks it. `send()` appends the returned message to the cache (`hooks/useThread.ts:107`). The next poll then takes `last = cached.items.at(-1)` (`:63`), which is now **my own** message, and asks for `after: last.id` (`:68`).
- **Evidence:** suppose message B from another participant commits after my last poll and before my send. The row lock makes `B.created_at < M.created_at`, so `after=M` never returns B. The send also moves my server read marker to `M.created_at` (requirement 18.10), so B never counts as unread and never becomes the inbox preview.
- **Re-entering does not help.** The query cache survives unmount for the default 5 min `gcTime`, and the `queryFn` resumes from the cached last id. B appears only after a full reload, or after the cache expires.
- **Impact:** this is the classic Messenger "crossing messages" case. In a 1:1 ITEM thread, or a busy group or term chat, a user silently misses a reply. No test covers it; `useThread.test.tsx` only has a plain send-and-append case.
- **Fix:** keep a server-poll cursor apart from locally appended messages. For example, in `send`, read the last held id *before* posting. After posting, fetch `after=<that id>` and merge the result, which includes M and anything that crossed. Or store `cursorId` in `ThreadData` and advance it only from poll and initial-load results. Add a `useThread` test: hold [A], `postMessage` returns M, and the next `getMessages(after=A)` returns [B, M]; B must be present.

### M1 (Medium): the inbox list does not refresh while open
- **Evidence:** `useConversations` (`hooks/useConversations.ts:21`) has no `refetchInterval`, and the badge poll invalidates nothing.
- **Impact:** an owner on `/panel/wiadomosci` sees the badge go to 1 while the list still shows no new row or the old preview. The list catches up only on window refocus or after navigating away and back.
- **Fix:** add `refetchInterval: 20_000` and `refetchIntervalInBackground: false` to `useConversations` (or invalidate `conversations` whenever the unread count changes), plus an interval assertion test.

### M2 (Medium, UX/a11y): composer focus
- The textarea is not focused when a thread opens; the "Zapytaj o rzecz" flow lands the user on a thread they must tap first.
- After a "Wyślij" click, the button becomes disabled (busy, then empty text). Browsers drop focus to `body`, so on mobile the keyboard closes after every message. There is no `focus()` anywhere in `pages/messages/`.
- **Fix:** return focus to the textarea after a successful send, and consider autofocusing it on desktop when the thread is writable.

### L1 (Low): missing focus rings
The `GroupChatCard` button and the `TermHeadCard` "Napisz do uczestników" button have no `focus-visible` outline classes. Every other messaging control has them, and `accessibility.md` asks for visible keyboard focus.

### L2 (Low): the organizer's chat card depends on the join code
`messageGroupCard` is gated on `joinCode.status === "ready"` (`GroupDetailsPage.tsx:52`). If the join-code request fails, the "Czat grupy" card disappears with no reason given, although the chat itself would work. The spec asked for this gating, but it couples unrelated features.

### L3 (Low): lost access is not surfaced
A user removed from a group while viewing its thread keeps the cached messages on screen. Polls fail with 403 silently because `threadViewState` shows errors only when no items are held. Sending shows "Nie masz dostępu do tego czatu." Acceptable, but not obvious to the user.

## Integration Issues
- No integration breakage was found. New FKs (`item_id`, `group_id`, `term_id`, parties) cannot block existing deletes: groups, items and needed items are only soft-deleted, terms have no delete path, and the only hard deletes (product and category, admin) never touch these tables.
- The matrix rows grant READ and EDIT, which `create_account` gives every registered user. Messaging is not in the admin `Layout`. Back-office screens have no badge, which is fine because owners use the panel.

## Functional Completeness
About 90%. Every requirement in spec rev 2 has matching code, and the plan shows 83/83 steps complete. What is missing is not a feature but correctness and UX on the live chat paths: H1, M1 and M2. The claim that SC16 (mockup fidelity) is complete is unverified; no `visual-fidelity.md` exists yet.

## Pragmatic Action Plan

| # | Action | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Fix the `useThread` cursor so the poll after a send resumes from the last *polled* id, or fetch `after=<pre-send last id>` inside `send` | A new test (hold [A], send M, poll returns [B, M]) shows A, B, M in order; re-entering the thread shows B | High (must-fix) | 1–2 h |
| 2 | Poll the inbox list (20 s, foreground only) | A hook test asserts `refetchInterval` 20 000; the open inbox shows a new row without refocus | Medium | 30 min |
| 3 | Return focus to the textarea after a successful send | A `MessageComposer` test: after send resolves, `document.activeElement` is the textarea | Medium | 30 min |
| 4 | Add `focus-visible` outline classes to the `GroupChatCard` and `TermHeadCard` buttons | Visible keyboard focus in E2E | Low | 10 min |
| 5 | Phase 12 E2E (below), including the side-by-side SC16 check | `verification/visual-fidelity.md` with no substantive ✗ entries | High (gate) | 2–3 h |

## What Phase 12 E2E Must Cover
1. **Item question, two browsers (asker A, owner B).** A on `/product/:id` taps "Zapytaj o rzecz" and lands on the thread; the header shows the 📦 tile, the item name and "Rozmowa z: B · zobacz rzecz". A sends.
   - Within 20 s, B's 💬 badge shows 1 with aria-label "Wiadomości (1 nieprzeczytane)".
   - B's inbox row is bold with a count and has the "Rzecz" chip.
   - B opens the thread; the badge drops to 0 and the row is no longer bold.
   - B replies; A sees it within 5 s without reloading.
2. **Crossing messages (H1 regression).** A and B send within the same 5 s window. Both threads must show both messages, and still do after leaving and returning to the thread.
3. **Owner on own item:** no "Zapytaj" button. **Deleted item:** no button. An existing thread shows "(usunięte)" with no link and still accepts sends.
4. **Term page matrix** (PRIVATE and PUBLIC groups) for these users: organizer, member, active attendee, withdrawn attendee (no "Czat terminu"), logged-out (no buttons), and a PUBLIC group (only "Czat terminu").
5. **Organizer entries:** the GroupDetailsPage "Czat grupy" card above "Kod dostępu" (PRIVATE only), and the TermAttendeesPage "Napisz do uczestników" button; both open the right thread.
6. **Group chat with 3 users:** sender names, initials avatars and the "Organizator" chip; "N uczestników" in the header; day separators.
7. **Read-only states:**
   - Soft-delete the group: the thread shows "Grupa usunięta" in the header, the banner replaces the composer, and the chat stays in the inbox.
   - Toggle PRIVATE→PUBLIC: "Grupa publiczna" and the banner; a send that was already open shows the 409 copy, then the banner. Toggle back: sending works again.
8. **Logged out:** a deep link to `/panel/wiadomosci/:id` goes to login, then back to the thread. A random UUID shows "Nie znaleziono rozmowy."; another user's thread shows "Nie masz dostępu do tej rozmowy."
9. **Composer:**
   - Enter inserts a new line.
   - The counter reads "n / 1000", and "Wyślij" is disabled when the text is empty or whitespace.
   - The error copy appears under the composer and the text is kept (for example, the 31st message in a minute gives a 429).
   - Focus behavior after a send (M2).
10. **Scroll:** opening a long thread lands at the bottom; "Wcześniejsze wiadomości" prepends without jumping; an incoming message auto-scrolls only when the reader is at the bottom.
11. **Layout:** at 320 and 360 px, the top bar (KG, 💬, bell, account) does not overflow; the thread fills the viewport with the composer visible, including with the mobile keyboard open (`dvh`).
12. **Time display:** bubble times and inbox times are local (CEST), not UTC; the inbox shows "wczoraj" or a weekday for older rows.
13. **Mockup side-by-side (SC16)** for all 7 mockups, including "9+", the empty inbox card, the skeleton, the composer error and the read-only header line.

## Completion Verdict
⚠️ **Gaps.** The feature exists and does what the user asked across all three flows, with a correct server, contract and entry points. But one live-chat correctness bug (H1) means real users will sometimes never see a reply. Fix H1, add inbox polling (M1) and composer focus (M2), then run the Phase 12 E2E above. After that, this can be called complete.
