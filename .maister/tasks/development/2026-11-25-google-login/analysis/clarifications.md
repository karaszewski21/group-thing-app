# Phase 1 Clarifications

## TL;DR
- The nonce cookie's `Secure` flag comes from a config setting (e.g. `AUTH_COOKIE_SECURE`, default true; dev `.env` sets false). It is never derived from request headers.
- The Facebook mock button is removed. Only the Google button shows, full width, above the "lub emailem" divider.
- The user has a Google Cloud OAuth Web client ID and will set `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the local `.env` themselves. The value is never printed.

## Key Decisions
- Secure flag via explicit config, default secure — uvicorn trusts no proxy headers, so this is explicit and safe by default.
- Remove the Facebook mock — no dead button next to a working one. Facebook stays deferred (D9).
- Real client ID available locally — a manual or E2E popup check is possible. Automated tests still use locally signed RS256 tokens.

## Q&A
1. **How is the nonce cookie's Secure flag decided?** → Config setting (Recommended): `AUTH_COOKIE_SECURE`-style setting, default true, false in dev over http.
2. **What happens to the Facebook button?** → Remove it for now (Recommended).
3. **Is a Google OAuth client ID available?** → Yes. The user puts it in `.env` and it is never printed.

## Already resolved by research (not re-asked)
Flow 1A (GIS popup + nonce cookie), handoff 2A (JSON `{token, created, party_id}`), collision 3A (409, no merge; 403 for an unverified email), role 4C (always GUEST), scope 5B (lean MVP). Codebase analysis also found that no terms or consent notice exists on registration, so there is nothing to mirror.
