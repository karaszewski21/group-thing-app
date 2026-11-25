# Codebase: Account Data Model and Registration Internals (current state)

## TL;DR
- An account has three parts: `users` (credentials: `username`, `password_hash` **NOT NULL**), `user_permissions` (READ/EDIT/...), and the `users`-BC profile `user_profiles` (party + `email`, which is the login key). `user_roles` and `parties` hang off the party.
- Login looks up the profile by the lowercased `email`, goes through `account_user_id` to `users`, and checks the password with bcrypt. JWT `sub` = `users.username`. Every principal lookup in the app goes by `User.username == principal.username`.
- `register()` derives `username` and `display_name` from the email, builds Party + Profile + `UserRole(USER)` + solo Family, and commits. That chain can be reused for Google sign-up if the password is made optional.
- The only code that reads a password is `create_account` (hash) and `POST /api/auth/login` (verify). **No password change, password reset, email verification or account deletion exists.** A nullable password touches very little.
- The AVATAR slot (`media`) needs the image bytes and runs its own transaction (`upload_media` starts with `db.rollback()`). Importing a Google picture has to happen after the account commits, and moderation still applies.

## Key Decisions
- Treat `user_profiles.email` as the canonical account email: the login and duplicate checks key on it (`uq_user_profiles_email_lower`), not on `users`.
- Keep JWT `sub` = `users.username` for Google accounts too, because about 20 call sites resolve the principal by username.

## Open Questions / Risks
- No `email_verified` state exists for password accounts. Anyone can register with an email they don't own, so automatically linking a Google identity to an existing password account by email allows pre-account-hijacking (see the proposal file).
- A concurrent duplicate registration passes the app-level check (`service.py:279-283`) and then hits `uq_user_profiles_email_lower` as an IntegrityError, which most likely surfaces as a 500. This is not handled today, and a Google sign-up race would hit the same gap.
- `register` hard-codes `["READ","EDIT"]` in the token (`users/router.py:48-50`), while login reads the permissions from the DB (`auth/router.py:50-54,83`). A Google login has to use the DB path, or admins signing in with Google lose ADMIN.

---

## 1. `users` + `user_permissions` (`app/auth/models.py`)

**Source**: `src/backend/app/auth/models.py:18-50`
```python
class Permission(enum.StrEnum):
    READ = "READ"; EDIT = "EDIT"; PLUGIN_MANAGEMENT = "PLUGIN_MANAGEMENT"; ADMIN = "ADMIN"

user_permissions = Table("user_permissions", Base.metadata,
    Column("user_id", UUID, ForeignKey("users.id", name="fk_user_permissions_user_id_users"), nullable=False),
    Column("permission", String, nullable=False))

class User(BaseEntity):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(72), nullable=False)
```
- Created in `alembic/versions/0001_initial_schema.py:79-102` (`uq_users_username`, `pk_users`). The ids were later converted to UUID in `0041_baseentity_id_uuid.py`.
- `user_permissions` is a plain Core `Table` with no PK, read and written through Core only (`auth/models.py:29-43`).
- `users` holds no email, no names and no provider data. The module docstring says it "owns only login credentials" (`users/models.py:1-4`).
- **Confidence**: High.

### Tables referencing `users.id` (relevant to deletion and merging)
`grep ForeignKey("users.id"`:
- `user_permissions.user_id` (`auth/models.py:39`)
- `user_profiles.account_user_id`, unique (`users/models.py:53-57`; `uq_user_profiles_account_user_id` in `0009_party_bc_split.py:137`)
- `inventories.owner_user_id`, `reservations.reserved_by_user_id`, `reservations.giver_user_id` (`app/inventory/models.py`)
- `media.uploaded_by_user_id` (`media/models.py:73-77`)
- `moderation_decisions.decided_by_user_id` (`app/moderation/models.py`)
- `product_photos.uploaded_by_user_id` (`app/product/models.py`)

None of them has an `ON DELETE` rule, and `architecture.md:340` says **"Account deletion does not exist yet"** (it also notes that `wants.seeker_party_id` has no ON DELETE rule). A new `user_identities` table should get `ON DELETE CASCADE` on `user_id`, so a future deletion feature doesn't have to remember it.

## 2. `user_profiles`, `user_roles` (`app/users/models.py`)

**Source**: `src/backend/app/users/models.py:45-92`
- `UserProfile`: `party_id` NOT NULL FK `parties`; `account_user_id` nullable FK `users` (NULL = a lightweight family member, or an anonymous guest profile, `models.py:58-60`); `display_name String(255)` NOT NULL; `email String(255)` nullable; `birth_year`, `bio`, `page_layout`, `palette_preset`, `primary_color`, `accent_color`.
- `UserRole`: `party_id`, `role_type` (USER | ORGANIZATOR, VARCHAR(20) string enum), `valid_from`, `valid_to` (NULL = active).
- Email uniqueness: `0016_unique_user_profile_email.py:32-40` adds
  ```sql
  CREATE UNIQUE INDEX uq_user_profiles_email_lower ON user_profiles (lower(email)) WHERE email IS NOT NULL
  ```
  after `0015_lowercase_user_profile_emails.py:33-38` lowercased the existing rows (a data-only migration whose downgrade is a no-op).
- `0011_user_profiles_account_user_id_nullable.py:37-46` made `account_user_id` nullable. Its downgrade re-adds NOT NULL and "will fail (as expected/documented)" while NULL rows exist. That is the closest precedent for making `password_hash` nullable, which would need a downgrade that fails or refuses in the same way.
- **Confidence**: High.

## 3. `parties` (`app/party/models.py:40-54`)
`Party(party_type PERSON|ORGANIZATION, active bool)`. It carries no business data. Identity is kept apart from roles and from the profile ("Identity Is Not Role", docstring `:1-13`). An external login identity is a credential, not a party concept, so it belongs beside `users`, not on `parties`.

## 4. Email normalisation (`app/users/schemas.py`)
- `normalize_email(value) = value.strip().lower()` (`schemas.py:26-34`). Its docstring says that every request schema carrying an account email runs it.
- `EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"` (`schemas.py:23`).
- `RegisterRequest {role: Literal["GUEST","ORGANIZER"], email 3..255, password min 1}` (`schemas.py:125-142`). The docstring says the username and display name are derived on the server and never accepted from the client.
- A Google `email` claim has to pass through `normalize_email` before any lookup.

## 5. Registration service (`app/users/service.py`)

| Function | Lines | Behaviour | Google impact |
|---|---|---|---|
| `create_account(db, username, password)` | 46-54 | `User(password_hash=hash_password(password))`, flush, grants READ+EDIT | needs `password: str \| None`, storing NULL when there is none |
| `create_account_and_profile(...)` | 57-81 | User + `Party(PERSON)` + `UserProfile` + `UserRole(USER)`, flush only, the caller commits | reusable; its other callers `families/bootstrap.py:58` and `families/guardians.py:32` always pass a password |
| `derive_username_from_email` | 241-258 | lowercased local part, sanitised by `[^a-zA-Z0-9._-]`, cut to 50, collisions get suffixes 2, 3, ... | reusable as is for Google sign-up |
| `_derive_display_name(email)` | 261-265 | local part title-cased (`jan.kowalski` -> `Jan Kowalski`) | for Google, the `name` claim is the better source, but it must still pass `check_text(TextField.PROFILE_NAME, ...)` like `update_my_profile` (`service.py:116`) and be cut to 255 |
| `register(db, data)` | 268-308 | duplicate check by email -> `DuplicateEmailException` (409, "Ten email jest już zarejestrowany, zaloguj się"), derivations, ORGANIZER role, `create_solo_family_for_party(db, party_id, display_name)` (deferred import against a circular import), commit, returns `(user, party_id)` | the cleanest approach is to factor out a shared `_bootstrap_person_account(db, email, password: str \| None, display_name, role)` used by both `register` and the Google sign-up |

The router (`users/router.py:41-51`) encodes the login token with the hard-coded `["READ","EDIT"]` and returns `RegisterResponse{token, party_id, role}`.

**Role choice**: password registration requires `role` GUEST|ORGANIZER. The Google sign-up flow has to collect it too (for example as a state parameter or a follow-up step), or default to GUEST and let `get_or_create_active_user_role` (`service.py:199-218`) grant ORGANIZATOR later.

## 6. Login (`app/auth/router.py:57-87`)
```python
profile = (await db.execute(select(UserProfile).where(UserProfile.email == body.email))).scalar_one_or_none()
user = None
if profile is not None and profile.account_user_id is not None:
    user = await db.get(User, profile.account_user_id)
if user is None or not verify_password(body.password, user.password_hash):
    ... 401 {"message": "Invalid username or password"}
permissions = await _load_permissions(db, user.id)
token = encode_login_token(user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms)
```
- `verify_password` calls `bcrypt.checkpw(plain.encode(), hashed.encode())` (`core/security.py:23-25`). A `None` hash raises `AttributeError`, which becomes a 500. With a nullable password, the check must short-circuit: `user.password_hash is None` returns the same 401, so the response does not reveal that the account uses Google only.
- `_load_permissions` (`auth/router.py:50-54`) is the function a Google callback should reuse, possibly moved to a shared helper.
- The token claims are `sub, permissions, iat, exp` (`core/security.py:39-55`), and `Principal.username = claims["sub"]` (`core/_auth/principal.py:52-61`). The username resolves the principal in `users/service.py:86,104`, `inventory/application/identity.py:21`, `moderation/service.py:316`, `points/infrastructure/users_acl.py:47` and `product/service.py:274`. A Google account must therefore have a normal `users.username`.

## 7. Every place a password is assumed (complete grep of `app/`)
- `users/service.py:46-47` `create_account`: hash on create
- `auth/router.py:33-35,70` login: request requires `password`, and the bcrypt check
- `users/schemas.py:134` `RegisterRequest.password`
- `families/schemas.py:60,67` with `families/bootstrap.py:58-59` (`create_family`) and `families/guardians.py:32-33` (`add_guardian`): explicitly creating a new guardian account with a username and password. Unaffected, these keep passing a password.
- `oauth2/router.py:166,527` and `oauth2/client_auth.py:76`: OAuth2 **client** secrets, unrelated to user passwords.
- **Absent**: password change, password reset or forgot-password, email verification, account deletion, and the merge of an anonymous profile (`MergeAnonymousProfileRequest` is mentioned only in docstrings `users/schemas.py:30` and `0016:9`; no such class or function exists, and `groups/infrastructure/repository.py:772` `find_profile_by_email` has no callers).
- **Confidence**: High (grep for `password|hash_password|verify_password|password_hash`).

## 8. AVATAR slot (`app/media`)
- `Media(owner_party_id, kind LOGO|AVATAR|COVER|GALLERY, storage_key, size_bytes, content_sha256, status, uploaded_by_user_id NOT NULL FK users, ...)` with `uq_media_owner_party_id_kind_content_sha256` (`media/models.py:31-81`). The table comes from `0082_media.py` (schema only, a plain reverse downgrade at `:90-94`).
- `upload_media(db, storage, owner_party_id, uploaded_by_user_id, kind, data: bytes)` (`media/service.py:305-358`): `await db.rollback()` first, refuses when `storage is None`, sanitises the image and writes two WebP sizes, takes the owner lock, prepares the slot, and commits. The row stays PENDING unless `settings.moderation_image_enabled` is false.
- So an optional "use my Google photo" step means: after the account transaction commits, fetch `picture` over HTTPS (from a Google host only, with size and time limits to avoid SSRF), then call `upload_media(..., MediaKind.AVATAR, bytes)` best-effort, without failing the login. Doing it on first sign-up only keeps it simple. No schema change is needed.

## 9. Tests to extend
`tests/test_registration.py` (4 tests: 201 shape, duplicate Polish message, derived username/display name, organizer role), `tests/test_login.py` (4 tests incl. casing), `test_lightweight_family_members.py`, `test_media_*.py`, `test_party_profile.py`, `test_auth_cookie.py`, `test_authorization_matrix.py` (new public routes need matrix rows).
