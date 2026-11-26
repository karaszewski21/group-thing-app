# Design Context Index

## TL;DR
Seven HTML mockups of the shared auth form with the real Google button (Phase 4, mockup-studio). They bind to aj's tokens and the existing `AuthLayout`, `AuthTabs`, `ModalSheet` and `authStyles` classes. The Facebook mock is gone. The Google button is rendered by GIS, so aj controls only its options and the slot around it.

## Open Questions / Risks
- Resolved: the owner approved the 403 copy ("Ten adres w Google nie jest potwierdzony…") with the mockups at the Phase 4 gate.
- Resolved (approved at Phase 4): the 503 copy was extended with "Zaloguj się emailem albo spróbuj później." The decided base text is "Logowanie przez Google jest chwilowo niedostępne".

| ID | Type | Source | Description |
|----|------|--------|-------------|
| screen:login-tab-google-button | screen | analysis/design-context/mockups/login-tab-google-button.html | /login, "Zaloguj się" tab: full-width GIS pill "Zaloguj się przez Google", "lub emailem" divider, email form |
| screen:register-tab-google-button | screen | analysis/design-context/mockups/register-tab-google-button.html | /login?mode=register: GIS text signup_with "Zarejestruj się przez Google" |
| screen:authsheet-mobile-item-page | screen | analysis/design-context/mockups/authsheet-mobile-item-page.html | AuthSheet "Potrzebne konto" at 375 px on an item page, with the Google button above the email form |
| screen:loading-placeholder | screen | analysis/design-context/mockups/loading-placeholder.html | 44 px skeleton while the nonce and GIS script load, so the layout does not shift |
| screen:conflict-409-register-tab | screen | analysis/design-context/mockups/conflict-409-register-tab.html | 409 alert "Konto z tym adresem już istnieje — zaloguj się hasłem." with an inline "Zaloguj się" switch |
| screen:google-error-messages | screen | analysis/design-context/mockups/google-error-messages.html | 401 generic, 403 unverified email (proposed copy), 503 JWKS outage alerts |
| screen:google-unavailable-email-only | screen | analysis/design-context/mockups/google-unavailable-email-only.html | No client ID, or backend 503 on /nonce: no button and no divider, email form only |
| component:google-signin-slot | component | analysis/design-context/mockups/login-tab-google-button.html | SocialAuthButtons rewritten: centered GIS slot (200–400 px), status/alert line, divider |
| component:google-error-alert | component | analysis/design-context/mockups/conflict-409-register-tab.html | role="alert" line reusing the LoginForm alert classes (rounded-2xl bg-danger-soft text-danger) |
