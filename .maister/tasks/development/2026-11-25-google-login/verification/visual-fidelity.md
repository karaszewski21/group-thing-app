# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/

## TL;DR
- Overall fidelity is **high**. Of 9 design-context entries (7 screens, 2 components), 7 are ✓ structural matches, 2 have a minor deviation (⚠) and none has substantive drift (✗).
- Layout, field order, the slot/status-line/divider stack, the alert styling and all Polish copy match the mockups.
- The deviations are environmental or trivial: at this origin GIS renders only its fallback button (the iframe gets a 403), and the error copy wraps to two lines in the slightly narrower card.

## Key Decisions
- The mockups were rendered in Chromium (`screenshots/mockup-*.png`) and compared with live captures at the same viewport (1280 px desktop, 375 px for the sheet).
- Error and 409 states were captured with a stubbed GIS button labelled "[stub] …". Only the slot around the button and the alert are compared there, because aj does not style the GIS button.

## Open Questions / Risks
- Once the OAuth client authorises `localhost:5174`, recapture the login, register and sheet screens to confirm the real GIS iframe (Google "G" logo inside the pill, 40 px height) still sits centred in the 44 px slot.

## Summary
- Total screens compared: 9 (7 screens + 2 components)
- Match (✓): 7
- Minor deviation (⚠): 2
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:login-tab-google-button (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/login-tab-google-button.html (`screenshots/mockup-login-tab-google-button.png`)
- Screenshot: verification/screenshots/01-login-tab-desktop.png
- Layout: card with heading, tabs, full-width pill, divider, email form — matches
- Field order: Google pill → (empty status line) → "lub emailem" → Email → Hasło → "Zaloguj się" ✓
- Primary action: "Zaloguj się przez Google" pill with the G logo on the left, full card width (382 px) ✓; Facebook removed ✓
- Deviation: the pill is the GIS fallback rendering, because the origin is not authorised (iframe 0×0, 403). It looks almost the same as the mockup.
- Recommendation: recapture after the origin fix

### screen:register-tab-google-button (✓ Match)
- Mockup: analysis/design-context/mockups/register-tab-google-button.html
- Screenshot: verification/screenshots/02-register-tab-desktop.png
- Layout and order identical to the login tab; heading "Dołącz do kręgu"; pill "Zarejestruj się przez Google" ✓

### screen:authsheet-mobile-item-page (✓ Match)
- Mockup: analysis/design-context/mockups/authsheet-mobile-item-page.html
- Screenshot: verification/screenshots/09-authsheet-375-login.png, 10-authsheet-375-focus-google.png, 11-authsheet-375-register.png
- Layout: bottom sheet "Potrzebne konto" with ✕, intro text, tabs, Google pill (320 px), divider, email form ✓
- The intro copy differs from the mockup ("Rezerwacja i czat wymagają konta…" vs "Niektóre rzeczy widzą tylko zalogowani…"). It is the existing context-specific AuthSheet copy, which the spec leaves unchanged.
- The colours follow the organisation theme (pink) on this item page, as expected for themed pages.
- States covered: login tab, register tab, keyboard focus on the Google control, Esc close

### screen:loading-placeholder (✓ Match)
- Mockup: analysis/design-context/mockups/loading-placeholder.html
- Screenshot: verification/screenshots/03-loading-skeleton.png
- 44 px full-width pill skeleton in `bg-line`, divider visible, email field at the same y as in the ready state (486 px) ✓
- Mockup annotation says "GET /api/auth/google/nonce". The implementation correctly uses POST as the spec requires (annotation drift only).

### screen:conflict-409-register-tab (✓ Match)
- Mockup: analysis/design-context/mockups/conflict-409-register-tab.html
- Screenshot: verification/screenshots/05-error-409-register-switch.png, 05b-after-409-switch-login-tab.png
- Alert sits between the button and the divider with the `bg-danger-soft`/`text-danger` rounded-2xl style ✓; copy plus underlined inline "Zaloguj się" ✓; the switch lands on the login tab with the alert cleared ✓

### screen:google-error-messages (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/google-error-messages.html
- Screenshot: verification/screenshots/06-error-401-login.png, 07-error-403-register.png, 08-error-503-login.png
- 401, 403 and 503 copies are character-for-character equal ✓; alert placement and style ✓
- Deviation: the 401 copy wraps to two lines (it is one line in the mockup) because the slot is 382 px wide and the font metrics differ. The form shift stays within Success Criterion 8.
- Impact: negligible

### screen:google-unavailable-email-only (✓ Match)
- Mockup: analysis/design-context/mockups/google-unavailable-email-only.html
- Screenshot: verification/screenshots/04-nonce-503-email-only.png
- No button, no divider, email form directly under the tabs ✓

### component:google-signin-slot (✓ Match)
- Mockup: analysis/design-context/mockups/login-tab-google-button.html
- Screenshot: verification/screenshots/01-login-tab-desktop.png
- Classes: wrapper `mb-4`; slot `flex min-h-11 justify-center` (44 px); status `mt-2 min-h-4.5 text-center text-xs text-ink-soft` (18 px); divider `mt-1 flex items-center gap-2.5 text-[13px] font-bold text-ink-soft` ✓

### component:google-error-alert (✓ Match)
- Mockup: analysis/design-context/mockups/conflict-409-register-tab.html
- Screenshot: verification/screenshots/05-error-409-register-switch.png
- `role="alert"` with `mt-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger` ✓; replaces the status line ✓; the inline button is `type="button"` ✓
