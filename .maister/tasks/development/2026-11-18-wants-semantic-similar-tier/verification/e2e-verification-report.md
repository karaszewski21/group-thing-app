# E2E Verification Report

## TL;DR
**GO.** 9 of 9 planned scenarios executed in a live browser on an isolated throwaway stack, and all 9 passed.
„Powiązane rzeczy” renders in the right place in `active`, `activeEmpty`, `matching` and `matchingSlow`, and is absent for a want without SIMILAR rows and for a FULFILLED want.
Related cards are dashed and show no „brakuje:” and no „nowe”. A click opens the item page and POSTs `…/opened` (204). Match counts stay MATCH-only.
`GET /api/wants/{id}/similar` returns exactly the six card fields, with no score or vector, and returns 404 for another user. No Critical, Major, Minor or Cosmetic discrepancies.

## Open Questions / Risks
- Reserved-card captions („Zarezerwowane przez Ciebie”, „Twoja propozycja”, „Zarezerwowane”) and the dimmed reserved tile were not exercised live, because no reservations were seeded (optional in the brief). The unit tests cover them.
- `GET /api/wants/{id}/similar` still returns rows for a FULFILLED want. Only the UI hides them. The spec does not ask the API to hide them; noted under §7 "Extra behavior".

## 1. Identifier
- **Task**: 2026-11-18-wants-semantic-similar-tier
- **Task path**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-18-wants-semantic-similar-tier
- **Spec**: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-11-18-wants-semantic-similar-tier\implementation\spec.md
- **Date**: 2026-11-18
- **Git ref**: 90b4834 on feature/global-search-group-description (uncommitted working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:15173 (isolated `next dev --webpack`, `BACKEND_INTERNAL_URL=http://localhost:18080`) |
| Browser | Playwright MCP, Chromium |
| Viewport | 1280×900 (desktop) and 390×844 (mobile) |
| Auth context | seeker `seeker.e2e@example.com` (GUEST role) logged in through `/login`; a second user and anonymous for the 404/401 checks |
| Test data | seeded: users, places, products, items and wants through the API; `want_matches` rows and `match_requested_at` through SQL in the throwaway DB |

Stack details:
- **DB**: container `e2e-similar-pg` (`pgvector/pgvector:0.8.7-pg18-trixie`) on :55432 with a random throwaway password (not recorded). `alembic upgrade head` reached 0101.
- **Backend**: uvicorn on 127.0.0.1:18080 with `EMBEDDINGS_ENABLED=false`, `MODERATION_TEXT_ENABLED=false` and `MODERATION_IMAGE_ENABLED=false`. It ran from a scratchpad working directory so that `src/backend/.env` (Spaces settings) was not loaded.
- **Frontend**: a copy of `src/frontend` (src, public and config files) in the scratchpad, with a junction to the real `node_modules`. Turbopack refused the junction ("Could not find the Next.js package"), so the copy ran with `next dev --webpack -p 15173`.
- The user's :5173 (PID 26000), :8080 (PID 20120), container `group-thing-app-postgres-1` and `.env` were not touched.

## 3. Executive Summary
**Verdict**: ✅ GO

| Metric | Count |
|---|---|
| Scenarios planned | 9 |
| Scenarios executed | 9 |
| Passed | 9 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 0 |
| Cosmetic issues | 0 |

The SIMILAR tier's UI and read API behave as specified in R16, R17 and R19–R21 and the Visual Design table. In the active state the order is match grid → „Może Cię zainteresuje” → „Powiązane rzeczy” → actions. In `activeEmpty` the EmptyCard stays and the section follows it. In `matching` and `matchingSlow` the section follows the status and skeletons. Related cards reuse ItemCard with a dashed border and no footnote or marker, and opening one records `opened_at` on the SIMILAR row. SIMILAR rows count toward nothing: the `/wanted` list shows „1 pasująca rzecz” for the want with 1 MATCH + 1 SUGGESTION + 3 SIMILAR, and „Jeszcze nic” for the SIMILAR-only want. The only console errors are a pre-existing, unrelated `GET /api/organizations/mine` 404 for a user without an organization.

## 4. Verification Scenarios

### 4.1 Active want with MATCH, SUGGESTION and SIMILAR — ✅ Passed
- **User story / acceptance criterion**: User story 1; R21; Visual Design `screen:want-detail-active-similar`, `component:similar-section`, `component:similar-card`
- **Preconditions**: want „Samochód zabawka” ACTIVE, `match_requested_at` NULL; 1 MATCH („Samochód zabawka czerwony”), 1 SUGGESTION („Samochód zdalnie sterowany”, `missing_words={zabawka}`), 3 SIMILAR (scores 0.93/0.90/0.88, seen, `missing_words` NULL)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/wanted/{id}` at 1280×900 | page renders the active state | „1 pasująca rzecz” grid, the suggestions section, the related section and the actions | ✅ |
| 2 | Check DOM order (`compareDocumentPosition`) | match grid → „Może Cię zainteresuje” → „Powiązane rzeczy” → „Ważne jeszcze…” | `matchBeforeSug`, `sugBeforeSim` and `simBeforeActions` all true | ✅ |
| 3 | Check the section markup | classes as SuggestionsSection; 🔗 heading; lead text; `grid-cols-2 gap-3 sm:grid-cols-3` | `mt-5.5 border-t border-line pt-4`; h2 „🔗 Powiązane rzeczy”; lead „Rzeczy o podobnym znaczeniu — mogą Ci się przydać.”; ul `grid grid-cols-2 gap-3 sm:grid-cols-3` | ✅ |
| 4 | Check the related cards | dashed; no „brakuje:”; no „nowe”; order by score | 3 cards with computed `border-style: dashed`, no footnote, no marker; order mercedes → resorak → autko | ✅ |
| 5 | Compare with the MATCH card | MATCH card stays solid | MATCH card `border-line`, solid | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-active-desktop.png`, `screenshots/03-related-section-desktop.png`
- **Acceptance criteria checklist**:
  - [x] order MATCH → suggestions → related → actions
  - [x] 🔗 heading and lead copy as specified
  - [x] cards dashed, no footnote, never „nowe”
  - [x] best score first

### 4.2 activeEmpty with only SIMILAR rows — ✅ Passed
- **User story / acceptance criterion**: R20/R21; `screen:want-detail-empty-similar` („Related items never replace the empty state and never count as matches”); R17
- **Preconditions**: want „Wózek głęboki” ACTIVE with 2 SIMILAR rows only

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/wanted/{id}` | EmptyCard „Jeszcze nic nie pasuje” stays | EmptyCard present | ✅ |
| 2 | Check the order | section after EmptyCard, before actions | `emptyBeforeSim` true; h2 list ["Jeszcze nic nie pasuje", "🔗 Powiązane rzeczy"] | ✅ |
| 3 | Open `/wanted` | count 0 for this want; MATCH-only count for „Samochód zabawka” | „Wózek głęboki”: „Jeszcze nic · powiadomimy Cię”; „Samochód zabawka”: „1 pasująca rzecz” | ✅ |
| 4 | `GET /api/wants` | `match_count`/`new_match_count` exclude SIMILAR | Wózek 0/0, Samochód 1/0, Fotelik 0/0 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/05-active-empty-with-related-desktop.png`, `screenshots/11-active-empty-mobile.png`, `screenshots/06-wanted-list-counts.png`
- **Acceptance criteria checklist**:
  - [x] EmptyCard stays
  - [x] related section below it
  - [x] count stays 0 on detail and list

### 4.3 Clicking a related card opens the item and records the open — ✅ Passed
- **User story / acceptance criterion**: R21 („Opening a card calls `reportOpened` (→ `markOpened`)”); R17 (`mark_match_opened` accepts any tier)
- **Preconditions**: scenario 4.1 page open

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click „Resorak ciężarówka” in „Powiązane rzeczy” | item page opens | URL `/{owner}/product/11623322-…`, title „Resorak ciężarówka” | ✅ |
| 2 | Inspect network | `POST /api/wants/{id}/matches/{item}/opened` | `[POST] …/matches/11623322-…/opened => 204` | ✅ |
| 3 | Check the DB | `opened_at` set on the SIMILAR row | `tier=SIMILAR`, `opened_at IS NOT NULL` = true | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-related-card-opened-item-page.png`
- **Acceptance criteria checklist**:
  - [x] navigation to the item href
  - [x] opened POST sent and stored

### 4.4 Active want without SIMILAR rows — ✅ Passed
- **User story / acceptance criterion**: R21 („only when non-empty”)
- **Preconditions**: want „Hulajnoga” ACTIVE with 1 MATCH, no SIMILAR

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/wanted/{id}` | no „Powiązane rzeczy” | h2s: ["1 pasująca rzecz"]; 0 `section`s; text absent | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-active-no-similar.png`
- **Acceptance criteria checklist**:
  - [x] section absent when the list is empty

### 4.5 Closed (FULFILLED) want — ✅ Passed
- **User story / acceptance criterion**: User story 3; R20 (`similar` only on active kinds)
- **Preconditions**: want „Klocki LEGO” with 1 SIMILAR row, closed through `POST /api/wants/{id}/close {"outcome":"FULFILLED"}` (200)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/wanted/{id}` | closed view, no section | „Oznaczone jako znalezione dzisiaj…” + „Szukam znowu”; no related section | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/08-fulfilled-no-section.png`
- **Acceptance criteria checklist**:
  - [x] no section on a closed want

### 4.6 `GET /api/wants/{id}/similar` contract — ✅ Passed
- **User story / acceptance criterion**: R16, R18
- **Preconditions**: seeded data; requests sent through the Next rewrite at :15173

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | GET as the seeker for „Samochód zabawka” | list of `{id,title,href,meta,reserved_by_me,proposed_by_me}` | 3 cards, key set exactly those six; `meta` = `{mode,condition,thumb_url,reserved,reserved_until}` | ✅ |
| 2 | Search the body for `score`/`embedding`/`vector` | absent | absent | ✅ |
| 3 | Order | score desc | 0.93 → 0.90 → 0.88 | ✅ |
| 4 | GET as another user | 404 | 404 „Nie znaleziono poszukiwania.” | ✅ |
| 5 | GET an unknown id | 404 | 404 | ✅ |
| 6 | GET anonymously | 401 | 401 | ✅ |
| 7 | GET for the want without SIMILAR | `[]` | `[]` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: API output (inline above); no screenshot
- **Acceptance criteria checklist**:
  - [x] six fields, no score or vector
  - [x] 404 for a foreign or unknown want

### 4.7 Responsive grid — ✅ Passed
- **User story / acceptance criterion**: `component:similar-section` (`grid-cols-2 … sm:grid-cols-3`)
- **Preconditions**: scenarios 4.1 and 4.2 pages

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | 390×844, computed `grid-template-columns` | 2 columns | `163.6px 163.6px` (active) and `171.2px 171.2px` (activeEmpty) | ✅ |
| 2 | 1280×900 | 3 columns | `364px 364px 364px` | ✅ |
| 3 | Horizontal overflow at 390 | none | `scrollWidth ≤ innerWidth` | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/02-active-mobile-related.png`, `screenshots/11-active-empty-mobile.png`, `screenshots/01-active-desktop.png`
- **Acceptance criteria checklist**:
  - [x] 2 columns on mobile
  - [x] 3 columns on sm+

### 4.8 Accessibility quick check — ✅ Passed
- **User story / acceptance criterion**: `component:similar-section`; standards `accessibility.md`
- **Preconditions**: scenario 4.1 page

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `section[aria-labelledby]` points at the h2 | ids match | `aria-labelledby="_r_3_"` = h2 `id` | ✅ |
| 2 | Resolve `getByRole('region', {name: 'Powiązane rzeczy', exact: true})` | the region resolves with the name without the emoji | resolved (exact match) | ✅ |
| 3 | Emoji span | `aria-hidden="true"` | `aria-hidden="true"`, text 🔗 | ✅ |
| 4 | Cards are links with the item name | link names = titles | links „Zabawka - auto mercedes”, „Resorak ciężarówka”, „Autko drewniane” | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-related-section-desktop.png`
- **Acceptance criteria checklist**:
  - [x] accessible name from the heading
  - [x] emoji hidden from assistive tech

### 4.9 Matching and matchingSlow with related items — ✅ Passed
- **User story / acceptance criterion**: R20; `screen:want-detail-matching-similar`
- **Preconditions**: want „Fotelik samochodowy” ACTIVE with `match_requested_at` set (no matcher running) and 1 SIMILAR row

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/wanted/{id}` | MatchingStatus + SkeletonGrid, then the related section | status „Szukamy pasujących rzeczy… To zwykle kilka sekund.”, 4 skeletons (`aria-hidden`), then „Powiązane rzeczy” with „Fotelik do auta”, then the actions | ✅ |
| 2 | Wait more than 60 s | matchingSlow; section stays | „Wyniki pojawią się wkrótce … Odśwież teraz” and the section still present | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-matching-with-related.png`, `screenshots/10-matching-slow-with-related.png`
- **Acceptance criteria checklist**:
  - [x] section in `matching`
  - [x] section in `matchingSlow`

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
_None observed._

### 5.4 Cosmetic
_None observed._

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| `GET /api/organizations/mine` | 404 (Not Found) | 2 per page load | Minor | Pre-existing and unrelated: the seeker has no organization. No effect on the wants view. |
| `/_next/static/css/app/global-error.css` | preloaded but not used (warning) | once | Cosmetic | Dev-server only; unrelated |

No errors came from `/api/wants/*`. Every `/matches`, `/suggestions` and `/similar` request returned 200. While a want is matching, the list query polls `GET /api/wants` every 2 s for 60 s (`useMatchingPolledQuery`). This is existing, designed behaviour.

## 7. Spec Alignment
- **Fully implemented**:
  - R16 `GET /api/wants/{id}/similar`: six-field card, score order, 404 for foreign or unknown wants, 401 anonymous
  - R17: counts MATCH-only on detail, list and API; SIMILAR open recorded through `mark_match_opened`
  - R19/R20: fourth fetch on the same query, `similar` on matching, matchingSlow, active and activeEmpty only
  - R21: `SimilarSection` placement, markup, copy, grid; `SimilarCard` dashed, no footnote or marker, opened on click
  - Visual Design: all three screens and both components
- **Partially implemented**: _None._ (Reserved captions were not exercised live; see §8.)
- **Not implemented**: _None._
- **Extra (unspecified) behavior**:
  - `GET /api/wants/{id}/similar` returns the stored rows for a FULFILLED want (`["Klocki konstrukcyjne"]`). The UI does not show them. This matches `/suggestions` and is not forbidden by R16.

## 8. Variances from Plan
- Reserved captions and the dimmed reserved tile on SIMILAR cards were not seeded or verified live (optional in the brief).
- The isolated frontend ran from a scratchpad copy with webpack (`next dev --webpack`) instead of Turbopack, because Turbopack refuses a `node_modules` junction outside its root. This affects the bundler only; the source was the same working tree.
- SIMILAR, MATCH and SUGGESTION rows were inserted directly with SQL, so tier assignment by the matcher (forward or window) was not exercised. The matcher's own pytest suite covers it.
- `match_requested_at` was cleared with SQL on the four wants used for non-matching states, because no matcher was running.

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| Order MATCH grid → „Może Cię zainteresuje” → „Powiązane rzeczy” → ActiveActions | ✅ | §4.1, `screenshots/01-active-desktop.png` |
| activeEmpty: EmptyCard stays, followed by „Powiązane rzeczy”; never counts as matches | ✅ | §4.2, `screenshots/05-active-empty-with-related-desktop.png`, `screenshots/06-wanted-list-counts.png` |
| matching: MatchingStatus + SkeletonGrid, then „Powiązane rzeczy” | ✅ | §4.9, `screenshots/09-matching-with-related.png` |
| `section aria-labelledby`, h2 with aria-hidden 🔗, lead copy, `grid-cols-2 gap-3 sm:grid-cols-3` | ✅ | §4.1, §4.7, §4.8 |
| SimilarCard dashed, no footnote, never „nowe” | ✅ | §4.1 |
| Closed wants render no section | ✅ | §4.5, `screenshots/08-fulfilled-no-section.png` |
| Opening a card calls `markOpened` | ✅ | §4.3 |
| `/similar` 404 for a foreign want; no score/vector in the card | ✅ | §4.6 |
| SIMILAR changes neither `match_count` nor `new_match_count` | ✅ | §4.2 |

## 10. Recommendations
- **Must fix before merge**: _None._ (No §5 entries.)
- **Should fix soon**: _None._
- **Nice-to-have**: Add one live check of a reserved SIMILAR card (caption and dimming) on the next E2E pass (§8). This is not a defect.

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (11 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: ✅ GO. Every scenario in the brief (R20–R22 and the Visual Design table) passed in a live browser, with no discrepancies and no feature-related console errors, and the read API matches R16 exactly. The SIMILAR section stays quiet: it never changes counts and never shows on closed wants. Next step: merge from the UI side. Gate the web deploy on the labelled-sample release gate, as the spec requires.
