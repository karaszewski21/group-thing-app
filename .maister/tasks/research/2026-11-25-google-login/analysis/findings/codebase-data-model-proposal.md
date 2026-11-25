# Codebase: Candidate Schema for External Identities (Google) and Migration Notes

## TL;DR
- Add one new table, `user_identities` (provider, the provider's `sub`, the email as received, `email_verified`, `user_id` FK `users` ON DELETE CASCADE), unique on `(provider, subject)`, in migration **0107** (head is `0106_paid_terms.py`).
- In a separate revision **0108**, make `users.password_hash` nullable. The downgrade refuses while any row has `password_hash IS NULL` (the guarded-downgrade pattern).
- The code that changes is small: `create_account`/`create_account_and_profile` (optional password), the login null-hash short-circuit, a new Google callback service that reuses `derive_username_from_email`, `_load_permissions` and `create_solo_family_for_party`. Nothing else reads a password.
- Link by the stable `sub`, never by the email alone. Automatic linking to an existing password account by email is unsafe, because aj has never verified any email.

## Key Decisions
- Use a separate `user_identities` table, not `users.google_sub` columns. It is provider-generic (Facebook later), keeps `users` for credentials only, and follows the standards' FK, naming and test conventions.
- Put the table in the `auth` module (`app/auth/models.py`), next to `users` and `user_permissions`. It is a login credential, not profile or party data ("Identity Is Not Role", `party/models.py:1-13`).
- `subject` (Google `sub`) is the identity key. The email is stored only as a snapshot for audit and display and is not unique: Google emails can change or be reassigned.
- Schema and nullability go in two revisions, per the "small focused changes, additive first" rule in `migrations.md:46-47,71`.
- JWT `sub` stays `users.username` (derived from the email at sign-up), so no principal-lookup code changes.

## Open Questions / Risks
- **Pre-account-hijacking**: password sign-up never verifies the email. If an attacker pre-registers `victim@gmail.com` with a password and aj automatically links the victim's later Google sign-in to that account, the attacker keeps password access. Options: (a) when the email matches an existing password account, refuse with "log in with your password, then link Google in settings"; (b) link, but set `password_hash = NULL` so only Google works (the attacker is locked out; stateless JWTs already issued stay valid until `exp`); (c) add `user_profiles.email_verified_at` and only auto-link verified ones. This is a product and security decision for the synthesizer. (a) is the safest minimal choice.
- With no password reset, a Google-only user who loses access to Google has no fallback. Acceptable for an MVP, but worth recording.
- `role` (GUEST/ORGANIZER) has to come through the OAuth `state`, or be defaulted to GUEST.
- Concurrent first sign-ins with the same `sub`: `uq_user_identities_provider_subject` plus the profile email index raise an IntegrityError. Map it to a retry or 409 instead of a 500 (the same gap exists in `register`).
- If account deletion is ever built, CASCADE covers `user_identities`. The other `users.id` FKs still have no ON DELETE rule (`architecture.md:340`).

---

## 1. Candidate schema (revision 0107, schema only)

```python
# app/auth/models.py
class IdentityProvider(enum.StrEnum):
    GOOGLE = "GOOGLE"

class UserIdentity(BaseEntity):
    """An external login (OIDC) bound to one `users` row. `subject` is the
    provider's stable `sub`; `email` is the address the provider reported at
    the last sign-in, kept for audit and display, never the lookup key."""
    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
        UniqueConstraint("user_id", "provider", name="uq_user_identities_user_id_provider"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_user_identities_user_id_users", ondelete="CASCADE"), nullable=False)
    provider: Mapped[IdentityProvider] = mapped_column(_enum_column(IdentityProvider, 20), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)  # naive UTC

    def __eq__(self, other): ...  # business key (provider, subject), models.md:187
    def __hash__(self): return hash((self.provider, self.subject))
```

Notes per the standards:
- `BaseEntity` gives a UUID `id` with `gen_random_uuid()`, plus `created_at` and `updated_at` as the version column (`core/base_model.py:41-68`, `models.md`).
- Name everything explicitly: `pk_user_identities`, `fk_user_identities_user_id_users`, `uq_..._provider_subject`, `uq_..._user_id_provider` (one Google per account), and `ix_user_identities_user_id` if lookups by user are needed. The `(user_id, provider)` unique index already covers `user_id` as its leading column (`migrations.md:33-34`).
- String-backed enum through the local `_enum_column` helper (VARCHAR, `native_enum=False`), as in `users/models.py:23-30` and `party/models.py:25-37`.
- `subject` is `String(255)`: Google's `sub` is at most 255 ASCII characters per OIDC. Compare it case-sensitively and never lowercase it.
- `email` is not unique. The canonical account email stays `user_profiles.email` (`uq_user_profiles_email_lower`). Store `normalize_email(claim)` there.
- Optional extra columns (`hd`, `name`, `picture_url`) can be left out per `minimal-implementation.md`, unless the synthesizer wants `hd` for a domain restriction.
- `last_login_at` is optional. Drop it unless there is an audit need.
- The migration test follows `migrations.md:19`, e.g. `tests/test_user_identities_migration.py::test_migration_downgradeTo0106AndUpgradeHead_succeeds`, asserting the table and the named constraints.
- Downgrade: drop the indexes and constraints, then the table. Plain reverse, lossy for links. Guard it (refuse while rows exist), or document that Google-only accounts become unusable. Because 0108 is undone first and refuses while NULL hashes exist, the 0107 downgrade only runs once no Google-only accounts remain. A plain drop is then acceptable: linked password accounts keep working.

## 2. Revision 0108: `users.password_hash` nullable

```python
def upgrade():
    op.alter_column("users", "password_hash", existing_type=sa.String(72), nullable=True)

def downgrade():
    count = op.get_bind().execute(sa.text("SELECT count(*) FROM users WHERE password_hash IS NULL")).scalar_one()
    if count:
        raise RuntimeError(f"{count} accounts have no password (Google-only); delete them or set a password, "
                           "or restore the pre-0108 dump — see architecture.md runbook")
    op.alter_column("users", "password_hash", existing_type=sa.String(72), nullable=False)
```
- Precedents: `0011` (nullable `account_user_id`, an unguarded downgrade that simply fails) and the guarded downgrades of `0073` to `0076` (`migrations.md:11-13`). The guard is better because it names the recovery path, and the runbook in `architecture.md` lists the guard count.
- `ALTER COLUMN ... DROP NOT NULL` is metadata-only and fast, but it takes an ACCESS EXCLUSIVE lock, so add `SET LOCAL lock_timeout = '5s'` (`migrations.md:16`).
- There is no image-only rollback past 0108. An old image would 500 on `verify_password(None)` for Google-only users. Note this in the runbook, along with the usual `pg_dump` first.
- An optional CHECK such as "a password or at least one identity" cannot be expressed across tables. Enforce it in the service (sign-up always writes one or the other).

## 3. Code touch-list

| Area | File:line | Change |
|---|---|---|
| ORM | `app/auth/models.py:50` | `password_hash: Mapped[str \| None]`, `nullable=True`; add `UserIdentity`, `IdentityProvider` |
| Account creation | `app/users/service.py:46-54, 57-81` | `password: str \| None`; `password_hash=hash_password(p) if p else None`; family callers unchanged |
| Registration | `app/users/service.py:268-308` | factor out a shared bootstrap (duplicate check, username, display name, role, solo family) for `register` and the Google sign-up |
| Display name | `app/users/service.py:261-265` | Google: the `name` claim (trimmed, at most 255, `check_text(PROFILE_NAME)`), falling back to `_derive_display_name(email)` when it is blank or rejected |
| Login | `app/auth/router.py:70` | `if user is None or user.password_hash is None or not verify_password(...)` -> the same 401 |
| Permissions | `app/auth/router.py:50-54` | reuse `_load_permissions` in the Google callback (do not copy the hard-coded `["READ","EDIT"]` from `users/router.py:48-50`) |
| Token | `app/core/security.py:39-55` | unchanged; `sub = user.username` |
| Avatar | `app/media/service.py:305` | optional best-effort `upload_media(..., MediaKind.AVATAR, bytes)` after commit, first sign-up only |
| Matrix | `app/core/authorization_matrix.py` | new PUBLIC rows for the Google start/callback routes; a READ/EDIT row for linking and unlinking if built |
| Absent features | — | no password change, reset or deletion code to adapt today; any future password-change feature must allow *setting* a first password when `password_hash IS NULL`, and unlinking must refuse when it would leave the account with no credential |

## 4. Sign-in resolution algorithm (data level)
1. Verify the ID token (external findings). Get `sub`, `email`, `email_verified` and `name`.
2. `SELECT user_identities WHERE provider='GOOGLE' AND subject=:sub`. If found, load `users`, refresh the `email` snapshot and `last_login_at`, issue the token with the DB permissions.
3. Else, if `email_verified` is false, refuse.
4. Else look up `user_profiles` by `normalize_email(email)`:
   - an account profile (`account_user_id` not null) exists: apply the linking policy (see the risks; recommended: refuse with a Polish "log in with your password and link Google" message, or link only from an authenticated session);
   - a profile with `account_user_id IS NULL` exists (a lightweight family member or an anonymous guest): treat it as an email conflict and refuse (the same as `DuplicateEmailException`), because no merge feature exists;
   - none: run the shared bootstrap with `password=None`, insert `user_identities`, commit, issue the token.
5. Map IntegrityErrors on `uq_user_identities_provider_subject` and `uq_user_profiles_email_lower` to a 409 or a re-read.

## 5. Tests (2 to 8 per feature, `backend-testing.md`)
- migration round trips for 0107 and 0108 (with the 0108 refusal while a NULL hash exists, then restoring head in `finally`)
- a Google sign-up creates User (NULL hash) + Identity + Profile + `UserRole(USER)` + solo Family, with exact key sets
- password login for a Google-only account returns 401 (not a 500)
- a returning `sub` signs in with an unchanged username and DB permissions (ADMIN kept)
- an email collision with an existing password account follows the chosen policy
- `email_verified=false` is refused
