# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (implementation) and verification/screenshots/mock-*.png (the mockups rendered at 1280 px)

## TL;DR
The implementation follows the mockups structurally: **6 matches, 4 minor deviations, 0 substantive drift** across 10 design-context IDs (7 screens, 3 components).
The deviations are the toast position and style (intentional per spec), the product-page pill row above the title (the existing `ItemHeader` layout), the admin page's unstyled Chakra input and button (pre-existing env styling, same on `/admin/points`), and the `ItemCard` corner badge covering the mode badge on narrow tiles.

## Key Decisions
- The toast rendered as the bottom ToastPill instead of the mockup's red top toast, and the admin nav ordering, are treated as intentional (spec Visual Design table and the verification brief). They count as ⚠, not ✗.
- The mockups were rendered in Chromium from local copies and screenshotted, so they can be compared side by side with the run screenshots.

## Open Questions / Risks
- `component:item-card-featured-marker`: on 2-column owner and profile grids, the corner badge overlaps the left mode badge. Decide between a star-only compact badge, a stacked layout, or truncation (see e2e §5.3 Minor-1).

## Summary
- Total screens compared: 10 (7 screens + 3 components)
- Match (✓): 6
- Minor deviation (⚠): 4
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:my-items-featured-toggle (✓ Match)
- Mockup: analysis/design-context/mockups/moje-rzeczy-prze-cznik-wyr-nij.html (`screenshots/mock-moje-rzeczy-prze-cznik-wyr-nij.png`)
- Screenshot: `screenshots/05-my-items-A-featured.png`, `screenshots/04-my-items-before.png`
- Layout: the toggle sits beside „Publiczna | Prywatna” under the mode buttons, as in the mockup.
- Chip row: „⭐ Wyróżnione” is the first chip (before „40 pkt” and „Publiczna”). It wraps onto its own line on the narrower 3-column panel cards. The mockup shows one row on a wider card; the order is the same.
- States: off „⭐ Wyróżnij” (outline), on „⭐ Wyróżnione” (ink). The draft card has no toggle. There is no N/limit counter.

### screen:my-items-featured-errors (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/moje-rzeczy-limit-osi-gni-ty.html (`screenshots/mock-moje-rzeczy-limit-osi-gni-ty.png`)
- Screenshot: `screenshots/06-my-items-cap-toast.png`, `screenshots/07-my-items-disabled-toast.png`
- Copy: both texts match. The cap text reads „Możesz wyróżnić maksymalnie 1 rzecz.” at N = 1; the mockup shows N = 3 („3 rzeczy”).
- Deviation: the bottom dark ToastPill (`role=status`) instead of the red top toast with ✕.
- Impact: none. This is intentional per spec (Visual Design table: "Rendered in the existing bottom ToastPill").

### screen:term-page-featured-first (✓ Match)
- Mockup: analysis/design-context/mockups/strona-terminu-wyr-nione-pierwsze.html (`screenshots/mock-strona-terminu-wyr-nione-pierwsze.png`)
- Screenshot: `screenshots/13-term-participant-preview.png`, `screenshots/21-term-B-featured-first.png`
- Layout: the lister row with its 3-item preview, featured first with the pill before the mode pill, then „Pokaż więcej (N) ›”.

### screen:event-page-featured-first (✓ Match)
- Mockup: analysis/design-context/mockups/strona-eventu-wyr-nione-pierwsze.html (`screenshots/mock-strona-eventu-wyr-nione-pierwsze.png`)
- Screenshot: `screenshots/12-event-participant-preview.png`, `screenshots/20-event-B-featured-oldest-first.png`
- Layout: the participant rows (organizer badge, „To Ty”) and the 3-item preview with the featured item first and the pill. The oldest featured listing is pulled into the window.

### screen:owner-items-featured-first (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html (`screenshots/mock-strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.png`)
- Screenshot: `screenshots/08-owner-items-featured-first.png`, `screenshots/09-owner-items-gift-tab-mobile.png`, `screenshots/10-profile-recent-items.png`
- Layout: tabs with counts, a grid with the featured tile first in every tab, the corner badge on the right.
- Deviation: the app grid is 2 columns (tiles about 186 px wide) versus 3 in the mockup, so the right featured badge overlaps the left mode badge („Oddar…”).
- Impact: the mode label of featured tiles is partly hidden.
- Recommendation: a compact star-only badge below `md`, or a stacked layout.

### screen:product-page-featured-badge (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/strona-produktu-badge.html (`screenshots/mock-strona-produktu-badge.png`)
- Screenshots: `screenshots/11-product-owner-featured-pill.png`, `screenshots/14-product-anonymous-featured-pill.png`, `screenshots/15-product-other-user-featured-pill.png`
- Match: the md pill „⭐ Wyróżnione” comes before „Chcę oddać” and is visible to the owner, anonymous visitors and other users.
- Deviation: the pill row sits above the category/condition line and the title (the existing `ItemHeader` layout); the mockup draws it below the title.
- Impact: none on hierarchy. It follows the existing header structure.

### screen:admin-settings (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/panel-admina-ustawienia.html (`screenshots/mock-panel-admina-ustawienia.png`)
- Screenshot: `screenshots/01-admin-settings-default.png`, `screenshots/02-admin-settings-invalid-25.png`, `screenshots/22-admin-settings-stale-409.png`
- Match: the heading, subtitle, fieldset „Wyróżnione rzeczy”, label, help text, Save, the 409 message and the validation message are verbatim. The nav shows „Settings” after „Points”.
- Deviation: the input has no visible border or padding, and „Zapisz” renders as plain text rather than a filled button. The same happens on the existing `/admin/points` page (`screenshots/23-admin-points-baseline-styling.png`), so this is an environment or theme issue, not this feature. The 409 renders as plain alert text, not a tinted banner.
- Impact: cosmetic only. Pre-existing.

### component:featured-pill (✓ Match)
- Mockup: strona-terminu-wyr-nione-pierwsze.html
- Screenshot: `screenshots/13-term-participant-preview.png`
- First pill „⭐ Wyróżnione”, `bg-ink text-on-ink`, ⭐ in an `aria-hidden` span (DOM-checked).

### component:item-card-featured-marker (✓ Match, with layout caveat)
- Mockup: strona-rzeczy-w-a-ciciela-wyr-nione-pierwsze.html
- Screenshot: `screenshots/08-owner-items-featured-first.png`
- The right-corner badge is in the marker slot, `bg-ink text-on-ink`, with ⭐ `aria-hidden`. The overlap is counted once, under screen:owner-items-featured-first.

### component:featured-toggle (✓ Match)
- Mockup: moje-rzeczy-prze-cznik-wyr-nij.html
- Screenshot: `screenshots/05-my-items-A-featured.png`
- `type=button`, `aria-pressed` true/false, stable `aria-label` „Wyróżnij: {name}”, ink background when on.
