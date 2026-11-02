# E2E Verification Report

## TL;DR
Verdict: **GO WITH CAVEATS**. 10 of 10 scenarios ran and passed. Every core flow works end-to-end in the live app: create, author, anonymous, guest sign-up and merge, one-click sign-up, chat, withdraw, Spotkania, ended event, old/edit routes, backslash names and the OG preview.
No Critical or Major issues. There is 1 Cosmetic finding (merge-card divider placement) and 3 Minor/informational ones.
Banner image, item rows ("Pokaż wszystkie") and the organization header chip could not be exercised locally (no storage keys, no listed items, no Organization), so they are not verified.

## Key Decisions
- Test accounts were created via `POST /api/auth/register`, and events via the `/add/event` UI (main event) and `POST /api/events` (ended and backslash events).
- The "ended" event was made by creating an event that starts in the current minute with no end time (the backend allows a start in the current minute; `has_ended` becomes true immediately). Past dates are rejected by both create and PATCH (400 "Początek nie może być w przeszłości.").
- A MANUAL location was added via `POST /api/locations` + PATCH to verify the "Miejsce" block and the OG `· place` suffix.

## Open Questions / Risks
- Item rows, thumbnails, "Pokaż wszystkie (n)"/"Zwiń", the banner, `og:image` and the organizer header chip were not verified at runtime. Unit tests are the only evidence for them.
- An anomaly that could not be reproduced: during the first withdraw attempt the attendance ended up withdrawn while the harness was stuck on a wrong locator (`role=dialog` vs the real `role=alertdialog`), with no observed click on the confirm button. A controlled re-run showed the confirm dialog working correctly (footer click → alertdialog, no request until confirm). Most likely a harness artefact. See §5.3.

## 1. Identifier
- **Task**: 2026-10-29-event-public-page
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-29-event-public-page
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-29-event-public-page\implementation\spec.md
- **Date**: 2026-10-30
- **Git ref**: bea67df (feat/events-plugin, with uncommitted working-tree changes)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5173 (Vite dev, `/api` proxied to http://localhost:8080) |
| Browser | Playwright MCP Chromium (separate browser contexts per persona) |
| Viewport | 430×900 |
| Auth context | author `e2e-author-135502@example.com`; participant `e2e-participant-135502@example.com`; anonymous context (later merged to `e2e-guest-135502@example.com`); fresh anonymous contexts |
| Test data | live local dev DB (migration head 0072); events "E2E Piknik wymiany 135502" (`64292a46-…`), "E2E Zakonczone 135502" (`87427a32-…`), "E2E Swap \o/ 135502" (`ea4c69ad-…`); author slug `k-ac16defb20c2` |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 10 |
| Scenarios executed | 10 |
| Passed | 10 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 3 |
| Cosmetic issues | 1 |

All binding flows work against the live backend. Creating an event lands on `/<slug>/event/<id>` with the saved toast, and router state is cleared afterwards. The author, visitor, guest, attendee and ended views render the right footer, card and chat row. A guest sign-up followed by an in-place account merge turns the viewer into an attendee with "To Ty" and chat. The EVENT chat shows in the thread header ("· czat wydarzenia"), in the inbox (chip "Wydarzenie", 🎉) and in the unread count, and access is revoked on withdraw. The headline caveat is coverage: the banner, item rows and organization chip could not be exercised with local data. The only visual finding is a misplaced divider in the merge card.

## 4. Verification Scenarios

### 4.1 Author creates event and sees author view — ✅ Passed
- **User story / acceptance criterion**: Author story; Req 10, 11; screen:event-author; M1 post-create toast
- **Preconditions**: Logged in as e2e-author (no Organization)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Fill `/add/event` (name, 2026-11-07 18:00–21:00, description), no banner | Form accepts | Accepted | ✅ |
| 2 | Click "Zapisz wydarzenie" | Navigate to `/<author_slug>/event/<id>` + saved toast | `/k-ac16defb20c2/event/64292a46-…`, toast "Wydarzenie „E2E Piknik wymiany 135502” zapisane" | ✅ |
| 3 | Inspect `history.state` | Router state cleared | `usr: null` | ✅ |
| 4 | Page order | back, eyebrow "Wydarzenie", h1, when-card, description, chat, list, author card | Matches; no header chip (organization null, L6) | ✅ |
| 5 | Author card | "Twoje wydarzenie" + copy, "✏️ Edytuj" → `/events/:id/edit`, "Usuń" enabled when 0 attendees | Matches | ✅ |
| 6 | Footer / empty copy | No footer; neutral "Nikt jeszcze się nie zapisał." with no nudge | Matches | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-create-event-form.png`, `screenshots/02-author-view-saved-toast.png`, `screenshots/02b-author-view-top.png`
- **Acceptance criteria checklist**:
  - [x] Post-create navigation to slug URL with toast
  - [x] Author card, chat row, no footer
  - [x] Organizer row first, neutral empty copy

### 4.2 Anonymous visitor view and copy link — ✅ Passed
- **User story / acceptance criterion**: Anonymous story; screen:event-anonymous, screen:event-empty; component:event-when-card
- **Preconditions**: Fresh browser context, no token

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open event URL | when-card, description, list; no chat row | Matches; chat row absent | ✅ |
| 2 | Empty copy | Includes the sign-up nudge | "Nikt jeszcze się nie zapisał. Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany." | ✅ |
| 3 | Footer | "＋ Zapisz się na wydarzenie" (M3) | Present and clickable (elementFromPoint hit check) | ✅ |
| 4 | Click "Kopiuj link" | Toast "Skopiowano link", URL in clipboard | Toast shown; clipboard = event URL | ✅ |
| 5 | After location added: "Miejsce" block | Name, address, notes, "Otwórz w Google Maps ↗" + sr-only "(nowa karta)" | Matches; `target=_blank` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-anonymous-view-top.png`, `screenshots/26-anon-footer-empty.png`, `screenshots/04-anonymous-copy-link-toast.png`, `screenshots/27-merged-attendee-view-with-place.png`
- **Acceptance criteria checklist**:
  - [x] Section order and anonymous footer
  - [x] Empty copy with nudge, no chat row
  - [x] Copy link toast

### 4.3 Guest sign-up and account merge — ⚠️ Passed with issues
- **User story / acceptance criterion**: Guest stories; screen:event-guest-signup, screen:event-guest-merge
- **Preconditions**: Anonymous context from 4.2

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click footer | ModalSheet "Zapisz się na wydarzenie", subtitle "{name} · {ddd D MMMM, HH:mm}", hint, "Masz konto? Zaloguj się" with returnTo | "E2E Piknik wymiany 135502 · sob. 7 listopada, 18:00"; login href `/login?returnTo=%2Fk-ac16defb20c2%2Fevent%2F…` | ✅ |
| 2 | Submit blank | Inline `role="alert"` "Podaj swoje imię." | Shown; input `aria-invalid="true"`, `aria-describedby` = hint + error | ✅ |
| 3 | Enter "E2E Gość Ania" + Enter | Sheet closes, merge card, no footer, guest listed | Matches; key `guest_profile_id:event:<id>` written; card "Zapisano Cię jako gościa ✓" + hint | ✅ |
| 4 | Fill email/password, "Załóż konto" | Becomes logged-in attendee | Attendee view: chat row, "To Ty", "Wypisz się" | ✅ |
| 5 | Merge card visuals | Mockup: title, hint, divider, fields | Divider rendered above the title with an empty band (see §5.4) | ⚠️ |

- **Issues observed**: §5.4 Cosmetic-1
- **Evidence**: `screenshots/05-guest-signup-sheet.png`, `screenshots/06-guest-signup-blank-error.png`, `screenshots/07-guest-merge-card.png`, `screenshots/07b-guest-merge-card-full.png`, `screenshots/08-guest-after-merge.png`
- **Acceptance criteria checklist**:
  - [x] Blank-name inline error
  - [x] Guest listed, merge card, no footer
  - [x] Merge to account works end-to-end

### 4.4 Logged-in participant: sign-up, chat, inbox, withdraw — ✅ Passed
- **User story / acceptance criterion**: Logged-in story; screen:event-participant; Req 3, 6, 13
- **Preconditions**: Logged in as e2e-participant, not attending

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "＋ Zapisz się na wydarzenie" | One-click sign-up, toast "Zapisano na wydarzenie" | `POST …/attendances` then refetch; toast shown | ✅ |
| 2 | Page state | "To Ty" pill, "Wypisz się" footer, chat row | Matches | ✅ |
| 3 | Click "💬 Czat wydarzenia" | Messages thread, header "· czat wydarzenia" | `/messages/ea0c964f-…`, "E2E Piknik wymiany 135502 · czat wydarzenia", "3 uczestników" | ✅ |
| 4 | Send message; open `/messages` | "Wydarzenie" chip | 🎉 + "Wydarzenie" chip + last message | ✅ |
| 5 | Click "Wypisz się" | Confirm dialog with spec copy | alertdialog "Wypisać się z wydarzenia?" / "Znikniesz z listy zapisanych i stracisz dostęp do czatu wydarzenia." / Anuluj / Wypisz się; no request yet | ✅ |
| 6 | Confirm | Toast "Wypisano z wydarzenia", back to sign-up footer | `POST …/attendances/withdraw` + refetch; toast shown | ✅ |
| 7 | Reopen thread / inbox | Access lost | Thread: "Nie masz dostępu do tej rozmowy."; inbox empty | ✅ |

- **Issues observed**: §5.3 Minor-3 (unreproduced first-attempt anomaly)
- **Evidence**: `screenshots/09-participant-before-signup.png`, `screenshots/10-participant-signed-up-toast.png`, `screenshots/10b-participant-view-full.png`, `screenshots/11-participant-event-thread.png`, `screenshots/11b-participant-thread-message.png`, `screenshots/12-participant-inbox-event-chip.png`, `screenshots/15-withdraw-confirm-dialog.png`, `screenshots/16-withdrawn-toast.png`, `screenshots/17-withdrawn-thread-no-access.png`, `screenshots/18-withdrawn-inbox-empty.png`
- **Acceptance criteria checklist**:
  - [x] One-click sign-up + toast + "To Ty"
  - [x] Chat thread header and inbox chip
  - [x] Withdraw confirm, toast, access revoked

### 4.5 Author with attendees: delete blocked — ✅ Passed
- **User story / acceptance criterion**: screen:event-author (aria-disabled + count hint)
- **Preconditions**: Author context; 2 attendees, then 1 attendee

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Reload with 2 attendees | `aria-disabled` + plural hint | `aria-disabled="true"`, `aria-describedby="event-delete-hint"`: "Nie można usunąć — zapisały się już 2 osoby." | ✅ |
| 2 | Force-click "Usuń" | No dialog opens | No dialog | ✅ |
| 3 | Reload with 1 attendee | "zapisała się już 1 osoba." | "Nie można usunąć — zapisała się już 1 osoba." | ✅ |
| 4 | Author inbox | EVENT thread with unread | "Wydarzenie" chip, "1 nieprzeczytane", nav badge "(1 nieprzeczytane)" | ✅ |

- **Issues observed**: _None observed._ (The 5+ form "zapisało się już N osób" was not exercised.)
- **Evidence**: `screenshots/13-author-delete-blocked-2.png`, `screenshots/19-author-delete-blocked-1.png`, `screenshots/20-author-inbox-event.png`
- **Acceptance criteria checklist**:
  - [x] Delete blocked while attendees exist
  - [x] Correct plural for 1 and 2

### 4.6 Spotkania "Biorę udział" — ✅ Passed
- **User story / acceptance criterion**: Participant story; Req 12; L8 empty copy
- **Preconditions**: Participant signed up

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `/meetings` → "Biorę udział" | Event listed, linking to slug URL, no pencil | "Wydarzenie / E2E Piknik wymiany 135502", href `/k-ac16defb20c2/event/64292a46-…`, no edit link | ✅ |
| 2 | After withdraw | Empty copy "Nie masz jeszcze żadnych zapisów." | Matches | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-meetings-attending-event.png`
- **Acceptance criteria checklist**:
  - [x] Attended event listed with slug link
  - [x] Neutral empty copy

### 4.7 Ended event — ✅ Passed
- **User story / acceptance criterion**: screen:event-ended; Req 2 (409 after end, 409 for author)
- **Preconditions**: Event starting in the current minute with no end (`87427a32-…`)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Logged-in non-author opens page | Disabled "Wydarzenie się zakończyło" | `disabled=true` button | ✅ |
| 2 | Anonymous opens page | Same; no sign-up button; no nudge | Matches | ✅ |
| 3 | Author opens page | Author card, no footer | Matches | ✅ |
| 4 | API sign-up after end | 409 "Wydarzenie się zakończyło." | 409 | ✅ |
| 5 | API author sign-up (future event) | 409 "Organizator nie zapisuje się na własne wydarzenie." | 409 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/21-ended-event-logged-in.png`, `screenshots/22-ended-event-anonymous.png`
- **Acceptance criteria checklist**:
  - [x] Ended footer for every non-author
  - [x] 409 after end and for author

### 4.8 Old route removed, edit route kept — ⚠️ Passed with issues
- **User story / acceptance criterion**: Req 10; Success Criteria "`/events/<id>` no longer matches a page route"
- **Preconditions**: Author context

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/events/<id>` | No event page | React Router default "Unexpected Application Error! 404 Not Found" (accepted risk, spec §Open Questions) | ⚠️ |
| 2 | Open `/events/<id>/edit` | Edit form loads, back link uses slug | Form prefilled; back link `/k-ac16defb20c2/event/64292a46-…` | ✅ |

- **Issues observed**: §5.3 Minor-1
- **Evidence**: `screenshots/23-old-route-events-id.png`, `screenshots/24-edit-route-still-works.png`
- **Acceptance criteria checklist**:
  - [x] Old page route gone
  - [x] Edit route works

### 4.9 Backslash in event name — ✅ Passed
- **User story / acceptance criterion**: Regression check for OG route with `\` in name
- **Preconditions**: Event "E2E Swap \o/ 135502" (`ea4c69ad-…`), description "Backslash \ test"

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Direct load + reload on :5173 | Page renders | 200, h1 "E2E Swap \o/ 135502" | ✅ |
| 2 | Direct load on backend :8080 (OG route) | 200 HTML shell, no 500 | 200, `<title>E2E Swap \o/ 135502</title>` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/25-backslash-event-refresh.png`
- **Acceptance criteria checklist**:
  - [x] No 500 on direct load/refresh

### 4.10 OG preview — ✅ Passed
- **User story / acceptance criterion**: Req 7; L10
- **Preconditions**: Raw HTTP via curl to :8080

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | GET `/k-ac16defb20c2/event/64292a46-…` | title/og:title = name; og:description = when · place + description | `<title>`/og:title "E2E Piknik wymiany 135502"; og:description "sob 07.11 o 18:00 · E2E Park testowy Wymiana ubranek i zabawek.\nPrzynieś coś od siebie." | ✅ |
| 2 | GET with invalid UUID | Plain index | 200, `<title>aj</title>` | ✅ |
| 3 | GET `/api/event/<uuid>` (reserved) | Real 404 JSON | 404 JSON | ✅ |
| 4 | `og:image` | Banner w1600 URL | Not verifiable (no banner, storage disabled) | ✅ |
| 5 | GET `/api/events/<id>` anonymous / garbage token | 200, never 401 | 200 / 200 | ✅ |

- **Issues observed**: §5.3 Minor-2 (raw newline in og:description)
- **Evidence**: inline curl output (no screenshot; raw HTML)
- **Acceptance criteria checklist**:
  - [x] Title and description meta
  - [ ] og:image (not verifiable locally)

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor

**Minor-1: Old `/events/<id>` shows React Router's developer error page**
- **Spec requirement**: Req 10 / Open Questions: "Old `/events/<id>` links will show React Router's default error page" (accepted).
- **Expected**: No event page at the old route.
- **Actual**: "Unexpected Application Error! 404 Not Found 💿 Hey developer 👋 …" plus console errors from React Router's default ErrorBoundary.
- **Evidence**: `screenshots/23-old-route-events-id.png`
- **Root cause hypothesis**: No catch-all / `errorElement` in `router.tsx` (out of scope by design).
- **User impact**: Old shared links land on a developer-facing English error page.
- **Recommended fix**: Follow-up: add an app-level `errorElement`/404 page (out of scope here).
- **Workaround**: Reshare the new slug URL.

**Minor-2: og:description keeps a raw newline from the description**
- **Spec requirement**: OG preview: description = `format_term_when` + ` · place` + ` {description}`.
- **Expected**: A single-line preview text (implied).
- **Actual**: `content="sob 07.11 o 18:00 · E2E Park testowy Wymiana ubranek i zabawek.⏎Przynieś coś od siebie."`. It is valid HTML, and most scrapers collapse whitespace.
- **Evidence**: curl output in §4.10
- **Root cause hypothesis**: `render_public_event_meta` does not collapse whitespace in the description.
- **User impact**: Negligible; possible odd line break in some link previews.
- **Recommended fix**: Optionally collapse whitespace (`" ".join(desc.split())`) in the OG text.
- **Workaround**: None needed.

**Minor-3: Unreproduced withdraw on the first attempt without an observed confirm click**
- **Spec requirement**: screen:event-participant: "Wypisz się" opens a confirm dialog, then withdraws.
- **Expected**: Withdraw only after confirming.
- **Actual**: On the first attempt, a harness script clicked the footer and then waited 30 s for `role=dialog` (the real role is `alertdialog`) and timed out. Afterwards the participant was withdrawn (API `is_attending=false`). A controlled re-run logged network calls: the footer click opened the alertdialog and sent no request, and the withdraw POST was sent only after clicking confirm.
- **Evidence**: `screenshots/15-withdraw-confirm-dialog.png`, `screenshots/16-withdrawn-toast.png`
- **Root cause hypothesis**: Most likely a Playwright MCP harness artefact around the timed-out locator. Not reproducible.
- **User impact**: None confirmed.
- **Recommended fix**: None. Optionally a manual spot-check of the dialog's keyboard handling (Enter on focused Cancel).
- **Workaround**: n/a

### 5.4 Cosmetic

**Cosmetic-1: Merge card divider sits above the title**
- **Spec requirement**: screen:event-guest-merge (mockup `guest-signed-up-merge-card.html`): card with title, hint, divider, then email/password and "Załóż konto".
- **Expected**: Title at the top of the card; divider between hint and fields.
- **Actual**: The card starts with an empty band and a horizontal rule, then title, hint and fields. `AccountMergeForm` appears to keep its Term top-border/padding inside `EventGuestMergeCard`'s own `CARD`.
- **Evidence**: `screenshots/07b-guest-merge-card-full.png` vs `screenshots/mock-guest-signed-up-merge-card.png`
- **Root cause hypothesis**: `AccountMergeForm` root styling (`border-t pt-…`), designed for use below Term content, is nested inside another card.
- **User impact**: Slightly unpolished card; no functional impact.
- **Recommended fix**: Let `EventGuestMergeCard` drop or override the form's top border, or render the form without its outer wrapper.
- **Workaround**: n/a

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `/api/organizations/mine` | 404 Not Found | On every authenticated app load (author without an Organization) | Minor | Pre-existing app-shell probe; unrelated to this feature |
| react-router-dom (default ErrorBoundary) | "No routes matched location /events/<id>" + "Error handled by React Router default ErrorBoundary" | Only on the old route | Minor | Expected per spec (see Minor-1) |
| `http://localhost:8080/favicon.ico` | 404 | Once, when opening the backend OG route directly | Cosmetic | Dev-only; backend does not serve the favicon |

No console errors were observed on any event page view, sheet, thread, inbox or Spotkania screen.

## 7. Spec Alignment
- **Fully implemented**: public detail without 401 (also with a garbage token); logged-in and guest sign-up; blank-name validation; 409 after end and for the author; idempotent withdraw with confirm; `author_slug` URLs everywhere observed (create navigation, Spotkania, edit back link, copy link); EVENT chat (open, header, inbox chip, unread count, revoked on withdraw); OG title/description and reserved-slug guard; `/:slug/event/:id` route; `/events/:id` removed; `/events/:id/edit` kept; Spotkania "Biorę udział"; post-create toast via router state, cleared afterwards; gender-neutral copy; "Miejsce" block with Maps link.
- **Partially implemented**: _None observed._ (Items, banner, `og:image` and the org chip are unverified, not known to be missing.)
- **Not implemented**: _None observed._
- **Extra (unspecified) behavior**: The event page renders inside the app shell (search bar, bottom nav) for all viewers, including anonymous. The mockups show a bare page. Likely the existing layout, consistent with Term pages.

## 8. Variances from Plan
- The banner was skipped (upload disabled locally without storage keys), so the banner render and `og:image` were not verified.
- Test users had no inventory items with listing preferences, so item rows, thumbnails, mode labels, product links and "Pokaż wszystkie/Zwiń" were not verified.
- The author had no Organization, so the header chip and organizer theme were not verified. The absence of the chip for `organization === null` (L6) was verified.
- The ended event was created starting in the current minute via API rather than with a past date (past dates are rejected by create and PATCH). "Attendee + ended" (withdraw hidden for an attendee) was not reachable, because sign-up after the end is blocked.
- The plural "zapisało się już N osób" (5+) was not exercised; 1 and 2 were verified.
- Text moderation accepted all test names (no environment blocking observed).

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| `/<slug>/event/<id>` renders all 7 binding screens with their copy and order. `/events/<id>` no longer matches a page route. | ✅ | §4.1–4.8; screenshots 02b, 03, 05, 07, 10, 21, 26; 23 |
| Guest sign-up, merge to an account, logged-in sign-up and withdraw all work end-to-end. Sign-up after the end returns 409, and the author can't sign up. | ✅ | §4.3, §4.4, §4.7 |
| The detail endpoint's query count is independent of how many participants and items there are | ✅ | Not E2E-observable; covered by backend `count_queries` tests (out of scope for this run) |
| The EVENT chat opens for the author and active attendees only, appears in the inbox and unread count; deleting an event removes its conversation | ✅ | §4.4, §4.5 (delete cascade not exercised in UI: delete is blocked while attendees exist) |
| Migration 0071 upgrades and downgrades cleanly | ✅ | Not E2E-observable; local DB at head 0072 and app works |
| Every `EventResponse` carries `author_slug`, and every event link in the app uses the slug URL | ✅ | Create/patch API responses include `author_slug`; Spotkania and edit links use slug |
| Shared links produce an OG preview with title, date and banner | ⚠️ | Title + date verified; banner not verifiable locally |
| Attended events appear in Spotkania → "Biorę udział" | ✅ | §4.6 |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: Cosmetic-1 (merge-card divider placement).
- **Nice-to-have**: Minor-2 (collapse whitespace in og:description); Minor-1 (app-level `errorElement` follow-up); Minor-3 (optional manual spot-check of the withdraw dialog). A manual check of item rows/banner/org chip on a seeded account before release.

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (41 files: 34 runtime captures + 7 rendered mockups `mock-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: **GO WITH CAVEATS**. Every specified flow that could be exercised locally behaved as the spec describes, with no Critical or Major findings and no console errors on the feature's screens. The caveats are the unverified data-dependent surfaces (items, banner, org chip, `og:image`) and one cosmetic card-styling deviation. Recommendation: merge, optionally after fixing the merge-card divider, and spot-check items/banner on a seeded account.
