# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect), side by side (SC16)
**Source**: analysis/design-context/INDEX.md (7 mockups, `mockups/*.html`, each opened in the browser by its file path)
**Captured**: verification/e2e-screenshots/ (live app at 420×860, plus 320 and 360 px layout checks)

## TL;DR
- 7 screens compared: **7 ✓ match, 0 ⚠, 0 ✗** after the re-check. The first pass had 5 ✓ and 2 ⚠; both ⚠ items were fixed and confirmed in the "Re-check after fixes" section below.
- Layout, Polish copy, chip colors, bubble and composer styling, and the states the mockups require ("9+", empty card, skeleton, composer error, read-only header line and banner) all match.
- The two first-pass ⚠ items were narrow-viewport issues: the brand text wrapped in the 320 px top bar, and "zobacz rzecz" was truncated at ≤360 px. Both are now fixed.
- Two deviations were already known and accepted and are not counted: avatar tints use familyTone, and TermHeadCard keeps a cream background.

## Open Questions / Risks
- _No substantive drift._ The functional scroll defects in ThreadPage (document scroll leak, jump on "Wcześniejsze wiadomości") are covered in `e2e-verification-report.md` §5.2, not here. They do not change the static look compared with the mockups.

## Summary
- Total screens compared: 7
- Match (✓): 7 (first pass: 5)
- Minor deviation (⚠): 0 (first pass: 2)
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:topbar-inbox-icon (✓ Match after re-check; first pass ⚠)
- Mockup: analysis/design-context/mockups/ikona-wiadomo-ci-w-g-rnym-pasku.html → `e2e-screenshots/m1-mockup-ikona-wiadomo-ci-w-g-rnym-pasku.png`
- Screenshots: `e2e-screenshots/03-A-topbar-badge.png`, `e2e-screenshots/47-A-badge-9plus.png`, `e2e-screenshots/42-layout-320-thread-item.png`
- Layout: 💬 button placed before the bell ✓; mint circle background when on `/panel/wiadomosci` (as in the inbox mockup) and a bare emoji elsewhere ✓
- Badge: mint `bg-mint` count badge at the top-right, NotificationBell classes ✓; "9+" at 12 unread ✓; hidden at 0 ✓; aria-label "Wiadomości (N nieprzeczytane)" ✓
- Deviation: at 320 px the brand text "Krąg grupy" wraps to two lines (bar 68 px instead of 57 px). The mockup's brand is the short "Krąg" and never wraps.
- Impact: small vertical shift on 320 px phones; the thread page overflows by 11 px
- Recommendation: `whitespace-nowrap`/`truncate` on the brand, or hide the brand text below about 340 px

### screen:inbox (✓ Match)
- Mockup: analysis/design-context/mockups/skrzynka-wiadomo-ci.html → `e2e-screenshots/m2-mockup-skrzynka-wiadomo-ci.png`
- Screenshots: `e2e-screenshots/45-B-inbox-term-row-organizer-prefix.png`, `e2e-screenshots/48-A-inbox-unread-count.png`, `e2e-screenshots/46-C-inbox-empty.png`, `e2e-screenshots/49-inbox-skeleton.png`, `e2e-screenshots/50-inbox-error.png`
- Layout: "‹ Wróć", "Wiadomości" heading, rows with a leading visual, kind chip, title, time and an ellipsized preview; PanelNavBar with no active tab ✓
- Chips: "Rzecz" accent-soft, "Grupa" mint-soft, "Termin" teal-soft ✓
- Leading visual: 📦 placeholder for ITEM (accepted per spec M10, replacing the mockup's per-item emoji), group initials for GROUP, 📅 for TERM ✓
- Preview prefixes "Ty:", "Organizator:", "{name}:" ✓; unread rows bold with a mint count ✓; time "16:49" style ✓
- States: empty dashed card with verbatim copy ✓; skeleton row ✓; error + "Spróbuj ponownie" (not in the mockup; spec requirement 32) ✓

### screen:thread-item (✓ Match after re-check; first pass ⚠)
- Mockup: analysis/design-context/mockups/rozmowa-o-rzeczy.html → `e2e-screenshots/m3-mockup-rozmowa-o-rzeczy.png`
- Screenshots: `e2e-screenshots/07-H1-B-converged.png`, `e2e-screenshots/36-composer-429-error.png`, `e2e-screenshots/10-deleted-item-thread.png`, `e2e-screenshots/42-layout-360-thread-item.png`
- Header: back button, thumb tile (📦 placeholder, accepted), item name, "Rozmowa z: … · zobacz rzecz" with an underlined link ✓; "(usunięte)" with no link for a deleted item ✓
- Message area: cream background, "dzisiaj" day pill, mine `bg-primary` on the right with a 6 px bottom-right corner, theirs `bg-paper border-line` on the left with initials avatar, time under the text ✓
- Composer (`component:message-composer`): cream rounded textarea, primary "Wyślij", "Enter — nowa linia", "n / 1000", red `role="alert"` error underneath ✓
- Deviation: at ≤360 px (with realistic names) the second header line ellipsizes and the "zobacz rzecz" link is truncated ("zobacz r…") or clipped entirely at 320 px. The mockup shows the full link.
- Impact: the link to the item is hard to reach on narrow phones
- Recommendation: keep "zobacz rzecz" outside the truncated span, or move it to its own line

### screen:thread-group (✓ Match)
- Mockup: analysis/design-context/mockups/czat-grupy-i-terminu.html → `e2e-screenshots/m4-mockup-czat-grupy-i-terminu.png`
- Screenshots: `e2e-screenshots/24-group-chat-B-view.png`, `e2e-screenshots/28-group-chat-deleted-readonly-B.png`, `e2e-screenshots/26-group-chat-public-readonly.png`, `e2e-screenshots/30-term-chat-deleted-group-organizer.png`
- Header: initials avatar, "{group} · czat grupy" / "· czat terminu", "3 uczestników" ✓; read-only line "Grupa usunięta" / "Grupa publiczna" ✓
- Messages: sender name above others' bubbles with an "Organizator" chip (`bg-mint-soft text-primary-fg`) and initials avatars ✓
- Read-only: a full-width banner "Grupa usunięta — czat jest tylko do odczytu" replaces the composer ✓; the PUBLIC variant reuses it with "Grupa jest publiczna — …" (as the spec says) ✓
- Accepted (not counted): avatar tint from familyTone instead of the mockup's flat tint

### screen:item-ask-button (✓ Match)
- Mockup: analysis/design-context/mockups/zapytaj-o-rzecz-na-stronie-rzeczy.html → `e2e-screenshots/m5-mockup-zapytaj-o-rzecz-na-stronie-rzeczy.png`
- Screenshots: `e2e-screenshots/01-item-page-visitor-ask-button.png`, `e2e-screenshots/09-owner-item-page-no-ask.png`
- "💬 Zapytaj o rzecz" paper pill directly under the status card ✓; absent for the owner ✓ and on a deleted item ✓

### screen:term-chat-buttons (✓ Match)
- Mockup: analysis/design-context/mockups/przyciski-czatu-na-stronie-terminu.html → `e2e-screenshots/m6-mockup-przyciski-czatu-na-stronie-terminu.png`
- Screenshots: `e2e-screenshots/13-term-private-member-attendee-A.png`, `e2e-screenshots/18-term-public-attendee-B.png`
- PRIVATE: two equal-width paper/line pills "💬 Czat terminu" and "👥 Czat grupy" under the term card ✓
- PUBLIC: a single full-width "💬 Czat terminu" pill ✓
- Gating matched the spec matrix (see the e2e report §4.4)

### screen:organizer-entry (✓ Match)
- Mockup: analysis/design-context/mockups/wej-cia-organizatora.html → `e2e-screenshots/m7-mockup-wej-cia-organizatora.png`
- Screenshots: `e2e-screenshots/20-group-details-private-chat-card.png`, `e2e-screenshots/22-term-attendees-write-button.png`
- GroupDetailsPage: card "Czat grupy / Napisz do wszystkich członków grupy. / 💬 Otwórz czat grupy" (primary full-width button) above "Kod dostępu" ✓; absent for a PUBLIC group ✓
- TermAttendeesPage: "💬 Napisz do uczestników" primary full-width button inside TermHeadCard ✓
- Accepted (not counted): TermHeadCard keeps its cream background, where the mockup uses paper

## Re-check after fixes
- **screen:topbar-inbox-icon → ✓.** At 320 px the top bar is 57 px tall and "Krąg grupy" fits on one line (`e2e-screenshots/recheck-320-thread-item-top.png`).
- **screen:thread-item → ✓.** "zobacz rzecz" is fully visible at 320 px and 360 px; the counterpart name ellipsizes instead (`e2e-screenshots/recheck-320-thread-item-top.png`, `e2e-screenshots/recheck-360-thread-item-top.png`). The thread also no longer leaks a document scroll.
- **Final counts:** 7 ✓, 0 ⚠, 0 ✗.
