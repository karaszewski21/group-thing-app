# Visual Coverage Matrix

Source: `analysis/design-context/INDEX.md` (7 screens, 2 components)

| Screen/Component ID | Covered By Task Group(s) | Status |
|---------------------|--------------------------|--------|
| screen:login-tab-google-button | Group 7 (Frontend Google Slot UI) | ✅ |
| screen:register-tab-google-button | Group 7 (Frontend Google Slot UI) | ✅ |
| screen:authsheet-mobile-item-page | Group 7 (Frontend Google Slot UI); the 375 px Tab and popup check is manual, during verification | ✅ |
| screen:loading-placeholder | Group 7 (Frontend Google Slot UI) | ✅ |
| screen:conflict-409-register-tab | Group 7 (Frontend Google Slot UI); the `onSwitchToLogin` wiring is in `AuthTabs` (step 7.5) | ✅ |
| screen:google-error-messages | Group 7 (Frontend Google Slot UI); the copies come from the backend in Group 4 | ✅ |
| screen:google-unavailable-email-only | Group 7 (Frontend Google Slot UI); the hidden gate depends on the loader and nonce API in Group 6 and the 503 in Group 4 | ✅ |
| component:google-signin-slot | Group 7 (Frontend Google Slot UI) | ✅ |
| component:google-error-alert | Group 7 (Frontend Google Slot UI) | ✅ |

## Uncovered Items

All screens are covered (9 of 9 IDs). Group 7 holds every UI surface because the whole change sits in `SocialAuthButtons`, its hook and `AuthTabs`. `AuthSheet`, `ModalSheet`, `LoginForm` and `RegisterForm` do not change. The `hidden`-with-error render has no mockup; the spec defines it as the alert alone in the `mb-4` wrapper, and test 7.1 (6) covers it.
