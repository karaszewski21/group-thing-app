# Visual Fidelity Report

**Mode**: Report-only (does NOT gate completion)
**Comparison**: LLM-judged structural match (not pixel-perfect)
**Source**: analysis/design-context/INDEX.md
**Captured**: verification/screenshots/ (implementation `NN-*.png`, rendered mockups `mock-*.png`)

## TL;DR
All 11 design-context IDs were compared against the running app (2026-11-28): **9 match, 2 minor deviations, 0 substantive drift**. Fidelity is high.
Copy, field order, primary actions and states match the mockups closely; the deviations are the deliberate neutral copy (user decision M-7), the app shell instead of the mockup's mini header, and one icon-order difference on the `/verify-email` success screen.

## Key Decisions
- Compared structure, copy, field order, actions and state coverage; ignored pixel-level spacing and the mockup frame chrome (gallery bar, "Zaloguj" mini header).
- Copy changes the spec itself records as user decisions (M-7 neutral banner and success copy) count as a match, not drift.
- States that cannot be reached against the local stack without changing configuration (COMPLAINT/BOUNCE suppression, 503 on reset request, a failed switch save, the settings load error) were reached by stubbing the API response in the browser only (Playwright `page.route`); the rendered UI is the real implementation.

## Open Questions / Risks
- `screen:verify-email` success (✅) and `screen:unsubscribe` done (👋): the emoji renders below the description instead of above the heading. Cosmetic; decide whether to move it.
- The token pages render inside the app shell (top bar + bottom tab bar) rather than the mockup's minimal "Gooo / Zaloguj" header. This matches how `/login` already renders, so it is treated as a convention, not drift.

## Summary
- Total screens compared: 11
- Match (✓): 9
- Minor deviation (⚠): 2
- Substantive drift (✗): 0

## Per-Screen Comparison

### screen:settings-email (✓ Match)
- Mockup: analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html (`screenshots/mock-settings.png`)
- Screenshots: `screenshots/12-settings-verified.png`, `screenshots/05-settings-unverified.png`, `screenshots/06-settings-link-sent.png`, `screenshots/29-settings-complaint-mocked.png`, `screenshots/29-settings-bounce-mocked.png`, `screenshots/13-settings-all-off-persisted.png`, `screenshots/27-settings-load-error.png`
- Layout: back link „‹ Konto” → H1 „Powiadomienia e-mail” → intro → „TWÓJ ADRES” card → „POWIADOMIENIA” card; identical order.
- Field order: Wszystkie → Rezerwacje i wymiany → Szukam → Wiadomości o koncie („Zawsze włączone” info pill) ✓
- Badges: Potwierdzony (green), Niepotwierdzony (yellow), Wstrzymane (red) ✓
- States covered: verified, unverified (with „Wyślij link weryfikacyjny”), link sent (`role=status` + „Wyślij ponownie za N s”), complaint (red notice with support address), plus derived bounce, all-off (category switches disabled), load error.

### screen:home-verify-banner (✓ Match)
- Mockup: analysis/design-context/mockups/start-baner-weryfikacji-adresu.html (`screenshots/mock-start-baner-weryfikacji-adresu.png`)
- Screenshots: `screenshots/02-home-verify-banner-before.png`, `screenshots/03-home-verify-banner-sent.png`, `screenshots/11-home-banner-hidden-verified.png`
- Layout: banner directly under the greeting, HintCard look (accent-soft), ✉️ icon, no dismiss ✕ ✓
- Copy: before-state description uses the neutral M-7 copy „Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości.” instead of the mockup's exchange promise (spec-sanctioned).
- States covered: before, after sending („Sprawdź skrzynkę” + „Wyślij ponownie”, `aria-disabled`), hidden when verified.

### screen:account-settings-row (✓ Match)
- Mockup: analysis/design-context/mockups/konto-sekcja-ustawienia.html
- Screenshot: `screenshots/04-account-settings-row.png`
- „USTAWIENIA” section with the „Powiadomienia e-mail ›” row above „Wyloguj się” ✓

### screen:login-forgot-link (✓ Match)
- Mockup: analysis/design-context/mockups/logowanie-link-nie-pamietasz-hasla.html
- Screenshots: `screenshots/01-login-forgot-link.png`, `screenshots/25-authsheet-forgot-link.png`
- Link „Nie pamiętasz hasła?” sits under the password field, before the submit button, both on the page and inside AuthSheet ✓. The rest of the login form (Google button on top) predates this task.

### screen:reset-password-request (✓ Match)
- Mockup: analysis/design-context/mockups/reset-hasla-prosba.html
- Screenshots: `screenshots/14-reset-request-form.png`, `screenshots/15-reset-request-sent-neutral.png`, `screenshots/28-reset-request-503.png`
- Title, lead, E-mail field, „Wyślij link”, „Wróć do logowania” in mockup order; neutral sent copy verbatim; 503 alert verbatim ✓

### screen:reset-password-new (✓ Match)
- Mockup: analysis/design-context/mockups/reset-hasla-nowe-haslo.html
- Screenshots: `screenshots/16-reset-new-mismatch.png`, `screenshots/18-reset-reused-expired.png`, `screenshots/17-reset-success.png`
- „Ustaw nowe hasło” / „Dla konta <email>” / Nowe hasło → Powtórz hasło → inline „Hasła nie są takie same.” → „Zapisz hasło” ✓; expired/used and success states verbatim ✓

### screen:verify-email (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/potwierdzenie-adresu-verify-email.html (`screenshots/mock-potwierdzenie-adresu-verify-email.png`)
- Screenshots: `screenshots/08-verify-email-confirm.png`, `screenshots/09-verify-email-success.png`, `screenshots/10-verify-email-reused-invalid.png`, `screenshots/24-verify-email-invalid-guest.png`
- Confirm, invalid (logged-in button / guest „Zaloguj się, żeby wysłać nowy.”) match.
- Deviation: on success the ✅ icon is rendered after the description (between text and button), the mockup puts it above the heading. Success copy is the neutral M-7 text (spec-sanctioned).
- Impact: visual hierarchy only.
- Recommendation: move the icon above the title (e.g. an icon slot in `AuthLayout`) if the mockup order matters.

### screen:unsubscribe (⚠ Minor Deviation)
- Mockup: analysis/design-context/mockups/wypisanie-unsubscribe.html (`screenshots/mock-wypisanie-unsubscribe.png`)
- Screenshots: `screenshots/31-unsubscribe-choice.png`, `screenshots/32-unsubscribe-done.png`, `screenshots/22-unsubscribe-invalid.png`, `screenshots/23-unsubscribe-forged-post-404.png`
- Choice: title, category line, „Wyłącz tę kategorię” → „Wyłącz wszystkie powiadomienia e-mail” → account-mail note, verbatim ✓
- Invalid: „Nieprawidłowy link” + „Przejdź do ustawień” verbatim ✓
- Deviation: on „Gotowe” the 👋 renders after the description, the mockup puts it above the heading (same pattern as verify-email). Copy verbatim.
- Recommendation: same icon-slot fix as verify-email.

### screen:emails (✓ Match)
- Mockup: analysis/design-context/mockups/maile-powiadomienie-i-weryfikacja.html (`screenshots/mock-maile-powiadomienie-i-weryfikacja.png`)
- Screenshots: `screenshots/30-mail-bell-notification-html.png` (real TERM_ITEM_LISTING_TAKEN mail), `screenshots/21-mail-verify-email-html-redacted.png`, `screenshots/20-mail-password-changed-html.png` (rendered by Mailpit)
- Single white card on a soft background, orange „Gooo” wordmark → H1 subject → message → green pill CTA → divider → footer ✓
- Notification footer: „Dostajesz ten mail, bo masz włączone powiadomienia „Rezerwacje i wymiany”.” + „Wypisz się z tej kategorii · Ustawienia powiadomień” ✓; List-Unsubscribe + List-Unsubscribe-Post present; verify_email has no List-Unsubscribe ✓
- Small additions: the plain URL is printed under the CTA as a fallback (not in the mockup); the verify mail footer line „Jeśli to nie Ty, zignoruj tę wiadomość.” is shorter than the mockup's „…zakładałaś konto…”. Both harmless.
- Note (not visual): on the local SMTP path the List-Unsubscribe header is RFC 2047-encoded; see the E2E report §5.3.

### component:email-category-switch (✓ Match)
- Screenshots: `screenshots/12-settings-verified.png`, `screenshots/13-settings-all-off-persisted.png`, `screenshots/26-settings-toggle-save-failed.png`
- States: on, off, disabled (unverified / ALL off / suppressed), optimistic save reverted with `role="alert"` „Nie udało się zapisać zmiany. Spróbuj ponownie.” under the row ✓

### component:verify-banner (✓ Match)
- Screenshots: `screenshots/02-home-verify-banner-before.png`, `screenshots/03-home-verify-banner-sent.png`
- `role="status"` wrapper, no dismiss ✕ ✓
