# Research Sources: Logowanie kontem Google

## TL;DR
All codebase and config paths below were verified to exist on 2026-11-25 (branch
`feature/global-search-group-description`). No Google/social login exists in the backend; the only Google
reference in auth is the mock `SocialAuthButtons.tsx`. `pyjwt` and `httpx` are already backend dependencies.

## Key Decisions
- Sources grouped by gatherer category so each gatherer owns a disjoint set.

## Open Questions / Risks
- `.env` must not be read; only `.env.example` keys are a source. No `GOOGLE_*` keys exist there yet.

## Codebase Sources — codebase-auth (backend auth + OAuth2 server)

### Key Files
- `src/backend/app/auth/router.py` (87 lines) — `POST /api/auth/login`; email → `UserProfile` → `User`, `_load_permissions`, `encode_login_token`
- `src/backend/app/auth/models.py` (50) — `User` (`username`, `password_hash` NOT NULL String(72)), `Permission` enum, permissions `Table`
- `src/backend/app/core/security.py` — `encode_login_token`, `verify_password`, bcrypt hashing
- `src/backend/app/core/_auth/token.py` (51) — token sources (Bearer, `_token`, `auth_token` cookie on GET/HEAD)
- `src/backend/app/core/_auth/principal.py` (68), `dependencies.py` (39), `exception_handlers.py` (35)
- `src/backend/app/core/auth_deps.py`, `src/backend/app/core/authorization_matrix.py` — `require_any`, matrix rows
- `src/backend/app/oauth2/router.py` (722) — `/oauth2/register`, `/oauth2/authorize` (GET/POST), `/oauth2/token`, `/oauth2/introspect`
- `src/backend/app/oauth2/{client_auth,stores,models,errors,metadata_router}.py`
- `src/backend/app/main.py` — router mounting, lifespan

### Tests
- `src/backend/tests/test_login.py`, `test_registration.py`, `test_auth_cookie.py`, `test_authorization_matrix.py`
- `src/backend/tests/conftest.py` — `client`, `db_session` fixtures
- `Grep "oauth2" src/backend/tests` — OAuth2 server tests

## Codebase Sources — codebase-data-model

### Key Files
- `src/backend/app/users/models.py` (92) — `UserProfile` (`email` nullable String(255), `party_id`, `account_user_id`), `UserRole`, `UserRoleType`
- `src/backend/app/users/service.py` (308) — `create_account`, `create_account_and_profile`, `derive_username_from_email`, `_derive_display_name`, `register`, `get_profile_by_account_user_id`
- `src/backend/app/users/schemas.py` (148) — `RegisterRequest`, `normalize_email`
- `src/backend/app/users/router.py` (155) — registration POST, `/api/people/me`
- `src/backend/app/party/models.py`, `service.py` — parties
- `src/backend/app/media/models.py`, `service.py`, `schemas.py` — AVATAR slot, moderation (Google profile picture option)
- `src/backend/app/core/base_model.py` — `BaseEntity`

### Migrations (`src/backend/alembic/versions/`)
- `0001_initial_schema.py`, `0002_seed_dev_users.py`, `0010_seed_dev_user_profiles.py`
- `0011_user_profiles_account_user_id_nullable.py`, `0015_lowercase_user_profile_emails.py`, `0016_unique_user_profile_email.py`
- `0082_media.py`; head = `0106_paid_terms.py`

### Tests
- `src/backend/tests/test_registration.py`, `test_user_profile_birth_year.py`, `test_media_*.py`, `test_party_profile.py`

## Codebase Sources — codebase-frontend

### Key Files
- `src/frontend/src/features/auth/SocialAuthButtons.tsx` (59) — mock Google/Facebook buttons
- `src/frontend/src/features/auth/{LoginForm,RegisterForm,LoginPage,AuthSheet,AuthTabs,AuthLayout,OAuth2AuthorizePage,useAccountGate}.tsx|ts`
- `src/frontend/src/auth/{AuthContext.tsx,AuthGuard.tsx,authPaths.ts,homePath.ts,session.ts}`
- `src/frontend/src/proxy.ts` (71) — `PROTECTED_PREFIXES`, `/` ↔ `/home`, `POST /oauth2/authorize` rewrite
- `src/frontend/src/routing/` — `navigation.tsx`, `documentNavigation.ts`, `ClientOnly.tsx`
- `src/frontend/src/app/` — auth route files (`Glob "src/frontend/src/app/**/login/**"`, `register`, `oauth2`)
- `src/frontend/src/api/` — auth API client (`Grep "auth/login" src/frontend/src/api`)

### Tests
- `src/frontend/src/test/{auth.test.tsx,AuthGuard.test.tsx,session.test.ts,proxy.test.ts,proxyRuntime.test.ts,panelSessionHydration.test.tsx,plugin-sdk-auth.test.ts,SidebarAuthIntegration.test.tsx,ssrSafety.test.tsx}`
- `src/frontend/src/test/renderWithRoute.tsx`, `navigationMock.ts`

## Documentation Sources
- `.maister/docs/INDEX.md`
- `.maister/docs/project/architecture.md`, `.maister/docs/project/tech-stack.md`
- `.maister/docs/standards/backend/security.md` — token sources, JWT claims, OAuth2 server known gaps
- `.maister/docs/standards/backend/{models,migrations,api,plugin-auth}.md`
- `.maister/docs/standards/global/{error-handling,validation,minimal-implementation}.md`
- `.maister/docs/standards/frontend/{components,accessibility,data-fetching}.md`
- `.maister/docs/standards/testing/{backend-testing,frontend-testing}.md`
- `CHANGELOG.md`, `README.md`, `src/frontend/README.md`

## Configuration Sources — config-deploy
- `src/backend/app/config.py` — `Settings` (pydantic-settings)
- `.env.example` — keys only (JWT_SECRET, JWT_EXPIRATION_MS, CORS_ALLOWED_ORIGINS, DATABASE_URL, SPACES_*, ..., NEXT_PUBLIC_GOOGLE_MAPS_API_KEY); no GOOGLE OAuth keys yet
- `docker-compose.yml` — services postgres, backend, matcher, web, frontend
- `src/frontend/nginx.conf` — :5174 routing to web/backend
- `src/frontend/next.config.ts` — rewrites to `BACKEND_INTERNAL_URL`
- `src/backend/pyproject.toml`, `src/backend/uv.lock` — deps (pyjwt>=2.13, httpx, bcrypt; no google-auth/authlib)
- `src/backend/Dockerfile`, `src/frontend/Dockerfile`, `src/frontend/package.json`
- `src/frontend/src/app/layout.tsx`, `src/frontend/src/lib/googleMaps.ts` — existing Google script loading pattern (Maps) relevant to CSP/script loading

## External Sources — external-google
- Google OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Google discovery document: https://accounts.google.com/.well-known/openid-configuration
- Google Identity Services (Sign in with Google): https://developers.google.com/identity/gsi/web/guides/overview
- Verify ID token server-side: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- FedCM migration: https://developers.google.com/identity/gsi/web/guides/fedcm-migration
- OAuth 2.0 for web server apps: https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth consent screen / app verification: https://support.google.com/cloud/answer/13463073
- Sign in with Google branding guidelines: https://developers.google.com/identity/branding-guidelines
- OpenID Connect Core 1.0: https://openid.net/specs/openid-connect-core-1_0.html
- RFC 9700 OAuth 2.0 Security BCP: https://www.rfc-editor.org/rfc/rfc9700
- RFC 7636 PKCE: https://www.rfc-editor.org/rfc/rfc7636
- OWASP Authentication / OAuth cheat sheets: https://cheatsheetseries.owasp.org/
- PyJWT `PyJWKClient`: https://pyjwt.readthedocs.io/en/stable/usage.html#retrieve-rsa-signing-keys-from-a-jwks-endpoint
- google-auth `id_token.verify_oauth2_token`: https://googleapis.dev/python/google-auth/latest/reference/google.oauth2.id_token.html
- Authlib Starlette/FastAPI client: https://docs.authlib.org/en/latest/client/starlette.html
