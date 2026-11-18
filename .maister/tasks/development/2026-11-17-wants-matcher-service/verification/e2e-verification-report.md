# E2E Verification Report

## TL;DR
Verdict: **GO WITH CAVEATS**. All 7 scenarios ran in a real browser at phone width (390×844) against the rebuilt compose stack on :5174, and all 7 passed. The pending state, slow state, „Odśwież teraz” resume, suggestions section, list badge, window bell and the stop-words 400 message all behave as FR-FE-01..06 and AC-02/03/04/08 describe. No Critical or Major issues were found. The caveats are one Minor observation (a window-born pair after a matcher restart rings the bell and shows „1 nowa” for an item the seeker has already seen) and pre-existing Cosmetic noise (a 404 from `/api/organizations/mine` in the console on every page).

## Key Decisions
- Test data (B's listings) was seeded through the public API (`/api/inventories`, `/api/locations`, `/api/products/resolve`, `/api/inventory-items`, `/api/item-listing-preferences`), not through the item form. The item form is not in scope. All want flows ran through the UI.
- With a running matcher, matching finishes before the detail page renders (~0.3–0.6 s), so the pending state cannot be seen in normal use. I captured it reliably by stopping the matcher (scenario 5), which the brief allowed.

## Open Questions / Risks
- A pair stored by the window run right after a matcher restart is unseen and rings the bell, even when the seeker saw the same item in that mount (§5.3). This is spec-consistent (window pairs are unseen and belled, ON CONFLICT race). Product should confirm it is acceptable.
- The DB holds older data from other users (e.g. other „Rowerek biegowy …” and „Traktor Deutz-Fahr Bruder” listings), so match counts are higher than the two seeded listings alone.

## 1. Identifier
- **Task**: 2026-11-17-wants-matcher-service
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-17-wants-matcher-service
- **Spec**: implementation/spec.md (revision 3)
- **Date**: 2026-11-17
- **Git ref**: bc2a1d1 on feature/global-search-group-description (uncommitted working tree, images rebuilt with `docker compose up -d --build`)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (nginx → Next `web` + `backend`) |
| Browser | Playwright MCP Chromium |
| Viewport | 390×844 |
| Auth context | Seeker A `e2e-a-221623@example.com` (UI login); lister B `e2e-b-221623@example.com` (API) |
| Test data | Live dev DB at the amended 0099; B's listings seeded via the API in Kęty (GIFT) |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 7 |
| Scenarios executed | 7 |
| Passed | 7 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 1 |
| Cosmetic issues | 1 |

The matcher is fast: forward results were on screen 272–591 ms after saving. Suggestions show only for ≥3-word wants with exactly one missing word, inside a labelled section with dashed cards and „brakuje: „Claas””. They never ring the bell, including a suggestion stored by the window run („Traktor bruder Fendt”). A window MATCH rang WANT_MATCH_FOUND 60 s after the listing. With the matcher stopped, the detail page showed the pending row and skeletons, polled every 2 s, switched to the slow card at exactly 60 s, and „Odśwież teraz” restarted polling. After `docker compose start matcher` the result appeared 1.3 s later. The list page shows the „Szukamy…” badge, polls for 60 s, then keeps the badge as L4 specifies.

## 4. Verification Scenarios

### 4.1 Pending → matches on create („Rowerek biegowy”) — ⚠️ Passed with issues
- **User story / acceptance criterion**: User story 4, FR-FE-02, FR-FE-05, `screen:want-matching`, AC-02
- **Preconditions**: B has listed „Rowerek biegowy drewniany” and „Traktor bruder Deutz” (GIFT, Kęty). A is logged in. The matcher is running.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Fill „Rowerek biegowy” on /add/wanted, click „Zapisz poszukiwanie” | Navigates to /wanted/{id} | Navigated to /wanted/7a0818e6-… | ✅ |
| 2 | Poll the DOM every 25 ms for „Szukamy pasujących rzeczy…” | Pending row visible briefly | Never rendered: matching was done before the first render | ⚠️ |
| 3 | Wait for the matches | Matches incl. „Rowerek biegowy drewniany” | Visible at 591 ms; „4 pasujące rzeczy”, no „nowe” (forward pairs born seen) | ✅ |
| 4 | Check the bell | No bell for forward results | `/api/notifications/mine` = [] | ✅ |

- **Issues observed**: _None observed._ The pending state is too short to see with a running matcher. It was verified in 4.5.
- **Evidence**: `screenshots/02-want-matches.png`
- **Acceptance criteria checklist**:
  - [x] Save flags the want and the matcher stores results within seconds
  - [x] Forward results are born seen (no „nowe”, no bell)
  - [x] Pending row + skeleton observed (in 4.5, `screenshots/09-want-matching-pending.png`)

### 4.2 SUGGESTION tier, live („Traktor bruder Claas”) — ✅ Passed
- **User story / acceptance criterion**: User story 3, FR-MR-03, FR-FE-04/05, `screen:want-results`, `component:suggestion-card`, AC-03, AC-04
- **Preconditions**: B lists „Traktor bruder Deutz”.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Create „Traktor bruder Claas” in the UI | No MATCH; suggestions section | Empty card „Jeszcze nic nie pasuje” + „Może Cię zainteresuje” at 272 ms | ✅ |
| 2 | Inspect the section | `<section aria-labelledby>` with an h2, emoji `aria-hidden`, lead text | `aria-labelledby` → H2 „💡 Może Cię zainteresuje”; 💡 is `aria-hidden`; lead copy matches | ✅ |
| 3 | Inspect the cards | Dashed tile, no „nowe”, „brakuje: „Claas”” | ARTICLE tiles have a dashed border; „brakuje: „Claas”” on „Traktor bruder Deutz” and „Traktor Deutz-Fahr Bruder”; links to the product pages | ✅ |
| 4 | B lists „Traktor bruder Fendt”; wait for the window run | Suggestion stored by the window; no bell | Fendt appears in the section (3 cards); the bell holds only the Rowerek MATCH (4.6) | ✅ |
| 5 | List page card for this want | Counts are MATCH-only | „Jeszcze nic · powiadomimy Cię” (suggestions not counted) | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-want-suggestions.png`, `screenshots/07-claas-window-suggestion.png`
- **Acceptance criteria checklist**:
  - [x] Suggestion with one missing word shown with the missing word quoted
  - [x] Suggestions never produce a bell (forward or window)
  - [x] Counts are MATCH-only

### 4.3 Matches only, no suggestions section — ✅ Passed
- **User story / acceptance criterion**: FR-FE-05, `screen:want-results-matches-only`
- **Preconditions**: B lists „Hulajnoga trójkołowa niebieska”. The matcher is running.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Create the 3-word want „Hulajnoga trójkołowa niebieska” | One MATCH, no suggestions | „1 pasująca rzecz”, no „Może Cię zainteresuje” in the DOM | ✅ |
| 2 | Check the 2-word want „Rowerek biegowy” (4.1) | Count line + MatchCards, no section | „4/5 pasujących rzeczy”, no section | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/15-matches-only.png`, `screenshots/08-rowerek-window-match-nowe.png`
- **Acceptance criteria checklist**:
  - [x] The section does not render when there are no suggestions

### 4.4 List page „Szukamy…” badge — ✅ Passed
- **User story / acceptance criterion**: User story 5, FR-FE-03, FR-FE-06, `screen:wanted-list`
- **Preconditions**: Matcher stopped; „Hulajnoga trójkołowa” created and still `matching`.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open /wanted | The matching card shows the spinner + „Szukamy…” in `role="status"` instead of the counts | `<p role="status">` with an `aria-hidden` spinner (`motion-reduce:animate-none`) + „Szukamy…”; other cards unchanged | ✅ |
| 2 | Stay 68 s and record GET /api/wants | Polls every 2 s, stops at ~60 s | 25 requests, every 2 s, the last 60 s after the list loaded | ✅ |
| 3 | After the window | No slow state on the list; the badge stays | „Szukamy…” still shown | ✅ |
| 4 | Revisit after the matcher result | Counts replace the badge | „1 nowa · 1 pasująca rzecz” | ✅ |

- **Issues observed**: _None observed._ (The badge is transient with a running matcher. It was captured by stopping the matcher.)
- **Evidence**: `screenshots/10-wanted-list-badge.png`, `screenshots/11-wanted-list-after-window.png`, `screenshots/16-wanted-list-final.png`
- **Acceptance criteria checklist**:
  - [x] The badge replaces the counts while matching
  - [x] Same 2 s / 60 s polling; the card keeps „Szukamy…” after the window

### 4.5 Pending → slow → „Odśwież teraz” → result — ✅ Passed
- **User story / acceptance criterion**: User story 4, FR-FE-02, FR-FE-04/05, `screen:want-matching`, `screen:want-matching-slow`, `component:matching-status`, AC-07 (DB/service restart), AC-08
- **Preconditions**: `docker compose stop matcher` at 22:20:24. B has listed „Hulajnoga trójkołowa niebieska”.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Create „Hulajnoga trójkołowa” | Pending row `role=status aria-live=polite`, spinner `aria-hidden`, 4 skeleton tiles `aria-hidden`; header, toggle, validity, actions unchanged | Exactly that: „Szukamy pasujących rzeczy… / To zwykle kilka sekund.”, the grid is `aria-hidden`, 4 tiles | ✅ |
| 2 | Reopen the detail and record GET /api/wants/{id} | Polls every 2 s for 60 s | 31 requests at 2 s steps, from 0 s to 60 s | ✅ |
| 3 | Wait for the window end | Slow card at ~60 s, polling stops | „Wyniki pojawią się wkrótce” at 60 s; dashed card `role=status aria-live=polite`, ⏳ `aria-hidden`, copy matches; no skeleton | ✅ |
| 4 | Click „Odśwież teraz” (matcher still stopped) | Back to pending; polling restarts | Pending row back, slow card gone; requests at 0 / 2.1 / 4.1 / 6.1 s | ✅ |
| 5 | `docker compose start matcher` | Result appears while polling | Match „Hulajnoga trójkołowa niebieska” rendered 1.3 s after the start; logs: „database contract ready”, „listening” | ✅ |

- **Issues observed**: §5.3 (the window-born pair after the restart rang a bell and is „nowe” on the next list visit)
- **Evidence**: `screenshots/09-want-matching-pending.png`, `screenshots/12-want-matching-slow.png`, `screenshots/13-after-refresh-click.png`, `screenshots/14-after-matcher-restart-result.png`
- **Acceptance criteria checklist**:
  - [x] Polling stops at ~60 s with the slow card
  - [x] „Odśwież teraz” resumes polling
  - [x] A flagged want is picked up after the matcher restarts

### 4.6 Window bell for a new listing — ✅ Passed
- **User story / acceptance criterion**: User story 6, AC-03, FR-MT-05
- **Preconditions**: A's want „Rowerek biegowy” exists. B lists „Rowerek biegowy czerwony” (MATCH) and „Traktor bruder Fendt” (suggestion only for „Traktor bruder Claas”) at 22:17:57.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Poll A's notifications | WANT_MATCH_FOUND within ~2 min | Created 21:18:57 UTC (60 s after listing); window log `matches=2 suggestions=1 outbox_rows=1` | ✅ |
| 2 | Open the bell in the UI | Badge „1”, message names the want and the item | „Szukasz: «Rowerek biegowy». Ktoś wystawił: «Rowerek biegowy czerwony».” | ✅ |
| 3 | Check for a suggestion bell | None for Fendt | Only the one Rowerek bell | ✅ |
| 4 | Open the want detail | The new pair marked „nowe” | „nowe” on „Rowerek biegowy czerwony”, „5 pasujących rzeczy” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-bell-want-match.png`, `screenshots/08-rowerek-window-match-nowe.png`
- **Acceptance criteria checklist**:
  - [x] A window MATCH produces a WANT_MATCH_FOUND bell
  - [x] A window suggestion produces no bell

### 4.7 Stop-words-only name — ✅ Passed
- **User story / acceptance criterion**: User story 2, FR-FE-01, AC-02, Key Decision M3
- **Preconditions**: A on /add/wanted.

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Submit „na dla” | POST /api/wants → 400 | 400, message „Wpisz, czego szukasz — nazwa nie może składać się z samych spójników i przyimków.” | ✅ |
| 2 | Read the form error | The server message verbatim in `role="alert"` | Same text in the alert; the form stays on /add/wanted with the value kept | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-stopwords-400.png`
- **Acceptance criteria checklist**:
  - [x] Stop-words-only name rejected with 400
  - [x] Message shown through `extractProblemMessage` without a client copy

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
- **Spec requirement**: Key Decisions: „Forward runs are born seen with no bell; window runs are unseen and belled”; FR-FE-05 / L4 (later pairs marked „nowe” on the next visit)
- **Expected**: The seeker gets a bell only for items they have not already seen
- **Actual**: „Hulajnoga trójkołowa niebieska” was listed at 22:20:23, one second before the matcher stopped, so no window run had covered it. On restart (22:23:29) the window run inserted the pair first (`matches=1 outbox_rows=1`), and the seeker's open page showed it 1.3 s later. 30 s later a WANT_MATCH_FOUND bell arrived for that same item, and the list showed „1 nowa”.
- **Evidence**: `screenshots/14-after-matcher-restart-result.png`, `screenshots/16-wanted-list-final.png`
- **Root cause hypothesis**: After a restart the window run (catch-up of `(marker − overlap, now]`) runs before the request claim. ON CONFLICT DO NOTHING gives the pair to whichever path inserts first. This is by design.
- **User impact**: A redundant bell and „nowe” marker for an item already on screen. Only around matcher downtime or a listing racing a want edit.
- **Recommended fix**: Accept (spec-consistent), or have the request claim run before the first window after start-up. Product decision.
- **Workaround**: None needed. The bell is correct and links to the item.

### 5.4 Cosmetic
- **Spec requirement**: Not in this spec (general console hygiene)
- **Expected**: No console errors on the wants pages
- **Actual**: Every page load logs `404 /api/organizations/mine` (the user has no organization). The bad navigation to /notifications also logged `404 /api/public/organizations/notifications` (tester's wrong URL, not a product path).
- **Evidence**: Console logs in §6
- **Root cause hypothesis**: A pre-existing shell query for the user's organization treats „none” as a 404
- **User impact**: None visible
- **Recommended fix**: Out of scope for this task. Optionally return an empty result instead of 404 in a later task.
- **Workaround**: Ignore

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| http://localhost:5174/api/organizations/mine | 404 Not Found | Every page load | Cosmetic | None (pre-existing, unrelated) |
| http://localhost:5174/api/wants (POST) | 400 Bad Request | Once (scenario 4.7) | — | Expected: the stop-words rejection under test |
| http://localhost:5174/api/public/organizations/notifications | 404 Not Found | Once | — | Tester navigated to a non-existent /notifications route |

Backend logs from the last 15 min: no tracebacks, no 500s. Matcher logs: no warnings or errors; a clean SIGTERM stop and a restart with „database contract ready (attempt 1)” → „listening”.

## 7. Spec Alignment
- **Fully implemented**: FR-FE-01 (`matching`, suggestions API, server 400 shown verbatim); FR-FE-02 (2 s polling, 60 s window, timer-driven `slow`, refetch restarts the window); FR-FE-03 (list polling 2 s / 60 s, badge kept after the window); FR-FE-04 (`matching` / `matchingSlow` take precedence; suggestions under the empty card); FR-FE-05 (all five screens + MatchingStatus + SuggestionCard); FR-FE-06 (list badge); AC-02 (fast matching, 400 on stop-words), AC-03 (window bell, no suggestion bells), AC-04 (MATCH-only counts, `missing_words`), AC-08 (slow card + resume)
- **Partially implemented**: _None._
- **Not implemented**: _None._ (FR-FE-07 fixtures/tests are not observable in a browser and are out of scope here.)
- **Extra (unspecified) behavior**: _None observed._

## 8. Variances from Plan
- B's listings were seeded through the REST API (inventory, place in Kęty, product resolve, item, GIFT listing preference) instead of the item UI, to keep the run focused on the wants UI.
- The pending state in scenario 4.1 could not be seen with a running matcher (results in ≤0.6 s). Scenario 4.5 covered it with the matcher stopped, as the brief allowed.
- The list badge (4.4) was captured during the matcher stop of 4.5, not as a separate run.
- The matcher was stopped from 22:20:24 to 22:23:29 and is running again.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| AC-02 POST returns `matching: true`; the matcher stores results within seconds; stop-words-only name rejected with 400 | ✅ | 4.1 (591 ms), 4.2 (272 ms), 4.7 |
| AC-03 Forward results born seen with no bell; window MATCH rings WANT_MATCH_FOUND; suggestions never ring | ✅ | 4.1 step 4, 4.6 |
| AC-04 `/matches` and counts are MATCH-only; suggestions carry `missing_words` | ✅ | 4.2 steps 3 and 5 |
| AC-07 (runtime part) The service waits for the contract and resumes after a restart | ✅ | 4.5 step 5, matcher logs |
| AC-08 Frontend renders the five mockup screens and two components; polling stops at ~60 s with the slow card; „Odśwież teraz” resumes | ✅ | 4.3–4.5, `visual-fidelity.md` |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: Decide on §5.3 (bell for a window pair already shown by a forward refresh after a matcher restart).
- **Nice-to-have**: §5.4 (the 404 console noise from `/api/organizations/mine`, outside this task).

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (19 files: 14 app captures + 5 mockup renders `mockup-*.png`)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ⚠️ GO WITH CAVEATS. Every frontend requirement and runtime acceptance criterion under test held in the live stack, including the pending, slow and resume cycle across a real matcher stop and start. The only findings are a spec-consistent Minor edge case around matcher restarts and pre-existing Cosmetic console noise. Recommendation: merge (subject to the release gate in the spec), and record a product decision on §5.3.
