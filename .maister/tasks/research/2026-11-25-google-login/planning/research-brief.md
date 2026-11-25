# Research Brief: Logowanie za pomocą Google

## TL;DR
Mixed (technical + literature) research on adding "Sign in with Google" to aj: how it fits the existing
hand-rolled JWT login, the in-house OAuth2 authorization server, the localStorage + `auth_token` cookie
session and the Next.js frontend, and which Google integration pattern (server-side OIDC code flow vs.
Google Identity Services ID-token) is the best fit. The frontend already shows a mock "Google" button
(`src/frontend/src/features/auth/SocialAuthButtons.tsx`); the backend has no social login.

## Key Decisions
- Research type: mixed — codebase integration points plus external Google OIDC/GIS best practices.
- Google first; Facebook (also mocked in the UI) only noted where the design should stay provider-generic.

## Open Questions / Risks
- Account linking: what to do when a Google email matches an existing email/password account.
- Users table currently assumes a password — nullable password / identity table needed?

## Research Question
How should aj implement login and registration with a Google account, end to end (backend FastAPI, frontend
Next.js, data model, security, deploy configuration), consistent with the existing auth architecture and
project standards?

## Sub-questions
1. Current auth: how does login/registration work today (`app/auth`, `app/users`, `app/core/_auth`, JWT
   claim shape, `permissions`, session storage in `auth/session.ts`, `auth_token` cookie, `src/proxy.ts`)?
2. How does the in-house OAuth2 authorization server (`app/oauth2`: PKCE, refresh tokens, token exchange,
   consent page) interact with a Google login — must Google-authenticated users be able to complete
   `/oauth2/authorize` flows for plugins/MCP clients?
3. Data model: users/parties/profiles — what needs to change for external identities (identity table,
   nullable password, email verification, avatar from Google into `media`)?
4. Google options: OIDC authorization-code flow (server-side, PKCE, state/nonce) vs. Google Identity
   Services (One Tap / button returning an ID token verified by the backend). Libraries (google-auth,
   Authlib, PyJWT + JWKS), token verification rules (iss, aud, exp, email_verified, hd).
5. Account linking and takeover risks (unverified email, existing password accounts, email change at Google).
6. Frontend/routing: callback route, redirect after login (`authPath`, full page reload after a session
   change per the components standard), nginx/`next.config.ts` rewrites, CSP.
7. Configuration and deploy: Google Cloud console client, redirect URIs per environment (dev :5173,
   nginx :5174, production), env vars (secret handling per CLAUDE.md), `.env.example`.
8. Legal/UX: consent screen verification, privacy policy, Polish copy, account deletion implications.

## Scope
**Included**: backend auth flow, data model + migration needs, frontend buttons/callback, security,
configuration, testing approach (mocking Google in pytest/vitest).
**Excluded**: implementing the feature; Facebook/Apple beyond a provider-generic note; Google APIs other
than identity (Calendar, Drive).
**Constraints**: follow `.maister/docs/standards` (security, migrations, API, frontend components);
never print secret values; no new dependencies without justification.

## Success Criteria
- A clear recommended flow with sequence of requests and where each piece lives in the codebase.
- Data model change list with migration notes.
- Security checklist (ID-token validation, state/nonce/PKCE, account linking policy).
- Config/deploy checklist and test strategy.
- Confidence level per finding with sources.
