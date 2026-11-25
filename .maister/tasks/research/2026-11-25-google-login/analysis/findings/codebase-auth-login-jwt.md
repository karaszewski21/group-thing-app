# Codebase: backend login, registration, JWT and token sources

## TL;DR
- Today a session is one HS256 JWT `{sub: <users.username>, permissions: [...], iat, exp}` returned as `{"token": "..."}` by `POST /api/auth/login` and as `{"token", "party_id", "role"}` (201) by `POST /api/auth/register`. Nothing else is state: no sessions table, no revocation.
- Identity resolution is username-only: `Principal.username` = JWT `sub` → `User.username` → `UserProfile.account_user_id`. A Google login only has to end in the same `encode_login_token(user.username, permissions, ...)` call to be indistinguishable downstream (cookie, `/oauth2/authorize`, plugins, `/api/people/me`).
- Google login plugs in as a new public `POST /api/auth/google` (matrix row next to rows 6/47) whose "existing user" branch reuses `_load_permissions` + `encode_login_token` and whose "new user" branch reuses `register()`'s body minus the password (`create_account` currently requires a password and hashes it, `users.password_hash` is NOT NULL).
- `pyjwt` is present but `cryptography` is not in `uv.lock`, so RS256 verification of Google ID tokens needs `pyjwt[crypto]` (or another library) — a new dependency either way.

## Key Decisions
- Reuse `encode_login_token` and the `LoginResponse`/`RegisterResponse` shapes — every consumer (frontend session, cookie, OAuth2 consent `_token`, plugin SDK) keys off `token` alone; a different shape or a second token type would fork all of them.
- Do not put Google tokens in the aj session — the Google ID token is verified once at the endpoint and discarded; the aj JWT stays HS256 over `JWT_SECRET`.
- New route must be listed in `AUTHORIZATION_MATRIX` as PUBLIC before row 25's catch-all, or `require_any()` semantics/tests will treat it as AUTHENTICATED.

## Open Questions / Risks
- No password column alternative: `create_account(db, username, password)` always bcrypt-hashes (`app/users/service.py:46-47`); Google-only users need either a nullable `password_hash` (login must then treat NULL as "no password" before `bcrypt.checkpw`, which would raise on `None.encode`) or an unguessable random hash. Owned by the data-model gatherer.
- `POST /api/auth/login` returns the same 401 for "unknown email" and "wrong password" (`app/auth/router.py:70-81`). A Google-only account hitting the password form will also get 401 — UX copy needed, but must not leak "this email uses Google".
- No rate limiting on `/api/auth/login` or `/api/auth/register` (grep of `app/auth`, `app/users/router.py` finds none) — a Google endpoint inherits that gap.
- Tokens are not revocable and carry no account id/status; deleting or unlinking a Google identity does not end live sessions before `exp` (default 1 h, `app/config.py:27`).
- Registration requires `role: "GUEST" | "ORGANIZER"` (`app/users/schemas.py:132`); a Google sign-up must carry this choice too (or default GUEST) to keep `RegisterResponse.role` meaningful.

---

## 1. Login endpoint

**Source**: `src/backend/app/auth/router.py:28-87` — confidence High (100%)

```python
router = APIRouter(prefix="/api/auth", tags=["auth"])          # :28

class LoginRequest(BaseModel):                                  # :33-43
    email: str = Field(min_length=1)
    password: str = Field(min_length=1)
    # field_validator -> normalize_email(value)

class LoginResponse(BaseModel):                                 # :46-47
    token: str

async def _load_permissions(db, user_id) -> list[str]:          # :50-54
    select(user_permissions.c.permission).where(user_permissions.c.user_id == user_id)

@router.post("/login", response_model=None)                     # :57
async def login(body, db):
    profile = select(UserProfile).where(UserProfile.email == body.email)   # :59-61
    if profile is not None and profile.account_user_id is not None:        # :67
        user = await db.get(User, profile.account_user_id)
    if user is None or not verify_password(body.password, user.password_hash):  # :70
        return JSONResponse(401, ErrorResponse(status=401, error="Unauthorized",
                            message="Invalid username or password"))       # :76-81
    permissions = await _load_permissions(db, user.id)                     # :83
    token = encode_login_token(user.username, permissions,
                               settings.jwt_secret, settings.jwt_expiration_ms)  # :84-86
    return LoginResponse(token=token)                                      # :87
```

Facts:
- Lookup is by **email on `UserProfile`**, not on `User` (`User` has only `username` + `password_hash`, `app/auth/models.py:46-50`). Email is normalised by `app/users/schemas.py::normalize_email` (shared with registration).
- Family-member profiles with `account_user_id IS NULL` cannot log in (`router.py:63-68`). A Google login must apply the same rule (a matching email on a login-less profile is not an account).
- Error envelope: `ErrorResponse` `{status, error, message, fieldErrors, timestamp}` (`app/core/errors.py:22-30`).

**What a Google endpoint must return to match**: HTTP 200 + `{"token": "<aj JWT>"}` for an existing account; for a newly created account, either the same 200 body or the registration body `{"token", "party_id", "role"}` with 201 (`app/users/schemas.py:145-148`). The frontend only needs `token`; returning `RegisterResponse`-compatible fields on creation keeps the onboarding (`role == "ORGANIZER"` → circle wizard) working — confirm with the frontend gatherer's findings.

## 2. Registration endpoint and account creation

**Source**: `src/backend/app/users/router.py:41-51` — High

```python
@router.post("/api/auth/register", response_model=RegisterResponse, status_code=201)
async def register(body: RegisterRequest, db: DbSession) -> RegisterResponse:
    user, party_id = await service.register(db, body)
    token = encode_login_token(
        user.username, ["READ", "EDIT"], settings.jwt_secret, settings.jwt_expiration_ms
    )
    return RegisterResponse(token=token, party_id=party_id, role=body.role)
```

Note: the register route lives in `app/users`, not `app/auth`, but shares the `/api/auth` prefix.

**Source**: `src/backend/app/users/service.py:268-308` (`register`) — High
Sequence: duplicate check on `UserProfile.email` → `DuplicateEmailException` (Polish "Ten email jest już zarejestrowany, zaloguj się", `:38-43`) → `derive_username_from_email` (`:241-258`, local-part sanitised to `String(50)`, numeric suffix on collision) → `_derive_display_name` (`:261-265`) → `create_account_and_profile` → optional `UserRole(ORGANIZATOR)` → `create_solo_family_for_party` → `db.commit()`.

**Source**: `src/backend/app/users/service.py:46-81` — High

```python
async def create_account(db, username: str, password: str) -> User:      # :46
    user = User(username=username, password_hash=hash_password(password))  # :47
    ... inserts READ and EDIT into user_permissions                        # :50-53

async def create_account_and_profile(db, username, password, display_name, email):  # :57
    user = await create_account(db, username, password)
    party = await create_party(db, PartyType.PERSON)
    profile = UserProfile(party_id=..., account_user_id=user.id, display_name=..., email=email)
    UserRole(role_type=UserRoleType.USER, valid_from=date.today())        # :72-77
```

Other callers of `create_account_and_profile` (all pass a password): `app/families/bootstrap.py:58`, `app/families/guardians.py:32`. Changing the signature (e.g. `password: str | None`) touches these three call sites.

Reuse plan for Google sign-up: the Google branch can call a variant of `register()` with the verified Google email, deriving `username`/`display_name` the same way (or `display_name` from the Google `name` claim), granting the same READ/EDIT, creating the solo family — everything except the password hash. `display_name` from `_derive_display_name(email)` is a fallback; Google `name`/`given_name` would be better (Medium — product decision).

## 3. JWT encode / decode and claim shape

**Source**: `src/backend/app/core/security.py:39-66` — High

```python
def encode_login_token(username, permissions, secret, expiration_ms) -> str:   # :39
    claims = {"sub": username, "permissions": list(permissions),
              "iat": issued_at, "exp": issued_at + expiration_ms // 1000}      # :49-54
    return jwt.encode(claims, key=decode_base64_hmac_key(secret), algorithm="HS256")

def decode_token(token, secret) -> dict:                                       # :58
    return jwt.decode(token, key=decode_base64_hmac_key(secret), algorithms=["HS256"])
```

- `JWT_SECRET` is base64-decoded before use (`:28-36`). Expiry `settings.jwt_expiration_ms` default 3 600 000 ms (`app/config.py:27`).
- `decode_token` is pinned to `algorithms=["HS256"]` and to the aj secret — it **cannot** and must not be reused to verify Google ID tokens (RS256, Google JWKS). A separate verifier is required.
- Claim order is documented as significant (`:42-46`); a Google login must not add claims (e.g. `provider`) unless all readers are checked — `get_current_principal` ignores extra claims, so adding is safe but unnecessary.

**Dependencies** (`src/backend/pyproject.toml:12-21`): `pyjwt>=2.13.0`, `bcrypt`, `python-multipart`, `httpx>=0.27`. `grep -i cryptography uv.lock` → no match, so `PyJWKClient`/RS256 (`jwt.algorithms.RSAAlgorithm`) is not installable today without `pyjwt[crypto]`. `httpx` is available for a server-side code exchange against Google's token endpoint. High.

## 4. Token sources and Principal

**Source**: `src/backend/app/core/_auth/token.py:10-49` — High

Order in `_extract_token`:
1. `Authorization: Bearer <token>` (`:24-26`)
2. `_token` query param (`:28-30`)
3. `_token` form field when content-type contains `form` (`:32-46`) — for the OAuth2 consent form POST
4. `auth_token` cookie on GET/HEAD only (`:15`, `:48-49`; `AUTH_COOKIE_NAME = "auth_token"` `:11`)

Implication: the backend never sets the `auth_token` cookie — the frontend writes it (JS-readable). A Google callback handled by the backend with a `Set-Cookie` would be a new pattern; returning the token as JSON to the frontend (like login) keeps the single writer in `auth/session.ts`. Note also the `_token` query fallback: a Google redirect landing on a URL must never carry the aj token in the query string, since that is an accepted credential source and would leak through history/logs.

**Source**: `src/backend/app/core/_auth/principal.py:20-64` — High

```python
@dataclass(frozen=True, slots=True)
class Principal:
    username: str
    authorities: frozenset[str]          # "PERMISSION_" + each permission/scope

async def get_current_principal(request) -> Principal | None:   # :35
    token = await _extract_token(request)
    claims = decode_token(token, settings.jwt_secret)             # :48 (None on PyJWTError)
    username = claims.get("sub")                                  # :52
    permissions = claims.get("permissions") or fallback claims.get("scopes", [])  # :56-58
```

- No DB lookup per request — a token for a deleted/disabled user stays valid until `exp`.
- Downstream code resolves the caller via `User.username == principal.username` (`app/users/service.py:84-106`, `get_profile_by_principal`, `find_party_id_by_principal`). Hence `sub` must be the aj `users.username`, never the Google `sub`.

**Source**: `src/backend/app/core/_auth/dependencies.py:21-39` — `require_any(*names)`: None → `AuthenticationRequiredException` (401 "Authentication required", `exception_handlers.py:15-17`), missing authority → `AccessDeniedException` (403). High.

## 5. Authorization matrix

**Source**: `src/backend/app/core/authorization_matrix.py` — High
- Row 6: `(POST, ^/api/auth/login$, PUBLIC)` — `:43`
- Row 47: `(POST, ^/api/auth/register$, PUBLIC)` — `:183`, appended late with the comment `:179-182` explaining why it was not inserted next to row 6 (to avoid renumbering).
- Row 10 (resolved GET-only): `(GET, ^(?!/api/).*$, PUBLIC)` — `:56`; any GET outside `/api/` (e.g. a frontend `/auth/google/callback` page, or a backend `GET /oauth2/...`-style redirect route not under `/api/`) is PUBLIC by this row.
- Row 25 catch-all `(None, ^.*$, AUTHENTICATED)` — `:270`; `resolve_requirement` first-match-wins — `:279-291`.
- The matrix is documentation + test oracle; enforcement is per-route (`require_any(...)` or none for PUBLIC). Test: `tests/test_authorization_matrix.py`.

Plug-in: add e.g. `(_methods("POST"), r"^/api/auth/google$", "PUBLIC")` next to row 47 (and a GET start route if the server-side code flow is chosen, e.g. `GET ^/api/auth/google/(start|callback)$` PUBLIC — under `/api/` those GETs are *not* covered by row 10 and would otherwise fall to row 25). Add a matrix test row.

## 6. Where a Google login endpoint plugs in

Recommended location: `app/auth/router.py` (same router, prefix `/api/auth`) or a sibling `app/auth/google.py` router included in `app/main.py:287` next to `auth_router`. Flow inside the handler:

1. Verify the Google credential (ID token from GIS, or code→token exchange via `httpx`) — `iss`, `aud == GOOGLE_CLIENT_ID`, `exp`, `email_verified`, nonce. New code; nothing to reuse in `app/core/security.py`.
2. Look up the external identity (new table, data-model gatherer) → `User`.
3. Else, by normalised email on `UserProfile` with `account_user_id IS NOT NULL` → linking policy decision (risk: account takeover if linking silently).
4. Else create the account via the `register()` path without a password, `role` from the request (default `GUEST`).
5. `permissions = await _load_permissions(db, user.id)` (`router.py:50-54`; register hard-codes `["READ", "EDIT"]` at `users/router.py:48-50`).
6. Return `encode_login_token(user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms)` as `{"token": ...}` (+ `party_id`, `role` on creation).
7. Errors: reuse the `ErrorResponse` 401 envelope for an invalid Google credential; Polish 409/400 messages for linking conflicts, following `DuplicateEmailException`.

Transaction: `register()` commits itself (`service.py:303`); a Google variant that also inserts an identity row must do it inside the same unit before the commit.

## 7. Existing backend tests

- `tests/test_login.py` — 4 tests (`:11`, `:28`, `:43`, `:61`): success returns `token`, bad password 401, email casing, register-then-login.
- `tests/test_registration.py` — 4 tests (`:19`, `:34`, `:48`, `:67`): 201 + `party_id`/`role`, Polish duplicate message, derived username/display name, ORGANIZER role.
- `tests/test_auth_cookie.py` — cookie honoured on GET only, Bearer wins over cookie, personalised cache headers, `_extract_token` unit tests (`:41-103`).
- `tests/test_authorization_matrix.py` — matrix resolution + an `_oauth_token(username, scopes)` helper (`:102`) that hand-builds `scopes`-shaped tokens.
- Test pattern for Google: monkeypatch/override the verifier dependency (no network), assert the returned `token` decodes to `sub == derived username` and the expected `permissions`, and that the token works on `GET /api/people/me`. Fixtures `client`/`db_session` in `tests/conftest.py`.
