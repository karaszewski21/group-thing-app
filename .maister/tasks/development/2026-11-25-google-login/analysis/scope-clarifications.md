# Phase 2 Scope Clarifications

## TL;DR
All eight important decisions from the gap analysis were resolved with the recommended option. Scope is unchanged (lean MVP 5B); no critical decisions were open.

## Key Decisions
- **display-name-source → A**: the Google `name` goes through `check_text(PROFILE_NAME)`. On a reject or a moderation outage the email-derived name is used, so sign-in never fails because of the name.
- **google-409-copy → A**: the 409 shows its own text, "Konto z tym adresem już istnieje — zaloguj się hasłem." On the register tab it also shows the inline "Zaloguj się" switch (`onSwitchToLogin` passed into `SocialAuthButtons`).
- **nonce-client-lifecycle → A**: the nonce is fetched on mount, then re-fetched and GIS re-initialized after every failed attempt and when the 10-minute TTL lapses. There is no automatic POST retry.
- **backend-unconfigured-ui → A**: when `/nonce` answers 503, the button and the "lub emailem" divider are hidden.
- **button-layout → A**: standard / outline / pill / large, `locale: "pl"`. The text is `signin_with` on the login tab and `signup_with` on the register tab. Width follows the container, clamped to 200–400 px and centered, with a min-height placeholder so the layout does not shift.
- **jwks-outage-status → A**: a JWKS fetch failure returns a Polish 503, "Logowanie przez Google jest chwilowo niedostępne", and logs one WARNING. Sign-in still fails closed.
- **created-flag-use → A**: the frontend does nothing special for `created: true`, the same as register.
- **google-401-copy → A**: every verification failure shows one Polish message, "Nie udało się zalogować przez Google. Spróbuj ponownie." The reason goes only to the logs.

## Open Questions / Risks
- Email casing: call `normalize_email` before the 409 lookup, because register's duplicate check is an exact match.
- Safari rejects `Secure` cookies on http://localhost, so the compose stack on :5174 also needs `AUTH_COOKIE_SECURE=false`. Document this in `.env.example`.
- The GIS callback is page-global, so only one `SocialAuthButtons` can be live at a time. The spec has to state this assumption.
