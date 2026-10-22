# E2E Verification Report

## TL;DR
- **Verdict: ⚠️ GO WITH CAVEATS.** 11 of 13 scenarios passed and 2 failed. No Critical issues, 2 Major, 2 Minor.
- Messaging itself works end to end: item questions, unread badge, inbox, ITEM/GROUP/TERM threads, the H1 crossing-messages regression, read-only states, deep links, composer errors, local times and all entry-point gating.
- **Major 1:** the thread page leaks a document-level scroll in long threads. Every bubble's `sr-only` span is `position:absolute` inside a non-positioned scroll container, so the page grows to about 3,100 px and the user can scroll the top bar and composer away into blank space.
- **Major 2:** clicking "Wcześniejsze wiadomości" when the list is not exactly at `scrollTop 0` makes the view jump by the height of the loaded page (the scroll is compensated twice). Auto-loading at the very top keeps the position correctly.
- Visual fidelity (SC16): 5 ✓, 2 ⚠, 0 ✗ across 7 screens.

## Open Questions / Risks
- **Major:** document scroll leak on ThreadPage (§5.2 M1). This affects every thread with enough messages at every viewport size, and is most visible on phones.
- **Major:** the "Wcześniejsze wiadomości" button jumps the view (§5.2 M2).
- **Not verified live:** day separators across several days ("wczoraj", weekday names). Every seeded message was sent today, and backdating rows would need direct DB writes. The unit tests for `messageTime` cover these formats.
- **Not verified live:** the 20/h new-ITEM-conversation limit and moderation rejection (backend-tested).

## 1. Identifier
- **Task**: 2026-10-22-messenger (Messenger: item questions, group chat, term chat)
- **Task path**: C:/Users/karas/Desktop/swaptime/group-thing-app/.maister/tasks/development/2026-10-22-messenger
- **Spec**: implementation/spec.md (rev 2)
- **Date**: 2026-10-22
- **Git ref**: 94b90b5 on `feat/private-group-join-by-code` (with an uncommitted messenger working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite), proxying `/api` to FastAPI at http://127.0.0.1:8080 (DB at 0061) |
| Browser | Chromium 155.0.8059.86 (Playwright MCP); a second isolated browser context ran a second user at the same time |
| Viewport | 420×860 (main); 320×640 and 360×640 (layout); 1280×900 (mockups) |
| Auth context | 4 freshly registered accounts: `e2e.czat.org.799309@example.com` (ORGANIZER), `e2e.czat.a.799309@…` (A, item owner and member), `e2e.czat.b.799309@…` (B, asker and member), `e2e.czat.c.799309@…` (C, outsider and withdrawn attendee); plus anonymous |
| Test data | Live and self-seeded through the API: PRIVATE group "E2E Czat Prywatna 799309" with a term on 29.10 17:00; PUBLIC group "E2E Czat Publiczna 799309" with a term on 30.10 18:00; items "E2E Czat Rower 799309" and "E2E Czat Hulajnoga 799309" owned by A; 60+ messages in one ITEM thread. Timezone Europe/Warsaw (CEST, UTC+2). |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 13 |
| Scenarios executed | 13 |
| Passed | 11 |
| Failed | 2 |
| Blocked | 0 |
| Pass rate | 85% |
| Critical issues | 0 |
| Major issues | 2 |
| Minor issues | 2 |
| Cosmetic issues | 0 |

The messenger works functionally across all three conversation kinds. "Zapytaj o rzecz" opens a thread, the 💬 badge picks up new messages on its 20 s poll, the inbox shows bold unread rows with kind chips, and opening a thread clears the badge. Replies reach the other party on the next 5 s poll, and crossing messages (the H1 regression) converge to the server order in both browsers, also after leaving and re-entering the thread. Access gating on the term page, GroupDetailsPage and TermAttendeesPage matched the spec matrix in all 9 role/visibility combinations I tested. Read-only states (`GROUP_PUBLIC`, and `GROUP_DELETED` taking precedence) render the right header and banner. The two failures are both in ThreadPage scrolling: a document-level scroll leak caused by the `sr-only` spans, and a double scroll compensation when the "Wcześniejsze wiadomości" button is clicked.

## 4. Verification Scenarios

### 4.1 Item question (ask → badge → inbox → read → reply) — ✅ Passed
- **User story / acceptance criterion**: User Stories 1–2; requirements 30, 32, 33, 34; SC12, SC15
- **Preconditions**: B is logged in (main context) and A is logged in (second context, on /panel). Item "E2E Czat Rower 799309" belongs to A.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | B opens A's item page | "💬 Zapytaj o rzecz" under the status card | Button present under "Aktualny status · Dostępna" | ✅ |
| 2 | B clicks "Zapytaj o rzecz" | Navigates to the new thread | `/panel/wiadomosci/97e29ab7…`; header "E2E Czat Rower 799309 / Rozmowa z: E2E Czat A 799309 · zobacz rzecz"; composer focused; "Wyślij" disabled; "0 / 1000" | ✅ |
| 3 | B types a 2-line message (Enter between lines) and clicks Wyślij | Message sent, field cleared and refocused | Bubble on the right showing "16:38"; textarea empty and focused | ✅ |
| 4 | Wait on A's /panel | 💬 badge shows the count within about 20 s | `aria-label="Wiadomości (1 nieprzeczytane)"`, badge "1". Not yet shown at +18 s, shown at +23 s, which is one 20 s poll tick plus latency | ✅ |
| 5 | A opens the inbox | Row bold, "Rzecz" chip, preview "{sender}: …", count | Chip "Rzecz", title weight 800, "E2E Czat B 799309: Dzień dobry, czy rower…", time "16:38", count "1" | ✅ |
| 6 | A opens the thread | Badge clears | aria-label went back to "Wiadomości" within 226 ms | ✅ |
| 7 | A replies | B sees the reply within about 5 s without reloading | Seen by B after 5.2 s (one 5 s poll tick) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/01-item-page-visitor-ask-button.png`, `e2e-screenshots/02-item-thread-empty-B.png`, `e2e-screenshots/03-A-topbar-badge.png`, `e2e-screenshots/04-A-inbox-unread-row.png`, `e2e-screenshots/05-A-thread-opened-badge-cleared.png`, `e2e-screenshots/06-B-sees-reply.png`
- **Acceptance criteria checklist**:
  - [x] "Zapytaj o rzecz" opens or creates the thread and navigates
  - [x] Badge shows the unread count (20 s poll)
  - [x] Inbox row is bold, has the "Rzecz" chip and an unread count
  - [x] Opening the thread clears the badge
  - [x] The reply appears for the other party on the 5 s poll

### 4.2 Crossing messages (regression H1) — ✅ Passed
- **User story / acceptance criterion**: requirements 17, 18 and 29 (`useThread` merge); Key Decision "Messages in a conversation are committed in `created_at` order"
- **Preconditions**: A and B both have thread 97e29ab7 open in separate browser contexts.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | A sends "H1-A-1"; 0.7 s later B sends "H1-B-1"; 0.3 s later A sends "H1-A-2" | Both eventually show all 3 in server order | At +4 s: A had [A-1, A-2] and B had [A-1, B-1]. At +8, +12 and +16 s both had [A-1, B-1, A-2] | ✅ |
| 2 | Compare with `GET /messages` | Same order | Server order [A-1, B-1, A-2] | ✅ |
| 3 | Both leave ("Wróć") and re-enter | Same order, nothing missing | Both [A-1, B-1, A-2] | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/07-H1-B-converged.png`, `e2e-screenshots/08-H1-A-converged.png`
- **Acceptance criteria checklist**:
  - [x] Both users see all messages without reloading
  - [x] Order matches the server's `(created_at, id)` order
  - [x] Still correct after leaving and re-entering

### 4.3 Item button states — ✅ Passed
- **User story / acceptance criterion**: requirements 10, 33, 34; SC4 (deleted item thread writable), SC15
- **Preconditions**: A owns both items. B opened a thread about "Hulajnoga" before A soft-deleted the item.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | A (owner) opens the Rower item page | No "Zapytaj o rzecz" | Button absent | ✅ |
| 2 | B asks about Hulajnoga and sends; A deletes the item (`DELETE` 204); B reloads the thread | Header shows "(usunięte)" and no "zobacz rzecz" link | "E2E Czat Hulajnoga 799309 (usunięte)" / "Rozmowa z: E2E Czat A 799309", no link, composer still present | ✅ |
| 3 | B sends in the deleted-item thread | Still writable | Message sent | ✅ |
| 4 | B opens the deleted item page | No "Zapytaj o rzecz" | "Rzecz usunięta" banner, no button | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/09-owner-item-page-no-ask.png`, `e2e-screenshots/10-deleted-item-thread.png`, `e2e-screenshots/11-deleted-item-page-B.png`
- **Acceptance criteria checklist**:
  - [x] Hidden for the owner
  - [x] Hidden on a deleted item
  - [x] An existing deleted-item thread shows "(usunięte)", has no link and stays writable

### 4.4 Term page buttons — ✅ Passed
- **User story / acceptance criterion**: requirements 35 and 39; SC15 (term-page matrix)
- **Preconditions**: PRIVATE group: org is the organizer; A is a member and active attendee; B is a member only; C is an outsider. PUBLIC group: B is an active attendee and C has withdrawn.

| # | User / term | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Organizer / PRIVATE | Czat terminu + Czat grupy | Both | ✅ |
| 2 | A (member + attendee) / PRIVATE | Both | Both | ✅ |
| 3 | B (member only) / PRIVATE | Czat grupy only | Czat grupy only | ✅ |
| 4 | C (non-member) / PRIVATE | None | None | ✅ |
| 5 | Anonymous / PRIVATE | None | None | ✅ |
| 6 | Organizer / PUBLIC | Czat terminu only | Czat terminu only | ✅ |
| 7 | B (attendee) / PUBLIC | Czat terminu only | Czat terminu only | ✅ |
| 8 | C (withdrawn) / PUBLIC | None | None | ✅ |
| 9 | Anonymous / PUBLIC | None | None | ✅ |
| 10 | A after withdrawing / PRIVATE | Czat grupy only; deep link to the term chat is denied | Czat grupy only; the term chat shows "Nie masz dostępu do tej rozmowy." | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/12-term-private-organizer.png`, `e2e-screenshots/13-term-private-member-attendee-A.png`, `e2e-screenshots/14-term-private-member-only-B.png`, `e2e-screenshots/15-term-private-nonmember-C.png`, `e2e-screenshots/16-term-private-anon.png`, `e2e-screenshots/17-term-public-organizer.png`, `e2e-screenshots/18-term-public-attendee-B.png`, `e2e-screenshots/19-term-public-withdrawn-C.png`, `e2e-screenshots/27-term-private-withdrawn-A.png`
- **Acceptance criteria checklist**:
  - [x] "Czat terminu" for the organizer and active attendees
  - [x] "Czat grupy" for members and the organizer of a PRIVATE group
  - [x] Neither when logged out; no "Czat grupy" on a PUBLIC group
  - [x] No "Czat terminu" for a withdrawn attendee

### 4.5 Organizer entry points — ✅ Passed
- **User story / acceptance criterion**: requirements 36 and 37; SC15
- **Preconditions**: The organizer is logged in.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open GroupDetailsPage (PRIVATE) | Card "Czat grupy / Napisz do wszystkich członków grupy. / 💬 Otwórz czat grupy" above "Kod dostępu" | Present, verbatim copy, above "Kod dostępu" | ✅ |
| 2 | Open GroupDetailsPage (PUBLIC) | No card | No card | ✅ |
| 3 | Open TermAttendeesPage | "💬 Napisz do uczestników" in TermHeadCard | Present | ✅ |
| 4 | Click it | Opens the term chat | `/panel/wiadomosci/873bf405…`, "E2E Czat Prywatna 799309 · czat terminu", "2 uczestników" | ✅ |
| 5 | Click "Otwórz czat grupy" | Opens the group chat | `/panel/wiadomosci/89596f9b…`, the same id A reached through the term page | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/20-group-details-private-chat-card.png`, `e2e-screenshots/21-group-details-public-no-card.png`, `e2e-screenshots/22-term-attendees-write-button.png`, `e2e-screenshots/23-term-chat-organizer-empty.png`
- **Acceptance criteria checklist**:
  - [x] GroupDetailsPage card on PRIVATE groups only
  - [x] TermAttendeesPage "Napisz do uczestników" opens the term chat

### 4.6 Group chat with 3 users — ✅ Passed
- **User story / acceptance criterion**: requirements 16 and 33; `screen:thread-group`
- **Preconditions**: Organizer, A and B, all in the PRIVATE group.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Organizer, A and B each send one message | Others' messages show the sender name and initials avatar | "E2E Czat Org 799309", "E2E Czat A 799309" above the bubbles with initials; own messages on the right without a name | ✅ |
| 2 | Look at the organizer's message | "Organizator" chip | Chip `bg-mint-soft text-primary-fg` (rgb 17,123,99 on rgb 216,240,230) | ✅ |
| 3 | Header | "{group} · czat grupy" and "3 uczestników" | "E2E Czat Prywatna 799309 · czat grupy" / "3 uczestników" | ✅ |
| 4 | Day separators | Separator pill before the first message of each day | "dzisiaj" pill shown. Multi-day separators not verified because every message was sent today | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/24-group-chat-B-view.png`, `e2e-screenshots/25-group-chat-A-view.png`
- **Acceptance criteria checklist**:
  - [x] Sender names
  - [x] "Organizator" chip
  - [x] Participant count
  - [ ] Day separators across several days (not feasible live; see §8)

### 4.7 Read-only states — ✅ Passed
- **User story / acceptance criterion**: requirements 9 and 33; SC4
- **Preconditions**: The group chat has messages, and B is viewing it.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Organizer switches the group PRIVATE→PUBLIC; B reloads | Header "Grupa publiczna"; banner "Grupa jest publiczna — czat jest tylko do odczytu"; no composer | Exactly that | ✅ |
| 2 | B sends through the API | 409 with the Polish message | 409 "Grupa jest publiczna — czat jest tylko do odczytu" | ✅ |
| 3 | Switch back to PRIVATE | Composer returns | Composer present | ✅ |
| 4 | Switch to PUBLIC and soft-delete the group (A withdrew first, because a delete with attendees is blocked with 409) | Header "Grupa usunięta"; banner "Grupa usunięta — czat jest tylko do odczytu"; `read_only_reason=GROUP_DELETED` (deleted takes precedence over public) | Exactly that | ✅ |
| 5 | B's inbox | The read-only group row is still listed | Listed | ✅ |
| 6 | Organizer opens the term chat of the deleted group | Read-only "Grupa usunięta" | Header "Grupa usunięta" and the banner | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/26-group-chat-public-readonly.png`, `e2e-screenshots/28-group-chat-deleted-readonly-B.png`, `e2e-screenshots/29-B-inbox-with-readonly-rows.png`, `e2e-screenshots/30-term-chat-deleted-group-organizer.png`
- **Acceptance criteria checklist**:
  - [x] PUBLIC → read-only banner, send 409
  - [x] Back to PRIVATE → writable again
  - [x] Deleted → "Grupa usunięta", taking precedence over PUBLIC
  - [x] Read-only chats stay in the inbox

### 4.8 Deep links — ⚠️ Passed with issues
- **User story / acceptance criterion**: requirements 31 and 33 (`notFound`, `denied`); SC3, SC14
- **Preconditions**: Thread 97e29ab7 belongs to A and B.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Logged out, open the thread URL | Redirect to login with returnTo | `/login?returnTo=%2Fpanel%2Fwiadomosci%2F97e29ab7…` | ✅ |
| 2 | Log in as B through the form | Back on the thread | Thread shown | ✅ |
| 3 | Open an unknown UUID | "Nie znaleziono rozmowy." plus a link back | Shown, with "Wróć do wiadomości" | ✅ |
| 4 | Open a malformed id (`not-a-uuid`) | notFound (400 counts as notFound) | "Nie znaleziono rozmowy." | ✅ |
| 5 | C opens A and B's thread | "Nie masz dostępu do tej rozmowy." | Shown, with the link back | ✅ |
| 6 | Watch the network on the denied view for 12 s | No further fetching | `GET …/messages` repeats every 5 s (3 calls in 12 s, each 403) | ⚠️ |

- **Issues observed**: §5.3 m1
- **Evidence**: `e2e-screenshots/31-deeplink-logged-out-login.png`, `e2e-screenshots/32-deeplink-after-login-thread.png`, `e2e-screenshots/33-deeplink-unknown-id.png`, `e2e-screenshots/34-deeplink-other-users-thread-C.png`
- **Acceptance criteria checklist**:
  - [x] Login redirect and return
  - [x] Unknown id → not found
  - [x] Other user's thread → no access

### 4.9 Composer — ✅ Passed
- **User story / acceptance criterion**: requirement 33 (composer), requirement 41; `component:message-composer`
- **Preconditions**: B is in thread 97e29ab7.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Press Enter in the textarea | Inserts a newline. The spec defines no send key; sending is button-only | Value `"Dzień dobry,\nczy rower…"`, nothing sent | ✅ |
| 2 | Empty / whitespace-only | "Wyślij" disabled | Disabled for both (counter "0 / 1000" and "7 / 1000") | ✅ |
| 3 | 1000 characters / try 1001 | 1000 allowed; more is blocked | `maxlength=1000`, counter "1000 / 1000", enabled | ✅ |
| 4 | Focus on open and after a send | Textarea focused | `document.activeElement` = textarea "Wiadomość" in both cases | ✅ |
| 5 | 30 API sends, then a 31st from the UI | 429 alert copy; text kept | `role="alert"` "Za dużo wiadomości — spróbuj ponownie za chwilę."; text kept | ✅ |
| 6 | Send intercepted with a 500 "Validation failed" envelope | Fallback copy; text kept | "Nie udało się wysłać — spróbuj ponownie"; text kept | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/35-composer-over-limit.png`, `e2e-screenshots/36-composer-429-error.png`, `e2e-screenshots/51-composer-generic-error.png`
- **Acceptance criteria checklist**:
  - [x] Enter = newline
  - [x] Counter "n / 1000"
  - [x] Disabled when empty
  - [x] Focus on open and after a send
  - [x] 429 error copy under the composer, text kept

### 4.10 Scrolling — ❌ Failed
- **User story / acceptance criterion**: requirements 17 and 33 ("sticks to the bottom", "Wcześniejsze wiadomości"); SC9
- **Preconditions**: Thread 97e29ab7 seeded to 60 messages (B 30 + A 25 through the API, under the 30/min limit, plus 5 earlier).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | A opens the thread fresh | Newest 50, scrolled to the bottom | 50 messages, gap to the bottom 0 px | ✅ |
| 2 | B had the thread open during seeding | All new messages arrive through the `after=` poll | B held all 60 | ✅ |
| 3 | Mouse-wheel up until `scrollTop` = 0 | Older page loads, view stays in place | Auto-load: 60 messages, the anchor bubble stayed at y=205 (was 203) | ✅ |
| 4 | Set `scrollTop` = 20 (button visible) and click "Wcześniejsze wiadomości" | Older page loads, view stays in place | 60 loaded, but `scrollTop` 20 → 1171 and the anchor bubble y 185 → −391: the view jumped by about 576 px (one loaded page) | ❌ |

- **Issues observed**: §5.2 M2
- **Evidence**: `e2e-screenshots/37-long-thread-opens-at-bottom.png`, `e2e-screenshots/38-older-button-visible.png`, `e2e-screenshots/39-after-load-older.png`, `e2e-screenshots/40-older-button-before-click.png`, `e2e-screenshots/41-older-button-after-click-jumped.png`
- **Acceptance criteria checklist**:
  - [x] Opens scrolled to the bottom
  - [x] Older messages load
  - [ ] No jump when the button is used

### 4.11 Layout at 320 px and 360 px — ❌ Failed
- **User story / acceptance criterion**: requirement 33 (`h-[calc(100dvh-57px)]`), `standards/frontend/responsive.md`
- **Preconditions**: B is logged in, at 320×640 and 360×640.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Top bar at 360 | No overflow, 57 px | 57 px, no horizontal overflow | ✅ |
| 2 | Top bar at 320 | No overflow | No horizontal overflow, but "Krąg grupy" wraps to 2 lines (bar is 68 px instead of 57 px) | ⚠️ |
| 3 | Composer visible (item, group and deleted-item threads) | Composer and "Wyślij" in the viewport | Visible at both widths | ✅ |
| 4 | Document height on the 60-message thread | Page fits the viewport; only the log scrolls | `documentElement.scrollHeight` = 3098 at every width (also 420); the wheel scrolled the window to y=2458, a blank screen with the top bar and composer gone | ❌ |
| 5 | Item header second line | "Rozmowa z: … · zobacz rzecz" usable | Truncated to "zobacz r…" at 360 and clipped entirely at 320 | ⚠️ |

- **Issues observed**: §5.2 M1, §5.3 m2
- **Evidence**: `e2e-screenshots/42-layout-320-thread-item.png`, `e2e-screenshots/42-layout-360-thread-item.png`, `e2e-screenshots/42-layout-320-thread-group.png`, `e2e-screenshots/42-layout-360-thread-group.png`, `e2e-screenshots/42-layout-320-inbox.png`, `e2e-screenshots/42-layout-360-inbox.png`, `e2e-screenshots/43-document-scroll-leak-360.png`
- **Acceptance criteria checklist**:
  - [ ] Top bar does not overflow or wrap at 320 px
  - [x] Composer visible at 320 and 360
  - [ ] Thread page does not scroll as a document

### 4.12 Times in local time — ✅ Passed
- **User story / acceptance criterion**: requirement 40; SC13
- **Preconditions**: Browser timezone Europe/Warsaw (offset −120 min).

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Bubble for `created_at` "2026-10-22T14:38:14.109536" (naive UTC) | "16:38" | `<time datetime="2026-10-22T14:38:14.109536">16:38</time>` | ✅ |
| 2 | Inbox time for today | `HH:mm` local | "16:38", "16:41", "16:49" | ✅ |
| 3 | TERM title (server-built, never converted) | "Termin: pt 30.10 18:00" for `occurs_on` 2026-10-30T18:00 | "Termin: pt 30.10 18:00" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `e2e-screenshots/07-H1-B-converged.png`, `e2e-screenshots/45-B-inbox-term-row-organizer-prefix.png`
- **Acceptance criteria checklist**:
  - [x] Audit timestamps rendered in CEST, not UTC
  - [x] TERM title unshifted

### 4.13 SC16 visual comparison against 7 mockups — ✅ Passed
- **User story / acceptance criterion**: SC16; Visual Design table
- **Preconditions**: Each mockup opened by its `file://` path at 1280×900 and compared with the live screens.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Compare 7 screens (with bubble, composer and badge components) | Structural match, verbatim copy, states | 5 ✓, 2 ⚠ (320 px top-bar wrap; "zobacz rzecz" truncation at narrow widths), 0 ✗. The 2 known deviations (familyTone avatar tint, cream TermHeadCard) are accepted | ✅ |
| 2 | States: "9+", empty, skeleton, composer error, read-only header and banner | Present | "9+" (12 unread), empty card verbatim, skeleton row, 429 and generic composer errors, "Grupa publiczna"/"Grupa usunięta" header lines and banners | ✅ |

- **Issues observed**: §5.3 m2
- **Evidence**: `e2e-screenshots/m1-mockup-ikona-wiadomo-ci-w-g-rnym-pasku.png` … `e2e-screenshots/m7-mockup-wej-cia-organizatora.png`, `e2e-screenshots/47-A-badge-9plus.png`, `e2e-screenshots/46-C-inbox-empty.png`, `e2e-screenshots/49-inbox-skeleton.png`, `e2e-screenshots/50-inbox-error.png`; details in `visual-fidelity.md`
- **Acceptance criteria checklist**:
  - [x] Layout, copy and tokens match per screen
  - [x] "9+", empty, skeleton, composer error, read-only header and banner present

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major

**M1: ThreadPage leaks a document-level scroll; the top bar and composer can be scrolled away into a blank page**
- **Spec requirement**: Requirement 33: "It is full height (`h-[calc(100dvh-57px)]`) with no PanelNavBar"; "Messages: a scrollable list"; the composer is sticky.
- **Expected**: Only the `role="log"` list scrolls, and the page always fits the viewport.
- **Actual**: In a 60-message thread `document.documentElement.scrollHeight` is 3098 px at 320, 360 and 420 px wide (viewport 640). Once the log reaches its end the wheel or touch scroll chains to the window (scrollY 2458), which shows an empty page with no top bar and no composer. Short threads (3 messages) are not affected.
- **Evidence**: `e2e-screenshots/43-document-scroll-leak-360.png`, `e2e-screenshots/42-layout-360-thread-item.png` (document scrollbar visible). DOM probe: 50 `.sr-only` spans in the log, `position: absolute`, max `bottom` = 3098; log `position: static`.
- **Root cause hypothesis**: Each bubble has `<span class="sr-only">…:</span>` (Tailwind `sr-only` = `position:absolute`). Neither the bubble nor the `role="log"` scroller is positioned, so the spans' containing block is the initial containing block. Their static positions deep inside the scrolled content extend the document's scrollable overflow.
- **User impact**: On phones a user scrolling through a long chat overshoots into a blank screen and loses the composer and navigation. This affects every user of a busy chat.
- **Recommended fix**: Add `relative` to the `role="log"` container in `pages/messages/ThreadPage.tsx` (`MessageList`), or to the bubble root in `MessageBubble.tsx`. Add a regression check that the document height equals the viewport on a long thread.
- **Workaround**: Scroll back up in the window, or reload.

**M2: "Wcześniejsze wiadomości" button makes the view jump by the loaded page height**
- **Spec requirement**: Requirement 33: "offers 'Wcześniejsze wiadomości' when `hasOlder`". The test scenario requires older messages to load without the view jumping; the code comment says "older ones prepended above keep the visible message in place".
- **Expected**: After prepending, the previously visible message stays at the same screen position.
- **Actual**: With `scrollTop` = 20 (button visible) a click loads 10 older messages, then `scrollTop` goes 20 → 1171 (expected about 596) and the anchor bubble moves from y=185 to y=−391. The view jumps down by about 576 px, past the content the user was reading. Loading through scroll-to-top (`scrollTop` = 0) is correct: the anchor stays at y≈205.
- **Evidence**: `e2e-screenshots/40-older-button-before-click.png`, `e2e-screenshots/41-older-button-after-click-jumped.png` (jump), `e2e-screenshots/39-after-load-older.png` (auto-load path correct)
- **Root cause hypothesis**: Chromium's native scroll anchoring (`overflow-anchor: auto`, active when `scrollTop` > 0) already keeps the content in place when nodes are inserted above. The `useLayoutEffect` in `MessageList` then adds `scrollHeight - prev.height` again, compensating twice. At `scrollTop` 0 the browser does not anchor, so the auto-load path is right.
- **User impact**: Anyone who taps the button (or reaches it with the keyboard, or stops momentum scrolling just short of 0) lands far below the messages they wanted to read.
- **Recommended fix**: Set `overflow-anchor: none` (Tailwind `[overflow-anchor:none]`) on the `role="log"` container so the manual compensation is the only one. Alternatively, anchor on a message element's offset instead of the `scrollHeight` delta.
- **Workaround**: Scroll to the very top instead of clicking the button.

### 5.3 Minor

**m1: Thread messages query keeps polling every 5 s on `denied` / `notFound` views**
- **Spec requirement**: Requirement 29 (`useThread` polling) and requirement 33 (`notFound` / `denied` views show a message and a link back).
- **Expected**: No repeated message fetches once the conversation is known to be 403 or 404.
- **Actual**: On a denied thread, `GET /api/conversations/{id}/messages` fired 3 times in 12 s, each 403, and keeps going while the page is open. The same happens for an unknown id (404) and a malformed id (400).
- **Evidence**: Network capture in scenario 4.8 step 6; console shows repeated `403 … /messages` entries. `hooks/useThread.ts:90` sets `refetchInterval: THREAD_POLL_MS` with no error- or view-based gating.
- **Root cause hypothesis**: The `useThread` query is always enabled with a fixed `refetchInterval`. React Query keeps the interval running after errors.
- **User impact**: Wasted requests and console noise; no visible UI effect.
- **Recommended fix**: Make `refetchInterval` a function that returns `false` when the query is in an error state with a 4xx `ApiError`, or gate `enabled` on the conversation query not being notFound or denied.
- **Workaround**: None needed.

**m2: At 320 px the top bar wraps and the thread header link is clipped**
- **Spec requirement**: Requirement 30 (💬 button before the bell); requirement 33 (full-height `100dvh-57px`; "Rozmowa z: {counterpart_name} · zobacz rzecz"); `responsive.md`.
- **Expected**: Top bar stays one line (57 px) at 320 px, and the "zobacz rzecz" link stays reachable.
- **Actual**: At 320 px "Krąg grupy" wraps to two lines (bar 68 px), so the fixed `100dvh-57px` thread is 11 px taller than the space left. The header's second line ellipsizes, and "zobacz rzecz" is clipped at 320 px and shows as "zobacz r…" at 360 px with these test names. No horizontal overflow occurs.
- **Evidence**: `e2e-screenshots/42-layout-320-thread-item.png`, `e2e-screenshots/42-layout-360-thread-item.png`
- **Root cause hypothesis**: The extra 40 px `MessagesButton` leaves too little width for the brand text at 320 px. The ITEM subtitle is one ellipsized line containing both the counterpart name and the link.
- **User impact**: Small layout shift on the narrowest phones; the item link is hard to reach with longer names.
- **Recommended fix**: Add `whitespace-nowrap` / `truncate` to the brand label, or hide the brand text below 340 px. Put "zobacz rzecz" outside the truncated span (or on its own line) so it never gets clipped.
- **Workaround**: Open the item from the inbox or the item list.

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/organizations/mine` | 404 Not Found | Every page load for non-organization users | Minor | Pre-existing; unrelated to messaging |
| `GET /api/conversations/{id}/messages` (useThread poll) | 403 / 404 / 400 repeated every 5 s on denied or not-found threads | Continuous while the view is open | Minor | §5.3 m1 |
| `GET /api/conversations/{id}` | 403 / 404 / 400 on deep-link tests | Once per open | Minor | Expected; it drives the `denied` / `notFound` views |
| `POST /api/conversations/{id}/messages` | 409 / 429 | Once each, provoked by the tests | Minor | Expected (read-only and rate-limit tests) |

No uncaught JavaScript exceptions or React errors were observed.

## 7. Spec Alignment
- **Fully implemented**:
  - Req 30 `MessagesButton` (badge, "9+", aria-label "Wiadomości (12 nieprzeczytane)", hidden at 0)
  - Req 31 routes and AuthGuard return-to
  - Req 32 InboxPage (chips, 📦/initials/📅 visuals, "Ty:" / "Organizator:" / "{name}:" prefixes, bold + count, empty card verbatim, skeleton, error + "Spróbuj ponownie")
  - Req 33 header copy, participant count, bubbles, Organizator chip, composer, read-only banners, notFound/denied copy
  - Req 34 "Zapytaj o rzecz" gating and navigation
  - Req 35 term buttons matrix
  - Req 36 GroupDetailsPage card
  - Req 37 TermAttendeesPage button
  - Req 39 `is_active_attendee`
  - Req 40 local-time rendering
  - Req 41 `chatErrorMessage` (429 pass-through, generic fallback)
  - Reqs 9, 10, 12, 13 behavior observed through the UI and API
- **Partially implemented**:
  - Req 33 "Wcześniejsze wiadomości" without a jump: the auto-load path works, the button path jumps (M2)
  - Req 33 full-height layout: document overflow on long threads (M1)
- **Not implemented**: _None._
- **Extra (unspecified) behavior**:
  - Older messages auto-load when the log reaches `scrollTop` 0, in addition to the button
  - ITEM threads also show the counterpart's initials avatar next to their bubbles (consistent with the `rozmowa-o-rzeczy` mockup)

## 8. Variances from Plan
- **Day separators across several days** were not exercised live: all messages were created today, and backdating `created_at` would need direct DB writes. Only "dzisiaj" was observed. Unit tests for `messageTime` / `formatDaySeparator` cover the rest.
- **Seeding** was done through `fetch` inside the browser (registration, groups, join code, RSVP, items, messages) rather than through UI forms, for speed.
- **Two users at once** were driven through a second isolated Playwright browser context (`browser.newContext`). The main MCP page switched between organizer, B, C and anonymous by swapping the stored token.
- **Soft-delete** first required A to withdraw from the PRIVATE term, because the backend blocks deleting a group with active attendances (409). A's withdrawal was reused for the withdrawn-attendee check on a PRIVATE term.
- **429** was triggered cheaply: B sent 30 messages through the API and then a 31st from the UI. Message seeding stayed within the per-minute limit for each user.
- **Composer generic-error** state was produced by intercepting the send request with a 500 response through Playwright routing. The inbox error and skeleton states used the same technique (a 500 response and a 3 s delay).
- The 20/h new-ITEM-conversation limit and moderation rejection were not exercised (backend-tested).

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| SC2: Item conversations: 201, then 200 with the same id; owner gets 409 | ✅ | The "Zapytaj o rzecz" re-open lands on the same id; the owner sees no button (4.1, 4.3) |
| SC3: Access per kind; 404 before 403 | ✅ | Third party denied, unknown id not found, withdrawn attendee denied (4.4, 4.8) |
| SC4: Read-only (deleted group, PUBLIC toggle, deleted item writable) | ✅ | 4.3, 4.7 |
| SC6: Rate limits: 31st send gives 429 | ✅ | 4.9 step 5 |
| SC7: Read markers: unread equals the messages, uncapped; marking clears | ✅ | 12 unread → "9+"; the badge clears on open (4.1, 4.13) |
| SC9: Paging and ordering | ⚠️ | Paging works, the newest 50 on open; the button-path jump is M2 (4.10) |
| SC10: `GET /unread-count` routed | ✅ | 200 `{count:1}` (4.1) |
| SC12: Polling 20 s (unread) / 5 s (thread), merged into the cache | ✅ | Badge after 18–23 s; reply after 5.2 s; H1 convergence (4.1, 4.2) |
| SC13: Time display "12:00" for 10:00 naive UTC in CEST | ✅ | 14:38 UTC rendered as "16:38" (4.12) |
| SC14: View state: notFound (404/400), denied (403), readOnly (both reasons), ready | ✅ | 4.7, 4.8 |
| SC15: Entry points | ✅ | 4.3, 4.4, 4.5 |
| SC16: Mockup fidelity with side-by-side check | ✅ | `visual-fidelity.md`: 5 ✓, 2 ⚠, 0 ✗ |

## 10. Recommendations
- **Must fix before merge**: §5.2 M1 (document scroll leak, a one-class fix), §5.2 M2 (double scroll compensation on "Wcześniejsze wiadomości")
- **Should fix soon**: §5.3 m1 (stop polling on denied / not found), §5.3 m2 (320 px top-bar wrap and "zobacz rzecz" clipping)
- **Nice-to-have**: Add a Playwright or Vitest-DOM regression check for document height equal to the viewport on ThreadPage with 50+ messages.

## 11. Artifacts
- **Screenshots**: `verification/e2e-screenshots/` (63 files: 56 live-app screenshots and 7 full-page mockup captures `m1`–`m7`)
- **Visual-fidelity report**: `verification/visual-fidelity.md` (with `verification/visual-fidelity.html`)
- **Console log dump**: inline in §6
- **HTML companion**: `verification/e2e-verification-report.html`

## 12. Conclusion
⚠️ GO WITH CAVEATS. All functional flows of the messenger work in a live browser: ask about an item, badge, inbox, threads of all three kinds, the H1 crossing-message regression, read-only states, deep links, composer errors and local times. Access gating matched the spec matrix in every combination I tested. The two Major defects are both ThreadPage scroll mechanics with small, well-localized fixes (`relative` on the log, and `overflow-anchor: none`). Next step: **fix, then merge**. Apply the M1 and M2 fixes, re-check scenario 4.10 step 4 and scenario 4.11 step 4, and then merge.

## Re-check after fixes
Re-run on 2026-10-22 against the live Vite dev server (picked up through HMR; the servers were not restarted), with the same test data and Chromium 155. The original findings above are kept as recorded. This section gives their status after the fixes.

| Item | Check | Result | Evidence |
|---|---|---|---|
| M1 document scroll leak | 60-message item thread at 360×640 and 320×640: `document.documentElement.scrollHeight` against the viewport; then 10 wheel-downs over the log | ✅ PASS. `scrollHeight` is 640 at both widths (860 at 420×860). After wheeling, `window.scrollY` stays 0 and the page never scrolls into a blank area. The log is now `position: relative`. | `e2e-screenshots/recheck-360-thread-item-top.png`, `e2e-screenshots/recheck-360-after-wheel-down.png`, `e2e-screenshots/recheck-320-thread-item-top.png`, `e2e-screenshots/recheck-320-after-wheel-down.png` |
| M2 "Wcześniejsze wiadomości" jump | `scrollTop` = 20, mouse-click the button | ✅ PASS. The anchor bubble ("Seed B 06") stays at y=185 → 185 (0 px drift); `scrollTop` 20 → 589 for a 569 px prepend; 50 → 60 messages. The log's `overflow-anchor` is `none`. | `e2e-screenshots/recheck-older-button-before.png`, `e2e-screenshots/recheck-older-button-after.png` |
| M2 auto-load at the top | Wheel up until older messages load at `scrollTop` 0 | ✅ PASS. The anchor stays at y=205 at load and 1.2 s later (`scrollTop` 569), matching the earlier correct behavior. | `e2e-screenshots/recheck-older-autoload-after.png` |
| m1 polling on denied / notFound | C opens A and B's thread (403) and an unknown UUID (404); all `/api/conversations/{id}*` requests recorded for 13 s | ✅ PASS. Denied: one `GET /{id}` and one `GET /{id}/messages` at 0.5 s, then nothing. Not found: one of each at 0.4 s, then nothing. | `e2e-screenshots/recheck-denied-no-polling.png` |
| m1 regression guard | A healthy thread still polls: A posts through the API while B has the thread open | ✅ PASS. B shows the message after 2.6 s. | `e2e-screenshots/recheck-poll-still-works.png` |
| m2 top bar at 320 px | Height of `nav[aria-label="Menu konta"]` | ✅ PASS. 57 px at 320 and 360 px; "Krąg grupy" fits on one line. | `e2e-screenshots/recheck-320-thread-item-top.png` |
| m2 "zobacz rzecz" visibility | Link bounding box at 320 and 360 px | ✅ PASS. The link is fully visible and not truncated: x 241–308 at 320 px and x 281–348 at 360 px. The counterpart name ellipsizes instead ("Rozmowa z: E2E Czat …"). | `e2e-screenshots/recheck-320-thread-item-top.png`, `e2e-screenshots/recheck-360-thread-item-top.png` |

**Re-check verdict:** all four findings (M1, M2, m1, m2) are fixed, with no regression in thread polling. Scenarios 4.10 and 4.11 now pass, giving 13 of 13 scenarios passing and 0 open Critical or Major issues. **Updated verdict: ✅ GO.** Merge after the usual quality gates.
