"""seed person/family data for dev login accounts

0002 seeded `users` rows (viewer/editor/admin) for login only — no `Party`,
`UserProfile`, `UserRole`, or `Family` was ever created for them, since
those are normally bootstrapped together by `app.users.service.register`.
Without a `UserProfile`, `GET /api/people/me` 404s and `/panel` never
renders for these dev accounts (only for accounts created through the
actual registration form). This migration bootstraps the same shape
`register()` produces for a GUEST — Party(PERSON) + UserProfile +
UserRole(USER) + Family + FamilyRole(GUARDIAN) + FamilyMembership — so the
seeded dev accounts are usable for manual testing without registering a
throwaway account first.

Dev-only seed data, no schema change.

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-07
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (username, display_name, family_name)
_PROFILES: list[tuple[str, str, str]] = [
    ("viewer", "Viewer Dev", "Rodzina Viewer"),
    ("editor", "Editor Dev", "Rodzina Editor"),
    ("admin", "Admin Dev", "Rodzina Admin"),
]


def upgrade() -> None:
    bind = op.get_bind()

    for username, display_name, family_name in _PROFILES:
        already_seeded = bind.execute(
            sa.text(
                "SELECT 1 FROM user_profiles up "
                "JOIN users u ON u.id = up.account_user_id "
                "WHERE u.username = :username"
            ),
            {"username": username},
        ).scalar_one_or_none()
        if already_seeded is not None:
            continue

        user_id = bind.execute(
            sa.text("SELECT id FROM users WHERE username = :username"),
            {"username": username},
        ).scalar_one_or_none()
        if user_id is None:
            continue

        person_party_id = bind.execute(
            sa.text(
                "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                "VALUES (nextval('party_seq'), 'PERSON', true, now(), now()) "
                "RETURNING id"
            )
        ).scalar_one()

        bind.execute(
            sa.text(
                "INSERT INTO user_profiles "
                "(id, party_id, account_user_id, display_name, email, created_at, updated_at) "
                "VALUES (nextval('user_profile_seq'), :party_id, :user_id, :display_name, NULL, now(), now())"
            ),
            {"party_id": person_party_id, "user_id": user_id, "display_name": display_name},
        )

        bind.execute(
            sa.text(
                "INSERT INTO user_roles (id, party_id, role_type, valid_from, valid_to, created_at, updated_at) "
                "VALUES (nextval('user_role_seq'), :party_id, 'USER', CURRENT_DATE, NULL, now(), now())"
            ),
            {"party_id": person_party_id},
        )

        family_party_id = bind.execute(
            sa.text(
                "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                "VALUES (nextval('party_seq'), 'ORGANIZATION', true, now(), now()) "
                "RETURNING id"
            )
        ).scalar_one()

        family_id = bind.execute(
            sa.text(
                "INSERT INTO families (id, party_id, name, created_at, updated_at) "
                "VALUES (nextval('family_seq'), :party_id, :name, now(), now()) "
                "RETURNING id"
            ),
            {"party_id": family_party_id, "name": family_name},
        ).scalar_one()

        family_role_id = bind.execute(
            sa.text(
                "INSERT INTO family_roles (id, party_id, role_type, valid_from, valid_to, created_at, updated_at) "
                "VALUES (nextval('family_role_seq'), :party_id, 'GUARDIAN', CURRENT_DATE, NULL, now(), now()) "
                "RETURNING id"
            ),
            {"party_id": person_party_id},
        ).scalar_one()

        bind.execute(
            sa.text(
                "INSERT INTO family_memberships "
                "(id, from_role_id, to_family_id, is_primary_contact, valid_from, valid_to, created_at, updated_at) "
                "VALUES (nextval('family_membership_seq'), :role_id, :family_id, true, CURRENT_DATE, NULL, now(), now())"
            ),
            {"role_id": family_role_id, "family_id": family_id},
        )


def downgrade() -> None:
    bind = op.get_bind()

    for username, _display_name, _family_name in _PROFILES:
        row = bind.execute(
            sa.text(
                "SELECT up.party_id AS person_party_id, fr.party_id AS guardian_party_id, "
                "fm.to_family_id AS family_id, f.party_id AS family_party_id "
                "FROM user_profiles up "
                "JOIN users u ON u.id = up.account_user_id "
                "LEFT JOIN family_roles fr ON fr.party_id = up.party_id "
                "LEFT JOIN family_memberships fm ON fm.from_role_id = fr.id "
                "LEFT JOIN families f ON f.id = fm.to_family_id "
                "WHERE u.username = :username"
            ),
            {"username": username},
        ).mappings().first()
        if row is None:
            continue

        bind.execute(
            sa.text("DELETE FROM family_memberships WHERE to_family_id = :family_id"),
            {"family_id": row["family_id"]},
        )
        bind.execute(
            sa.text("DELETE FROM family_roles WHERE party_id = :party_id"),
            {"party_id": row["person_party_id"]},
        )
        bind.execute(
            sa.text("DELETE FROM families WHERE id = :family_id"),
            {"family_id": row["family_id"]},
        )
        bind.execute(
            sa.text("DELETE FROM user_roles WHERE party_id = :party_id"),
            {"party_id": row["person_party_id"]},
        )
        bind.execute(
            sa.text(
                "DELETE FROM user_profiles WHERE party_id = :party_id"
            ),
            {"party_id": row["person_party_id"]},
        )
        if row["family_party_id"] is not None:
            bind.execute(
                sa.text("DELETE FROM parties WHERE id = :party_id"),
                {"party_id": row["family_party_id"]},
            )
        bind.execute(
            sa.text("DELETE FROM parties WHERE id = :party_id"),
            {"party_id": row["person_party_id"]},
        )
