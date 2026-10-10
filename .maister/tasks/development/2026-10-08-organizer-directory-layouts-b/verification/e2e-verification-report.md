# E2E Verification Report

## 1. Identifier
- **Task**: B — Public organizer read model + SCHEDULE / CIRCLES / EXCHANGE layouts
- **Task path**: C:/Users/karas/Desktop/swaptime/group-thing-app/.maister/tasks/development/2026-10-08-organizer-directory-layouts-b
- **Spec**: C:/Users/karas/Desktop/swaptime/group-thing-app/.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/implementation/spec.md
- **Date**: 2026-10-10
- **Git ref**: 60a7ec7 (main) + uncommitted working-tree changes (containers rebuilt from the working tree)
- **Tester**: e2e-test-verifier (maister)

## 2. Test Environment
| Field | Value |
|---|---|
| Base URL | http://localhost:5174 (docker nginx frontend; `/api` proxied to backend :8080) |
| Browser | Playwright MCP, Chromium |
| Viewport | 1280×900 (desktop), 390×844 (mobile) |
| Auth context | anonymous visitor (also a fresh browser context for mobile); owner `e2e.b.owner@example.com` (ORGANIZER, registered for this run) |
| Test data | live local DB at alembic 0053, plus additive seed made through the public API: org `organizacja-b-e2e`, 2 PUBLIC circles ("Maluchy B" with 25 terms, "Starszaki B" with 1 term), 5 inventory items (4 listed: 2 GIFT, 1 SWAP, 1 LEND; "Traktor" has an APPROVED photo), 1 needed item |

## 3. Executive Summary
**Verdict**: ⚠️ GO WITH CAVEATS

| Metric | Count |
|---|---|
| Scenarios planned | 13 |
| Scenarios executed | 12 |
| Passed | 12 |
| Failed | 0 |
| Blocked | 0 |
| Pass rate | 100% |
| Critical issues | 0 |
| Major issues | 0 |
| Minor issues | 2 |
| Cosmetic issues | 2 |

Every in-scope flow works at runtime. Visitors see the CLASSIC directory, the empty states and the `/:slug/terminy` agenda (chips, filtering, `group_id` sanitizing, "Pokaż więcej", the aria-live announcement) and the not-found frame. The owner sees panel-CTA ghosts, a settings icon "Edytuj wygląd" at the top of the page, and the "Wygląd strony" sheet with 5 cards and correct data-driven "Polecany" badges. Each layout previews live, and "Zapisz" persists the layout, closes the sheet, returns focus to the icon and removes `?edit`. The API meets the contract: Cache-Control, no PII keys, pagination, 400 for bad parameters including `page=10001`, 404 for unknown slugs. Term-page thumbnails render from APPROVED photos. The findings are small polish items: `/terminy` keeps the tab title "frontend" and is not limited to the 430px column on desktop, and the exchange tab strip starts scrolled by 24px.

## 4. Verification Scenarios

### 4.1 Visitor CLASSIC with data — ✅ Passed
- **User story / acceptance criterion**: User story 1; R14, R15 (stats, upcoming-terms:list, exchange-counts:tiles3), R16 CLASSIC
- **Preconditions**: anonymous; `testowa-organizacja-e2e` (2 circles, 2 terms, 0 items) and `pracownia-pod-lipa` (1 circle, 2 terms, LEND 2)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/testowa-organizacja-e2e` | hero:cover, share, stats, upcoming-terms, footer | Stats "2 grupy · 2 terminy w 60 dni", "Najbliższe terminy" with date tiles, "Pt · 17:00" | ✅ |
| 2 | Exchange counts are 0/0/0 | exchange-counts hidden for visitor | Hidden | ✅ |
| 3 | Open `/pracownia-pod-lipa` | exchange-counts tiles; tile > 0 links to term | "Wypożyczę 2" is a link to the term; Oddam/Zamienię plain | ✅ |
| 4 | Attendee count | "zapisanych: N", omitted at 0 | "Śr · 00:00 · zapisanych: 1"; second row has no count | ✅ |
| 5 | Owner-only UI | no ghosts, no edit button | None present | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/01-visitor-classic-testowa.png`, `screenshots/02-visitor-classic-exchange-counts.png`
- **Acceptance criteria checklist**:
  - [x] Stats tiles with pluralPl copy
  - [x] Upcoming terms list with term links
  - [x] Exchange counts tiles with tone classes and links

### 4.2 Visitor empty states — ✅ Passed
- **User story / acceptance criterion**: R14 rule 4 (primary-empty fallback), EmptyStateBlock copy
- **Preconditions**: anonymous; `klub-malego-odkrywcy` (0 circles), `zespol-k` (1 circle, no terms)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/klub-malego-odkrywcy` | EmptyStateBlock "Brak zaplanowanych zajęć" + body + "Udostępnij stronę"; aux blocks hidden | Exactly as expected | ✅ |
| 2 | Open `/zespol-k` | Stats hidden (1 tile < 2), empty state shown | Exactly as expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/03-visitor-classic-empty-state.png`
- **Acceptance criteria checklist**:
  - [x] Visitor never sees ghosts
  - [x] Primary empty renders the layout's copy

### 4.3 `/:slug/terminy` agenda — ⚠️ Passed with issues
- **User story / acceptance criterion**: User story 2; R17, M-5 sanitizing, R12 `useOrganizerTerms`
- **Preconditions**: anonymous and owner; `testowa-organizacja-e2e` (2 circles), `organizacja-b-e2e` (26 terms)

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/testowa-organizacja-e2e/terminy` | Back link, h1, "N zaplanowane", chips (≥2 circles), day groups | "‹ Organizacja Zmieniona E2E", "Wszystkie terminy", "2 zaplanowane", radiogroup with 3 chips, uppercase day headers | ✅ |
| 2 | Click chip "Druga grupa E2E" (no terms) | URL `?group_id=…` (replace), "Brak zaplanowanych zajęć" + "Pokaż wszystkie grupy" | As expected | ✅ |
| 3 | Click "Pokaż wszystkie grupy" | Reset to Wszystkie, param removed | As expected | ✅ |
| 4 | Open `?group_id=garbage` | Treated as Wszystkie, param dropped | URL cleaned, Wszystkie checked, 2 rows | ✅ |
| 5 | Open with valid `group_id` | Chip preselected | Correct chip checked, tabIndex 0 (roving) | ✅ |
| 6 | ArrowRight on chips | Roving focus + select | Focus and selection moved, URL updated | ✅ |
| 7 | `/organizacja-b-e2e/terminy`, "Pokaż więcej" | 20 rows, then 26; button hidden; live region | 20 → 26, button hidden, aria-live "Wczytano 6 kolejnych terminów", "26 zaplanowanych" | ✅ |
| 8 | Document title | Organizer name, as on `/:slug` | Title stays "frontend" | ❌ |
| 9 | Desktop width | 430px column, like the organizer page | Agenda spans the full viewport (about 1150px) | ⚠️ |

- **Issues observed**: §5.3 Minor-1 (title), §5.3 Minor-2 (desktop width)
- **Evidence**: `screenshots/04-terminy-all.png`, `screenshots/05-terminy-filter-empty.png`, `screenshots/12-terminy-show-more.png`, `screenshots/21-mobile-visitor-terminy.png`
- **Acceptance criteria checklist**:
  - [x] Chips, filtering, URL sync with replace
  - [x] Unvalidated `group_id` never sent
  - [x] "Pokaż więcej" + aria-live
  - [x] Back link and footer
  - [ ] Visual consistency with the organizer page frame (desktop)

### 4.4 Term link navigation — ✅ Passed
- **User story / acceptance criterion**: Every term link uses `/${slug}/grupa/${group_id}/term/${term_id}`
- **Preconditions**: anonymous on `/testowa-organizacja-e2e/terminy`

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click the 20 Nov row | Term page of that term | Navigated to `/testowa-organizacja-e2e/grupa/815d…/term/d2f9…`, term "20 listopada 2026, 17:00" | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/04-terminy-all.png`
- **Acceptance criteria checklist**:
  - [x] Link format and target term correct

### 4.5 Unknown slug — ✅ Passed
- **User story / acceptance criterion**: R1/R2 404, R17 404 state
- **Preconditions**: anonymous

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open `/nie-ma-takiej-org` | Not-found frame | "Nie znaleziono strony — Ta organizacja nie istnieje." | ✅ |
| 2 | Open `/nie-ma-takiej-org/terminy` | Not-found frame | Same frame | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/06-unknown-slug-not-found.png`
- **Acceptance criteria checklist**:
  - [x] 404 renders NotFoundFrame on both routes

### 4.6 Owner page: ghosts and top settings icon — ✅ Passed
- **User story / acceptance criterion**: User story 4; GHOST_COPY; user request to move "Edytuj wygląd" from the floating bottom pill to a top icon
- **Preconditions**: owner logged in; `organizacja-b-e2e` with 2 circles, then with 26 terms and items

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Open own page, 0 terms | Ghosts for stats, upcoming-terms, exchange-counts with panel CTAs; about ghost | "Statystyki … Dodaj termin →" `/panel/spotkania`; "Najbliższe terminy …"; "Wymiana rzeczy … Dodaj rzecz do wymiany →" `/panel/rzeczy`; each ends "Widzisz to tylko Ty." | ✅ |
| 2 | During load | BlockSkeleton | "Ładowanie…" skeletons rendered, then content | ✅ |
| 3 | Settings button | icon button `aria-label="Edytuj wygląd"` at the top; no bottom pill | Icon at the top right (desktop y≈90; mobile 44×44 at y≈69); no bottom pill | ✅ |
| 4 | With data | Stats "2 grupy · 26 terminów w 60 dni", 10 rows, "Wszystkie terminy (26) →", counts 2/1/1 | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/07-owner-classic-ghosts.png`, `screenshots/08-owner-classic-with-data.png`
- **Acceptance criteria checklist**:
  - [x] Owner ghosts with CTA links
  - [x] Settings icon at the top of the page

### 4.7 Editor sheet: tabs, 5 cards, Polecany badges — ✅ Passed
- **User story / acceptance criterion**: User story 3; R18; component:layout-card-badge
- **Preconditions**: owner; 26 terms (≥4 in 14 days), 2 circles, 4 items

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click "Edytuj wygląd" | Dialog "Wygląd strony", `?edit=1` | As expected; heading focused | ✅ |
| 2 | Tabs | Układ / Kolory | tablist with both tabs | ✅ |
| 3 | Cards | Klasyczny, Plan zajęć, Grupy, Wymiana, Wizytówka with "Szkic układu …" alt | All 5 present | ✅ |
| 4 | Badges | SCHEDULE, CIRCLES, EXCHANGE = Polecany; CLASSIC, LINKS none | Exactly that; `aria-describedby` includes the badge id | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/09-editor-layout-tab-badges.png`, `screenshots/19-mobile-editor-sheet.png`
- **Acceptance criteria checklist**:
  - [x] 5 cards in a 2-column grid
  - [x] Data-driven, multiple badges

### 4.8 Live preview and save for each layout — ⚠️ Passed with issues
- **User story / acceptance criterion**: R16 layouts; user request "Zapisz saves AND closes"; focus return; `?edit` removed
- **Preconditions**: owner; same data

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Select Plan zajęć | Live preview: hero:compact, next-term-cta, agenda with chips | "NAJBLIŻSZE ZAJĘCIA", "Plan zajęć", chip radiogroup, 20 terms | ✅ |
| 2 | Zapisz | Sheet closes, focus on "Edytuj wygląd", URL without `?edit`, API `page_layout=SCHEDULE` | All confirmed | ✅ |
| 3 | SCHEDULE "Pokaż kolejne terminy" | Loads page 2, button hidden | Day groups 19 → 25, button gone | ✅ |
| 4 | Grupy → Zapisz | circles-grid:cards ("Nasze grupy"), closes | 2 cards "zapisanych: 0 · 25 terminów", "nast.: Nd 11 paź, 17:00"; closed, focus returned | ✅ |
| 5 | Wymiana → Zapisz | Mode tabs, grid2, needed-items, upcoming compact | "Wszystko 4 / Oddam 2 / Zamienię 1 / Wypożyczę 1"; Traktor photo + placeholders; "Potrzebne na najbliższe zajęcia"; "Najbliższe spotkania" 3 chips; closed, focus returned | ✅ |
| 6 | Tab "Oddam" | Filters client-side; `aria-controls` the board | Board shows only Traktor and ela | ✅ |
| 7 | Tab strip at rest | First tab aligned with the 24px gutter | Strip starts with `scrollLeft=24`, so the first tab touches the edge | ⚠️ |
| 8 | Wizytówka → Zapisz | Buttons: Najbliższe zajęcia (filled), Wszystkie terminy (26), Wymiana rzeczy (4), Udostępnij stronę | "Najbliższe zajęcia · Nd 11.10 17:00", "Wszystkie terminy (26)" → `/terminy`, "Wymiana rzeczy (4)" → term, Share | ✅ |
| 9 | Restore Klasyczny | CLASSIC persisted | All 7 orgs report `page_layout: CLASSIC` | ✅ |

- **Issues observed**: §5.4 Cosmetic-1
- **Evidence**: `screenshots/10-preview-schedule.png`, `screenshots/11-saved-schedule-layout.png`, `screenshots/13-saved-circles-layout.png`, `screenshots/15-saved-exchange-layout.png`, `screenshots/16-saved-links-layout.png`, `screenshots/18-mobile-exchange-owner.png`
- **Acceptance criteria checklist**:
  - [x] Live preview of SCHEDULE, CIRCLES, EXCHANGE, LINKS
  - [x] Zapisz persists and closes
  - [x] Focus returns to the settings icon; `?edit` removed
  - [ ] CIRCLES `featured` (1 circle) visually verified (not executed, see §8)

### 4.9 Discard unsaved changes — ✅ Passed
- **User story / acceptance criterion**: A2 editor contract kept
- **Preconditions**: owner; sheet open, Wymiana selected but not saved

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Click Zamknij | alertdialog "Odrzucić zmiany?" | "Odrzucić zmiany? Wybrany układ i kolory nie zostały zapisane." with "Wróć do edycji" / "Odrzuć" (in-app dialog, not native) | ✅ |
| 2 | Wróć do edycji | Sheet stays open with the selection | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/14-discard-changes-confirm.png`
- **Acceptance criteria checklist**:
  - [x] Confirmation on close with unsaved changes

### 4.10 API sanity — ✅ Passed
- **User story / acceptance criterion**: R1, R2, privacy rules, Cache-Control
- **Preconditions**: curl, anonymous

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `GET /api/groups/public/organizers/rodzinny-grajdolek` (via nginx and :8080) | 200, `cache-control: public, max-age=0, s-maxage=60` | Exact header on both | ✅ |
| 2 | Forbidden keys in all 7 org payloads | none | No display_name / party_id / lister_* / claimed_by_* / guardians / organizer_display_name / child* / avatar* / email | ✅ |
| 3 | `/terms?page=1&size=1`, `page=2&size=1` | Paged `{items,total,page,size}` ordered by occurs_on | total 2, correct order | ✅ |
| 4 | `page=10001`, `page=0`, `size=101`, `group_id=abc` | 400 | 400 with fieldErrors for each | ✅ |
| 5 | `group_id` of a non-qualifying circle | 200 empty | `{"items":[],"total":0,…}` | ✅ |
| 6 | Unknown slug / `k-abc` / its `/terms` | 404 | 404 EntityNotFound envelope | ✅ |
| 7 | 0-circle org | 200, empty arrays, `family_count: null` | As expected | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: curl output (inline, this section)
- **Acceptance criteria checklist**:
  - [x] Cache-Control
  - [x] No PII
  - [x] Pagination and 400/404

### 4.11 Term page listing thumbnails — ✅ Passed
- **User story / acceptance criterion**: User story 5; R10; screen:term-page-listing-thumb
- **Preconditions**: term `c430a989…` of "Maluchy B" with 4 listed items, "Traktor" has an APPROVED photo

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `/api/groups/public/{id}/access?term_id=…` and `/api/groups/public/{id}?term_id=…` | `thumb_url` CDN URL for Traktor, null for others | Both routes: 1 CDN `…/w400.webp` URL, 3 nulls | ✅ |
| 2 | Open term page | 48×48 thumbnail, `alt=""`, placeholder tile for the others | Traktor image 48×48 loaded; 3 placeholder tiles | ✅ |
| 3 | Organizer exchange item card | Same thumb in exchange-board | Traktor photo shown in grid2 | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/17-term-page-listing-thumb.png`, `screenshots/15-saved-exchange-layout.png`
- **Acceptance criteria checklist**:
  - [x] thumb_url on both public routes
  - [x] ListingRow 48px thumbnail

### 4.12 Mobile layout and console — ✅ Passed
- **User story / acceptance criterion**: Responsive standard; no console errors
- **Preconditions**: 390×844; fresh anonymous context and owner session

| # | Action | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | Visitor `/organizacja-b-e2e`, `/terminy`, `/pracownia-pod-lipa` | No horizontal page scroll | `scrollWidth == clientWidth` on all 3 | ✅ |
| 2 | Owner EXCHANGE at 390px | Tab strip scrolls inside; grid 2 columns | No page overflow; strip scrolls inside | ✅ |
| 3 | Editor sheet at 390px | Usable bottom sheet | Fits; 2-column cards scroll | ✅ |
| 4 | Console | No errors except expected 404s | 0 errors/warnings in the anonymous context; only the expected 404 resource errors for the unknown-slug test | ✅ |

- **Issues observed**: _None observed._
- **Evidence**: `screenshots/20-mobile-visitor-classic.png`, `screenshots/21-mobile-visitor-terminy.png`, `screenshots/22-mobile-visitor-classic-pracownia.png`, `screenshots/18-mobile-exchange-owner.png`, `screenshots/19-mobile-editor-sheet.png`
- **Acceptance criteria checklist**:
  - [x] No horizontal scroll at 390px
  - [x] No unexpected console errors

## 5. Discrepancies

### 5.1 Critical
_None observed._

### 5.2 Major
_None observed._

### 5.3 Minor
**Minor-1: `/:slug/terminy` does not set the document title**
- **Spec requirement**: R17 (organizer-themed page with the organizer's name); `/:slug` sets the title to the organization name
- **Expected**: Tab title shows the organizer, for example "Wszystkie terminy · Organizacja B E2E" or the organization name
- **Actual**: Title stays the Vite default "frontend" on every `/terminy` load
- **Evidence**: `screenshots/04-terminy-all.png` (the Playwright page title read "frontend" on each navigation)
- **Root cause hypothesis**: `OrganizerTermsPage` lacks the `document.title` effect that `PublicOrganizationPage` has
- **User impact**: Shared links and browser tabs show "frontend"; history and bookmarks are unclear
- **Recommended fix**: Set the title from `usePublicOrganization` data in `OrganizerTermsPage`, the same way as on `/:slug`
- **Workaround**: None needed for function

**Minor-2: `/:slug/terminy` is not limited to the 430px column on desktop**
- **Spec requirement**: Visual Design: "cream canvas and a `max-w-[430px]` column"; Mockup 7 is a 375px column; "Extract `PageFrame` … and reuse"
- **Expected**: Same centered narrow column as `/:slug`
- **Actual**: At 1280px the back link, heading, chips and rows span about 1150px; `/:slug` stays at 430px
- **Evidence**: `screenshots/04-terminy-all.png` vs `screenshots/01-visitor-classic-testowa.png`
- **Root cause hypothesis**: The 430px width is applied by the layout frame inside `LayoutRenderer`/`PublicOrganizationPage`, not by the shared `PageFrame` that `OrganizerTermsPage` uses
- **User impact**: Inconsistent, very wide rows on desktop; fine on mobile
- **Recommended fix**: Wrap the `OrganizerTermsPage` content in the same `mx-auto max-w-[430px]` column
- **Workaround**: None; content stays readable

### 5.4 Cosmetic
**Cosmetic-1: Exchange mode tab strip starts scrolled by 24px**
- **Spec requirement**: component:exchange-board tabs; mockup shows the first tab in the gutter
- **Expected**: First tab "Wszystko N" aligned with the 24px content gutter at rest
- **Actual**: The tablist (`-mx-6 px-6 overflow-x-auto snap-x`) renders with `scrollLeft = 24`, so the first tab touches the column or screen edge (desktop and 390px)
- **Evidence**: `screenshots/15-saved-exchange-layout.png`, `screenshots/18-mobile-exchange-owner.png`
- **Root cause hypothesis**: Scroll-snap without matching scroll padding snaps the first tab to the scroll-port edge
- **User impact**: Visual misalignment only; all tabs are reachable
- **Recommended fix**: Add `scroll-px-6` (scroll-padding) to the tablist, or drop the snap on the first item
- **Workaround**: None needed

**Cosmetic-2: Themed canvas does not fill the full desktop width (likely pre-existing from A1)**
- **Spec requirement**: Organizer theme canvas (A1/A2 visual language)
- **Expected**: Themed canvas color across the viewport
- **Actual**: On `pracownia-pod-lipa` (pink palette) the themed canvas spans about x=40–1240 at 1280px, with default cream margins on both sides
- **Evidence**: `screenshots/02-visitor-classic-exchange-counts.png`
- **Root cause hypothesis**: `OrganizerThemeScope` wrapper has a max width or margin; not introduced by B
- **User impact**: Minor visual seam on wide screens
- **Recommended fix**: Apply the canvas color to the full-bleed wrapper (confirm whether this is A1 scope)
- **Workaround**: None needed

## 6. Console & Network Errors
| Source (file:line) | Message | Frequency | Severity | Impact |
|---|---|---|---|---|
| network: `/api/organizations/public/nie-ma-takiej-org` | 404 Not Found | once per unknown-slug visit | Cosmetic | Expected; it drives the not-found frame |
| network: `/api/groups/public/organizers/nie-ma-takiej-org` (and `/terms?page=1&size=20`) | 404 Not Found | once per unknown-slug visit | Cosmetic | Expected; on `/terminy` the terms query starts in parallel with the org lookup, as the spec allows |

No JavaScript errors, page errors or React warnings were observed. The anonymous mobile context logged 0 errors or warnings across 3 pages.

## 7. Spec Alignment
- **Fully implemented**: R1/R2 public endpoints (shape, 404, 400, empty page for a non-qualifying `group_id`, pagination); privacy allowlist; Cache-Control; R10 `thumb_url` on both public circle routes plus the ListingRow 48px thumbnail; R12 hooks (page-1 load, infinite "Pokaż więcej"); R14 renderer (skeleton while loading, visitor hide or empty-state, owner ghost with CTA); R15 blocks stats, upcoming-terms list/compact, next-term-cta, agenda + chips, circles-grid cards, exchange-counts, exchange-board with tabs, needed-items, link-stack directory buttons, hero compact; R16 all 5 layouts; R17 `/terminy` (chips, sanitizing, Pokaż więcej, aria-live, empty, 404); R18 data-driven multiple badges; user requests (top settings icon, Zapisz closes, focus return)
- **Partially implemented**: R17 visual frame (desktop column width, document title; see §5.3)
- **Not implemented**: _None._
- **Extra (unspecified) behavior**: The settings bar is a full-width white strip above the hero on desktop (a consequence of the user-requested top icon); the next-term-cta shows "zapisanych: 0" at zero (allowed by the block spec, unlike the list rows)

## 8. Variances from Plan
- No owner password for the existing orgs was found in the repo, docs or task folders. A new ORGANIZER account `e2e.b.owner@example.com` (password `E2eBowner!2026`) with org `organizacja-b-e2e` was registered through the public API, and additive data was seeded (2 circles, 26 terms, 5 inventory items with 4 listing preferences, 1 needed item). Existing orgs were not modified and all are CLASSIC.
- CIRCLES `featured` (1 circle, CircleVisualMini) was not executed: it needs an owner with exactly one qualifying circle, and the test org has two (13th planned scenario, not executed).
- LINKS "Polecany" (0 circles / unavailable) and the owner neutral ghost for an unavailable directory were not reproduced, because there is no owner session for a 0-circle org and no way to force an error without code changes.
- `family_count` ≥ 3 could not be shown; no org in the DB has 3+ member families, so the API returned null everywhere, which is correct.
- `next_term` attendee seats and the needed-item "Zapewnione" pill were not exercised (no RSVPs or pledges seeded).

## 9. Evaluation Against Exit Criteria
| Criterion (from spec) | Status | Evidence |
|---|---|---|
| R1 public organizer page, no PII, 404 on unknown/ownerless slug | ✅ | §4.10 |
| R2 `/terms` pagination, 400 invalid params, empty page for foreign group_id | ✅ | §4.10 |
| R10 term page `thumb_url` on both routes + 48px thumb | ✅ | §4.11, `screenshots/17-term-page-listing-thumb.png` |
| R14 renderer rules (skeleton / hide / empty-state / ghost) | ✅ | §4.2, §4.6 |
| R15 blocks render per spec | ✅ | §4.1, §4.8 |
| R16 SCHEDULE / CIRCLES / EXCHANGE / CLASSIC / LINKS layouts | ✅ | §4.8 (CIRCLES featured not executed) |
| R17 `/:slug/terminy` full agenda, chips, Pokaż więcej, states | ✅ | §4.3 (with Minor-1, Minor-2) |
| R18 data-driven Polecany badges | ✅ | §4.7 |
| User request: settings icon at the top replacing the bottom pill | ✅ | §4.6 |
| User request: Zapisz saves and closes, focus returns, `?edit` removed | ✅ | §4.8 |

## 10. Recommendations
- **Must fix before merge**: _None._
- **Should fix soon**: Minor-1 (document title on `/terminy`), Minor-2 (430px column on `/terminy`)
- **Nice-to-have**: Cosmetic-1 (tab strip scroll padding), Cosmetic-2 (full-bleed themed canvas, confirm A1 ownership)

## 11. Artifacts
- **Screenshots**: `verification/screenshots/` (22 files)
- **Visual-fidelity report**: `verification/visual-fidelity.md`
- **Console log dump**: inline in §6

## 12. Conclusion
Verdict: GO WITH CAVEATS. All verified spec requirements and both user-requested editor changes work at runtime without errors, the API privacy and caching contract holds, and term-page thumbnails render from approved photos. The open items are two minor polish gaps on `/terminy` and two cosmetic alignment issues, none of which affects function. Recommendation: merge, then fix Minor-1 and Minor-2 soon. Optionally, seed a one-circle owner to check CIRCLES `featured` visually.
