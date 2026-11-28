# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (9 screens + 2 components)

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:settings-email | Group 13 (Frontend /settings Page & Category Switch) | ✅ |
| screen:home-verify-banner | Group 16 (Frontend Home Banner & Account Row) | ✅ |
| screen:account-settings-row | Group 16 (Frontend Home Banner & Account Row) | ✅ |
| screen:login-forgot-link | Group 14 (Frontend Reset Password Page & Login Link) | ✅ |
| screen:reset-password-request | Group 14 (Frontend Reset Password Page & Login Link) | ✅ |
| screen:reset-password-new | Group 14 (Frontend Reset Password Page & Login Link) | ✅ |
| screen:verify-email | Group 15 (Frontend Verify Email & Unsubscribe Pages) | ✅ |
| screen:unsubscribe | Group 15 (Frontend Verify Email & Unsubscribe Pages) | ✅ |
| screen:emails | Group 3 (Email Core: Rules, Links, Rendering & Senders) | ✅ |
| component:email-category-switch | Group 13 (Frontend /settings Page & Category Switch) | ✅ |
| component:verify-banner | Group 16 (Frontend Home Banner & Account Row) | ✅ |

Supporting groups with no visual surface of their own: Group 11 (`HintCard.onDismiss` optional, `ToggleRow.disabled`, used by `component:verify-banner` and `component:email-category-switch`), Group 12 (`/settings` route plumbing), and Group 17 (SSR and route-manifest cases for every new page).

## Uncovered Items

All screens covered (11/11).

## Deliberate copy deviations from the mockups (per spec)
- `screen:home-verify-banner` / `component:verify-banner`: the description is the neutral M-7 copy „Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości.”, not the mockup's promise of exchange mails.
- `screen:verify-email`: the success text is the neutral M-7 copy, not the mockup's „Od teraz możesz dostawać powiadomienia e-mail…”.
- `screen:emails`: one `EMAIL_FROM_ADDRESS` serves both streams. The mockup's `powiadomienia@`/`konto@` pair is only illustrative.
