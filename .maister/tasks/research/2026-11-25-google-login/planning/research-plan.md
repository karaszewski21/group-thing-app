# Research Plan: Logowanie i rejestracja kontem Google

## TL;DR
Mixed research (technical codebase analysis + literature on Google OIDC). Five parallel gatherers:
backend auth/OAuth2 server, data model/migrations, frontend auth/routing, Google OIDC/GIS external docs,
config/deploy. The synthesis must compare two integration patterns (server-side OIDC authorization-code
flow with PKCE/state/nonce vs. Google Identity Services ID-token button verified by the backend) against
aj's existing login JWT + localStorage/`auth_token` cookie session, and end in one recommended flow,
a data-model change list, a security checklist, a config checklist and a test strategy.

## Key Decisions
- Research type mixed — the answer depends equally on aj's auth internals and on Google's verification rules.
- Five gatherers instead of the default four — frontend routing (proxy, session, callback, full reload) is a
  distinct surface from backend auth and would overload the backend gatherer (oauth2/router.py alone is 722 lines).
- Dependency check is a first-class question — `pyjwt` and `httpx` are already dependencies, so
  "PyJWT `PyJWKClient` + Google JWKS, no new package" must be weighed against `google-auth` / Authlib.
- Facebook only as a provider-generic note (identity table keyed by `(provider, subject)`).

## Open Questions / Risks
- `users.password_hash` is `NOT NULL` (`app/auth/models.py`) and login resolves `UserProfile.email` →
  `account_user_id` → `User`; Google-only accounts need either a nullable hash or an unusable sentinel.
- Account linking with an existing email/password account is a takeover vector; policy must be decided
  (auto-link only on `email_verified` + Google as authoritative, or require password confirmation).
- Whether Google-authenticated users must complete in-house `/oauth2/authorize` (plugin/MCP consent) —
  the authorize POST takes `_token` from the login session, so it likely works unchanged; to be verified.
- Google consent-screen verification / privacy policy page may block production rollout (legal, not code).
- Secrets: gatherers must never print `.env` values or `GOOGLE_CLIENT_SECRET`; presence checks only.

## 1. Research Overview

**Question**: How should aj implement login and registration with a Google account end to end (FastAPI
backend, Next.js frontend, data model, security, deploy config), consistent with the existing auth
architecture and project standards?

**Sub-questions** (from the brief, numbered for traceability):
1. Current auth: login/registration, JWT claim shape (`sub`/`permissions`/`iat`/`exp`), `encode_login_token`,
   token sources (Bearer, `_token`, `auth_token` cookie on GET/HEAD), `session.ts`, `proxy.ts`.
2. Interaction with the in-house OAuth2 authorization server (`app/oauth2`: PKCE, refresh, token exchange, consent).
3. Data model: `users`, `user_profiles` (email unique, lowercased; `account_user_id` nullable), `parties`,
   `user_roles`, `media` AVATAR slot — what changes for external identities.
4. Google options: OIDC code flow vs. GIS ID token; libraries; verification rules (iss, aud, exp, azp,
   email_verified, nonce, hd).
5. Account linking and takeover risks.
6. Frontend/routing: callback route, redirect after login, `authPath`, full page reload after session change,
   nginx/`next.config.ts` rewrites, CSP.
7. Config/deploy: Google Cloud client, redirect URIs per env (dev :5173, nginx :5174, prod), env vars,
   `.env.example`, compose.
8. Legal/UX: consent screen verification, privacy policy, Polish copy, account deletion.

**Type**: Mixed (technical + literature).
**In scope**: backend flow, data model + migrations, frontend buttons/callback, security, config/deploy, tests.
**Out of scope**: implementation; Facebook/Apple beyond a generic note; non-identity Google APIs.
**Constraints**: `.maister/docs/standards` (security, migrations, models, api, components, testing),
minimal dependencies, never print secrets.

## 2. Methodology

**Primary approach**
- Codebase analysis: read auth, users, party, media, oauth2 modules end to end; trace the login and
  registration request paths from the React form to the JWT and back into the session/cookie.
- Literature review: Google Identity official docs (OIDC, GIS, ID-token verification), OAuth 2.0 Security
  BCP (RFC 9700), OpenID Connect Core, OWASP guidance on account linking.
- Configuration review: compose, nginx, `next.config.ts`, `config.py` Settings, `.env.example` (keys only).

**Fallback strategies**
- If a code path is unclear from reading, use the existing tests (`test_login.py`, `test_registration.py`,
  `test_auth_cookie.py`, `session.test.ts`, `proxy.test.ts`) as executable specification.
- If Google docs pages fail to fetch, use the OpenID Connect spec and Google's published discovery document
  (`https://accounts.google.com/.well-known/openid-configuration`) as primary references.

**Analysis framework**
- Technical: component identification → flow analysis (current login sequence) → integration mapping (where a
  Google step plugs in; which code is reused, e.g. `encode_login_token`, `register`, `derive_username_from_email`).
- Literature: pattern comparison (code flow vs. GIS) → trade-off matrix (security, UX, dependency cost, CSP,
  fit with SSR/proxy, testability) → applicability to aj.
- Gap analysis: current data model vs. required (identity table, nullable password, linking metadata).
- Risk assessment: takeover, CSRF on callback, token leakage via URL/referrer, open redirect on `next`.

## 3. Data Sources
See `planning/sources.md` for the full verified manifest. Summary:
- Codebase: `src/backend/app/{auth,users,party,media,oauth2,core/_auth,core/security.py,core/authorization_matrix.py,config.py}`,
  `src/frontend/src/{auth,features/auth,proxy.ts,routing,app}`, Alembic `0001`, `0011`, `0015`, `0016`, `0082`.
- Docs: `.maister/docs/standards/backend/{security,models,migrations,api}.md`, frontend `components.md`,
  `accessibility.md`, testing standards, `project/architecture.md`, `project/tech-stack.md`.
- Config: `docker-compose.yml`, `.env.example`, `src/frontend/nginx.conf`, `src/frontend/next.config.ts`,
  `src/backend/pyproject.toml`, `src/backend/Dockerfile`, `src/frontend/Dockerfile`.
- External: Google Identity docs, OIDC Core, RFC 9700, RFC 7636, OWASP, PyJWT/google-auth/Authlib docs.

## 4. Research Phases

**Phase 1 — Discovery (all gatherers, parallel)**
Each gatherer inventories its sources, confirms they exist, and records file:line evidence.

**Phase 2 — Current-state flow tracing**
- Backend: `POST /api/auth/login` (`app/auth/router.py`) → `UserProfile` by email → `User` → `_load_permissions`
  → `encode_login_token`; registration via `app/users/router.py` → `service.register` → `create_account_and_profile`.
- Frontend: `LoginForm`/`RegisterForm` → `AuthContext` → `session.ts` (localStorage + cookie) → full reload
  (`routing/documentNavigation.ts`) → `proxy.ts` gate.
- OAuth2 server: how `/oauth2/authorize` identifies the user (`_token`), consent page `OAuth2AuthorizePage.tsx`,
  where a "Log in with Google" detour must return to.

**Phase 3 — External options and rules**
- Document both Google patterns with exact request sequences; ID-token validation rules; JWKS caching;
  nonce/state/PKCE requirements; `email_verified`, `hd`; GIS FedCM migration and third-party-cookie status;
  CSP origins GIS needs.
- Library evaluation: PyJWT `PyJWKClient` (already installed) vs. `google-auth` vs. Authlib — size, async fit,
  maintenance.

**Phase 4 — Integration design inputs**
- Data model gaps and migration shape (new `user_identities`/`external_identities` table vs. columns;
  `password_hash` nullability; unique `(provider, subject)`; reversibility per migrations standard).
- Account-linking policy options with risk rating.
- Config/redirect-URI matrix per environment; where secrets live; rewrites needed for `/api/auth/google/*`.
- Test strategy: backend — fake JWKS / signed test ID token with a local key, no network; frontend — mocked
  API module, `renderWithRoute`, proxy tests.

**Phase 5 — Verification**
Cross-check every claim about aj against code (file:line) and every Google rule against an official URL;
mark confidence High/Medium/Low.

## 5. Gathering Strategy

### Instances: 5

| # | Category ID | Focus Area | Tools | Output Prefix |
|---|-------------|------------|-------|---------------|
| 1 | codebase-auth | Backend login/registration, JWT encode/decode, token sources, Principal, authorization matrix, in-house OAuth2 server (authorize/consent/token/token-exchange) and how a Google-authenticated user would pass through it; related backend tests | Glob, Grep, Read | codebase-auth |
| 2 | codebase-data-model | `users`, `user_profiles`, `user_roles`, `parties`, `media` (AVATAR), permissions table; registration service internals (`register`, `derive_username_from_email`, display name); relevant Alembic migrations; models/migrations standards; what an identity table + nullable password would touch (login, password change, account deletion) | Glob, Grep, Read | codebase-data-model |
| 3 | codebase-frontend | `SocialAuthButtons.tsx`, `LoginForm`/`RegisterForm`/`AuthSheet`/`AuthTabs`/`LoginPage`, `AuthContext`, `session.ts`, `authPaths.ts`, `AuthGuard`, `proxy.ts` (PROTECTED_PREFIXES, OAuth2 rewrite), `src/routing/` (documentNavigation, `next` param handling), `src/app` auth routes, `src/api` auth client; frontend tests; components/accessibility/testing standards | Glob, Grep, Read | codebase-frontend |
| 4 | external-google | Google OIDC code flow vs. Google Identity Services (button/One Tap, FedCM), ID-token verification rules, discovery doc + JWKS, nonce/state/PKCE, `email_verified`/`hd`, account linking & takeover guidance (OIDC Core, RFC 9700, OWASP), library comparison (PyJWT PyJWKClient, google-auth, Authlib), CSP requirements, consent-screen verification & privacy-policy requirements, provider-generic note for Facebook | WebSearch, WebFetch | external-google |
| 5 | config-deploy | `app/config.py` Settings, `.env.example` (keys only), `docker-compose.yml` services/env, `src/frontend/nginx.conf`, `next.config.ts` rewrites, Dockerfiles, `pyproject.toml` deps, CORS settings; redirect-URI matrix dev :5173 / nginx :5174 / production; where `GOOGLE_CLIENT_ID`/`SECRET` would live; `NEXT_PUBLIC_*` build-time exposure | Glob, Grep, Read | config-deploy |

### Rationale
The question spans four codebase surfaces plus external rules. Backend auth and the OAuth2 server form one
coherent flow; the data model is a separate concern with migration implications; the frontend has its own
routing/session subtleties (proxy gate, full reload, SSR safety) that drive the callback design; Google's
rules are purely external; deploy config determines redirect URIs and secret handling. Categories do not
overlap: tests go to the gatherer owning the code they test.

**Secrets rule for every gatherer**: never run `env`/`printenv`, never `cat .env`, never print secret values;
list `.env.example` keys only and check presence with `[ -n "$VAR" ] && echo set || echo missing`.

## 6. Success Criteria
- Recommended flow chosen with rationale and a full request sequence (browser → Next → backend → Google → back),
  naming the files/modules each step lives in.
- All 8 sub-questions answered with evidence (file:line or official URL).
- Data model change list with migration notes (reversibility, constraints, naming per standards).
- Security checklist: ID-token validation fields, state/nonce/PKCE, callback CSRF, open-redirect guard,
  account-linking policy, token not left in URL/history.
- Config/deploy checklist: Google Cloud client setup, redirect URIs per env, env vars, `.env.example`, CSP/nginx.
- Test strategy for pytest and vitest without network calls to Google.
- Dependency decision justified against "minimal dependencies".
- Confidence level per finding.

## 7. Expected Outputs
- `analysis/findings/{codebase-auth,codebase-data-model,codebase-frontend,external-google,config-deploy}-*.md`
- Research report with recommended architecture, trade-off matrix, change lists, checklists and risks.
- Inputs suitable for a follow-up development workflow specification.
