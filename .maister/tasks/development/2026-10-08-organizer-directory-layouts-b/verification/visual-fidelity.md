# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md (ASCII mockups in analysis/design-context/ascii/ui-mockups.md)
**Captured**: verification/screenshots/

## Summary
- Total screens compared: 9
- Match (✓): 6
- Minor deviation (⚠): 3
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:layout-classic (✓ Match)
- Mockup: ascii/ui-mockups.md#layout-classic (Mockup 1)
- Screenshot: verification/screenshots/08-owner-classic-with-data.png, 01-visitor-classic-testowa.png, 02-visitor-classic-exchange-counts.png
- Layout: hero cover (primary band, initials, serif name, domain) → Udostępnij → stats tiles → about (owner ghost only) → "Najbliższe terminy" (primary) → "Wszystkie terminy (N) →" → "Wymiana rzeczy" 3 tiles → footer. The order matches the mockup.
- Copy: "grupy", "terminów w 60 dni", "zapisanych: 1", Oddam / Zamienię / Wypożyczę match.
- States covered: with data, exchange hidden at 0/0/0, visitor empty-state.

### screen:layout-schedule (✓ Match)
- Mockup: Mockup 2
- Screenshot: verification/screenshots/11-saved-schedule-layout.png
- Layout: compact hero bar (avatar, name, inline Udostępnij) → "NAJBLIŻSZE ZAJĘCIA" card on primary-soft with date tile and the "Zobacz i zapisz się →" CTA → "Plan zajęć" + chips → uppercase day headers with time/name/description rows → "Pokaż kolejne terminy" → about ghost → exchange tiles → footer.
- Minor note: the CTA card shows "zapisanych: 0" on its own line, where the mockup puts "· 12 zap." inline. Information is unchanged.

### screen:layout-circles (⚠ Minor Deviation)
- Mockup: Mockup 3
- Screenshot: verification/screenshots/13-saved-circles-layout.png
- Layout (`cards`, ≥2 circles): hero cover → Udostępnij → "Nasze grupy" cards (name, "zapisanych: 0 · 25 terminów", "nast.: Nd 11 paź, 17:00", chevron) → about → exchange tiles → footer. This matches.
- Deviation: each card has a leading group icon that the mockup does not show. The `featured` variant (1 circle + CircleVisualMini) was not captured, because the test data had 2 circles.
- Impact: none on the hierarchy; featured coverage is pending.

### screen:layout-exchange (⚠ Minor Deviation)
- Mockup: Mockup 4
- Screenshot: verification/screenshots/15-saved-exchange-layout.png, 18-mobile-exchange-owner.png
- Layout: compact hero → mode tabs "Wszystko 4 / Oddam 2 / Zamienię 1 / Wypożyczę 1" → 2-column cards (square photo or PhotoPlaceholder, name, mode pill + condition, "odbiór: Nd 11 paź") → "Potrzebne na najbliższe zajęcia" (BringsIcon, name, date, "Zobacz →") → "Najbliższe spotkania" 3 chips → about → footer. This matches; the tabs live inside exchange-board, as the spec allows (L-6).
- Deviation: the tab strip renders scrolled by 24px, so "Wszystko" touches the edge instead of sitting in the gutter as in the mockup (Cosmetic-1 in the E2E report).

### screen:layout-links (✓ Match)
- Mockup: Mockup 5
- Screenshot: verification/screenshots/16-saved-links-layout.png
- Layout: centered frame with primary-soft→cream gradient, centered avatar, name, domain → filled "Najbliższe zajęcia · Nd 11.10 17:00" → outlined "Wszystkie terminy (26)" → "Wymiana rzeczy (4)" → "Udostępnij stronę" → about ghost → footer. Order, labels and fill rules match.

### screen:owner-edit-empty (✓ Match)
- Mockup: Mockup 6
- Screenshot: verification/screenshots/07-owner-classic-ghosts.png, 03-visitor-classic-empty-state.png
- Owner ghosts: dashed/eye-icon cards with title, body ending "Widzisz to tylko Ty." and CTA links ("Dodaj termin →", "Dodaj rzecz do wymiany →"). Visitor: "Brak zaplanowanych zajęć" card + "Zajrzyj tu wkrótce…" + "Udostępnij stronę".
- Intentional deviation (user-requested): the mockup's bottom "( ✎ Edytuj wygląd )" pill is replaced by a top settings icon button. This is accepted.
- Loading skeletons were observed transiently (DOM "Ładowanie…") but not screenshotted.

### screen:organizer-terms (⚠ Minor Deviation)
- Mockup: Mockup 7
- Screenshot: verification/screenshots/04-terminy-all.png, 05-terminy-filter-empty.png, 12-terminy-show-more.png, 21-mobile-visitor-terminy.png
- Layout: back link "‹ name" → h1 "Wszystkie terminy" → "26 zaplanowanych" → chips → uppercase day headers with rows → "Pokaż więcej" → footer. This matches on mobile (21-mobile-visitor-terminy.png).
- Deviation: on desktop the page is full-width instead of the narrow column used by the organizer page and the mockup (Minor-2 in the E2E report).

### screen:editor-layout-tab (✓ Match)
- Mockup: Mockup 8
- Screenshot: verification/screenshots/09-editor-layout-tab-badges.png, 19-mobile-editor-sheet.png
- Layout: "Wygląd strony" title + close, Układ/Kolory tabs, 2-column grid of 5 cards with SVG sketches, label, "Polecany" pill (SCHEDULE, CIRCLES, EXCHANGE), description, selected check, footer Anuluj/Zapisz. This matches.

### screen:term-page-listing-thumb (✓ Match)
- Mockup: Mockup 9
- Screenshot: verification/screenshots/17-term-page-listing-thumb.png
- Layout: 48×48 rounded tile left of each listing (photo for Traktor, PhotoPlaceholder for others), name link and action button on the right. This matches the "after" mockup; the tile sits outside the item link.
