# Config & Deploy: Settings, env wiring, origins and redirect URIs for Google login

## TL;DR
- Backend config is one pydantic-settings `Settings` (`src/backend/app/config.py:19-75`); nothing Google-related exists yet. `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` belong there (optional, feature off until both set — same pattern as `photo_storage_configured`), wired through `docker-compose.yml` `backend.environment` like `SPACES_*`.
- Only the client ID may ever reach the browser. If the frontend needs it (GIS button / One Tap), it must be a `NEXT_PUBLIC_GOOGLE_CLIENT_ID` **build arg** exactly like `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (compose `args` → Dockerfile `ARG`/`ENV` → inlined at `next build`); a server-redirect (authorization-code) flow needs no frontend env at all.
- The app is single-origin per environment (dev `http://localhost:5173` via `next dev` rewrites, compose `http://localhost:5174` via nginx, prod = public https host behind an unknown TLS terminator). Route the Google callback under `/api/...` so it reaches the backend in all three without new nginx/Next rules.
- Do **not** derive the redirect URI from request headers with the existing `resolve_base_url`: behind nginx :5174 it yields `http://localhost` (port lost, because nginx forwards `Host $host`). Use an explicit setting (e.g. `PUBLIC_BASE_URL` or `GOOGLE_REDIRECT_URI`).
- Deps: `pyjwt` 2.13.0 and `httpx` 0.28.1 are already locked; `cryptography` is not a top-level dep (needed by `PyJWKClient` for RS256). No CSP is configured anywhere today.

## Key Decisions
- Secrets server-side only — `GOOGLE_CLIENT_SECRET` in backend env (root `.env` → compose interpolation, or `src/backend/.env` for a local uvicorn run); never `NEXT_PUBLIC_*`, never a Docker build arg (build args persist in image metadata).
- Feature flag by presence — `google_login_configured` property mirroring `photo_storage_configured` (`config.py:64-75`) keeps tests and local runs working without a Google project, matching the module docstring's "no secret defaults" rule (`config.py:3-10`).
- Callback path under `/api/` — the only prefix routed to the backend by both nginx (`nginx.conf:37-41`) and Next rewrites (`next.config.ts:8`); `/oauth2/*` is partly owned by Next (consent page) and would need extra rules.
- Explicit public base URL setting — request-derived base URL is wrong behind nginx :5174 and depends on the unknown production proxy.

## Open Questions / Risks
- Production public hostname and TLS terminator are not in the repo (nginx listens on plain :80, `nginx.conf:6`; compose publishes 5174, `docker-compose.yml:88-89`). The production redirect URI and JS origin cannot be written down until the owner names the domain. The terminator must set `X-Forwarded-Proto https` if anything still relies on `resolve_base_url`.
- `cryptography` presence in `uv.lock` not confirmed as a transitive dep (only `httpx`, `pyjwt`, `requests` grepped). `PyJWKClient` + RS256 verification needs it → likely an explicit `pyjwt[crypto]` dependency. Medium confidence.
- Next dev rewrite headers: Next's proxy sets `x-forwarded-host` to the incoming `Host` (`localhost:5173`, port included); whether `x-forwarded-proto/port` also reach the backend on rewrites is not verified (medium confidence). Irrelevant if an explicit base URL setting is used.
- If a CSP is ever introduced, Google Identity Services needs `script-src https://accounts.google.com/gsi/client`, `frame-src https://accounts.google.com/gsi/`, `connect-src https://accounts.google.com/gsi/`, `style-src https://accounts.google.com/gsi/style` (external-google gatherer should confirm); a pure server redirect flow needs none. Architecture already records the Maps CSP caveat (`architecture.md:157`).
- Cross-Origin-Opener-Policy: none set today, so GIS popup mode would not be broken; keep it that way or use `same-origin-allow-popups`.

---

## 1. Backend `Settings`

**Source**: `src/backend/app/config.py:19-78`
```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    jwt_secret: str
    database_url: str
    jwt_expiration_ms: int = 3_600_000
    cors_allowed_origins: str = "http://localhost:5173"
    spaces_endpoint_url: str | None = None
    ...
    spaces_public_base_url: str | None = None
    ...
    @property
    def photo_storage_configured(self) -> bool:
        return all((self.spaces_endpoint_url, ..., self.spaces_public_base_url))
settings = Settings()
```
- Required secrets have no default (loud startup failure); optional integrations are `str | None = None` gated by an "all set" property (lines 30-39, 64-75). Google login fits the optional pattern: `google_client_id: str | None = None`, `google_client_secret: str | None = None`, plus a base-URL/redirect setting and a `google_login_configured` property.
- `env_file=".env"` is relative to the process CWD (`src/backend` for local `uv run uvicorn`); `extra="ignore"` silently drops unknown vars (line 20).
- No public base URL / site origin setting exists. The only URL-ish settings are `cors_allowed_origins` and `spaces_public_base_url`. (`FOOTPRINT_PROBLEM_BASE_URI` is in `.env.example:12` but not read by `Settings`.)

**Confidence**: High.

## 2. `.env.example` (keys only)

**Source**: `.env.example` — keys at lines 2, 5, 8, 12, 15, 19-21, 25-31, 41-57, 63:
`JWT_SECRET, JWT_EXPIRATION_MS, CORS_ALLOWED_ORIGINS, FOOTPRINT_PROBLEM_BASE_URI, DATABASE_URL, FOOTPRINT_AUDIT_RETRY_*, SPACES_ENDPOINT_URL, SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET, SPACES_PUBLIC_BASE_URL, MODERATION_TEXT_ENABLED, MODERATION_TEXT_REJECT_THRESHOLD, MODERATION_MODELS_DIR, MODERATION_IMAGE_ENABLED, EMBEDDINGS_ENABLED, EMBEDDINGS_MODEL_DIR, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- No `GOOGLE_CLIENT_*` keys. Each key has a comment block above it (e.g. lines 59-62 for the Maps key: "referrer-restricted browser key; leave empty for manual mode"). New keys should follow: comment + empty placeholder.
- `.gitignore:11-13` ignores `.env` and `.env.*` except `.env.example`.
- Presence check (no values printed): root `.env` exists, `src/backend/.env` exists, `src/frontend/.env.local` exists (contains a `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=` line); `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` are absent from root `.env`.

**Confidence**: High.

## 3. docker-compose wiring

**Source**: `docker-compose.yml`
- `backend.environment` (lines 31-45): values interpolated from the root `.env`, optional ones defaulted to empty — `SPACES_KEY: ${SPACES_KEY:-}` (line 40). `CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS:-http://localhost:5173}` (line 35). New lines `GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}`, `GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}`, `PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:5174}` go here.
- `web.build.args` (lines 74-75): `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: ${NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:-}` — the only build-time frontend variable. `web.environment` has only `BACKEND_INTERNAL_URL: http://backend:8080` (line 77).
- `frontend` = `nginx:1.27-alpine` with `nginx.conf` mounted, published `5174:80` (lines 84-94). Comment line 82-83: "Single origin: /api, OAuth2 endpoints and /.well-known go to the backend, everything else to `web`."
- `matcher` gets only `DATABASE_URL` (lines 56-65) — unaffected.
- Compose secret `hf_token` (lines 99-101) is a build secret; not a pattern for runtime OAuth secrets.

**Confidence**: High.

## 4. nginx (:5174)

**Source**: `src/frontend/nginx.conf:5-58`
```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
...
location /api/ { client_max_body_size 16m; proxy_pass http://backend:8080; }
location ~ ^/oauth2/(token|register|introspect)$ { proxy_pass http://backend:8080; }
location /.well-known/ { proxy_pass http://backend:8080; }
location / { proxy_pass http://web:3000; }
```
- `$host` is the hostname **without port**, and no `X-Forwarded-Port` is sent. With `X-Forwarded-Proto` set and no port, `resolve_base_url` omits the port (`src/backend/app/oauth2/metadata_router.py:45-62`), so a request to `http://localhost:5174` resolves to `http://localhost`. A Google redirect URI built from it would not match the registered `http://localhost:5174/...` → `redirect_uri_mismatch`. (This already affects the OAuth2 metadata issuer at :5174; out of scope but worth noting.)
- No security headers (CSP, COOP, X-Frame-Options) are set here or in Next (`next.config.ts:19-21` only sets ACAO `*` for `/assets/*`).
- `/oauth2/authorize` (GET page + POST) goes to Next (`nginx.conf:43-47`, `src/frontend/src/proxy.ts:42-45`). A Google callback under `/oauth2/...` would therefore need a new nginx location and a Next rewrite; under `/api/...` it needs neither.
- Rate-limit zone exists only for `/api/public/search` and `/api/categories` (lines 3, 17-29); a login-start endpoint could reuse `limit_req` if abuse is a concern.

**Confidence**: High (nginx `$host` semantics are standard).

## 5. Next.js config, proxy and dev rewrites (:5173)

**Source**: `src/frontend/next.config.ts:3-24`
```ts
const backendUrl = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8080";
const BACKEND_PATHS = ["/api/:path*", "/oauth2/register", "/oauth2/token", "/oauth2/introspect", "/.well-known/:path*"];
async rewrites() { return BACKEND_PATHS.map((source) => ({ source, destination: `${backendUrl}${source}` })); }
```
- In dev (`next dev -p 5173`, `package.json:8`) the browser stays on `http://localhost:5173` and `/api/*` is proxied to the backend on :8080 → single origin in dev too. Rewrites are fixed at build time (`src/frontend/Dockerfile:27-30` comment).
- Next's rewrite proxy sets `x-forwarded-host: req.headers.host` (`node_modules/next/dist/server/lib/router-utils/proxy-request.js:30-40`) → `localhost:5173` including the port, with `changeOrigin: true`.
- `src/proxy.ts` matcher excludes `api/` (`proxy.ts:68-71`), so a `/api/auth/google/callback` 302 from the backend passes straight through; the backend can set `Location` to a front-end page (e.g. a callback page that stores the JWT via `setSession`).
- Protected-route gate redirects guests to `authPath("login", ...)` (`proxy.ts:46-48`) — the Google flow's `next`/return path should reuse that value with the existing open-redirect rules (frontend gatherer).

**Confidence**: High for rewrites; medium for exact forwarded headers on rewrites.

## 6. Dockerfiles

- **Frontend** `src/frontend/Dockerfile:22-25`:
  ```dockerfile
  # Referrer-restricted browser key, inlined into the client bundle at build time; empty = manual mode.
  ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=
  ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  ```
  Precedent for any `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: add `ARG`/`ENV` in the `build` stage and a compose `args` entry. Runtime `web.environment` would **not** work for `NEXT_PUBLIC_*` (inlined at build).
- **Backend** `src/backend/Dockerfile:75-98`: `runtime-dev` and `runtime` both `CMD uvicorn app.main:app --host 0.0.0.0 --port 8080` with no `--proxy-headers/--forwarded-allow-ips`; uvicorn trusts forwarded headers only from 127.0.0.1 by default, so `request.url.scheme` is `http` behind nginx — another reason not to build redirect URIs from the request. No env baked in; all Google settings come at runtime.

**Confidence**: High.

## 7. Dependencies

**Source**: `src/backend/pyproject.toml:6-23`, `src/backend/uv.lock`
- `pyjwt>=2.13.0` (locked 2.13.0, `uv.lock:1357-1358`), `httpx>=0.27` (locked 0.28.1, `uv.lock:716-717`), `bcrypt`, `requests` 2.34.2 transitively (`uv.lock:1490`).
- No `google-auth`, `authlib`, `cryptography` top-level. `pyjwt` is declared without the `[crypto]` extra; RS256 verification of Google ID tokens with `jwt.PyJWKClient` needs `cryptography` → add `pyjwt[crypto]` (one transitive dep) rather than `google-auth`/`authlib`, satisfying the "minimal dependencies" convention. `httpx` (async) is available for the code→token exchange at `https://oauth2.googleapis.com/token`.
- Frontend `package.json:18-29`: no Google auth library; GIS would be a `<script src="https://accounts.google.com/gsi/client">` (no npm dep), loaded lazily like `lib/googleMaps.ts` (`SCRIPT_URL`, `isGoogleMapsConfigured()` reading `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, lines 14, 53-56).

**Confidence**: High for declared deps; medium for `cryptography` absence in the lock.

## 8. CORS

**Source**: `src/backend/app/main.py:272-278`
```python
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_allowed_origins_list,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], allow_headers=["*"], allow_credentials=True)
```
- Default origin `http://localhost:5173` (`config.py:28`, compose line 35). Because every environment is single-origin (browser → same host → `/api`), CORS is not on the path for a Google flow. Google's redirect to the callback is a top-level navigation (no CORS). A GIS ID-token POST from the page to `/api/...` is same-origin. No CORS change needed.

**Confidence**: High.

## 9. Redirect-URI / JavaScript-origin matrix

Assuming the callback is `GET /api/auth/google/callback` (name illustrative). Google requires exact-match redirect URIs incl. scheme/port and allows `http` only for `localhost` (external-google gatherer to confirm; `localhost` and `127.0.0.1` are distinct entries).

| Environment | Browser origin (Authorized JavaScript origin) | Authorized redirect URI | Path to backend | Where secrets live | Frontend client ID (only if GIS used) |
|---|---|---|---|---|---|
| Dev host: `next dev` :5173 + uvicorn :8080 | `http://localhost:5173` | `http://localhost:5173/api/auth/google/callback` | Next rewrite `/api/:path*` → `BACKEND_INTERNAL_URL` (`next.config.ts:8,23`) | `src/backend/.env` (Settings `env_file`) | `src/frontend/.env.local` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (same file holds the Maps key today) |
| Compose: nginx :5174 | `http://localhost:5174` | `http://localhost:5174/api/auth/google/callback` | nginx `location /api/` → `backend:8080` (`nginx.conf:37-41`) | root `.env` → `backend.environment` interpolation | root `.env` → `web.build.args` → Dockerfile `ARG` (rebuild `web` to change) |
| Production (domain TBD, https) | `https://<public-host>` | `https://<public-host>/api/auth/google/callback` | TLS terminator → nginx :80 → backend | server's root `.env` (never in image or repo) | build arg at image build |

- One Google OAuth client (Web application type) can list all dev/compose/prod origins and URIs; a separate client for production is cleaner (prod secret never on dev machines, separate consent-screen verification state). Recommend: one "dev" client with the two localhost entries, one "prod" client.
- `PUBLIC_BASE_URL` per env: `http://localhost:5173` (backend `.env` for host dev), `http://localhost:5174` (compose default), `https://<public-host>` (prod). The backend builds `redirect_uri = f"{PUBLIC_BASE_URL}/api/auth/google/callback"` and uses the same base for the post-login redirect to the frontend page; it must equal the value sent in both the authorize request and the token exchange.
- `CORS_ALLOWED_ORIGINS` default stays `http://localhost:5173`; compose/prod do not need it for this feature.

## 10. Cookie / session interaction relevant to deploy
- Session cookie `auth_token` is set by the frontend (`Path=/; SameSite=Lax`, `Secure` on https) per `architecture.md:41`. A backend-set short-lived `state`/PKCE cookie for the Google round trip must be `SameSite=Lax` (top-level GET return from accounts.google.com is sent with Lax) and `Secure` only when the base URL is https — derive from `PUBLIC_BASE_URL` scheme, not `request.url.scheme` (which is `http` behind nginx, see §6).

**Confidence**: High (cookie semantics), High (code facts).
