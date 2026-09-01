"""seed dev users

Adds three development login accounts (viewer/editor/admin) mirroring the
real Liquibase changelog 008's username/permission structure, which was
unavailable during the original Java->Python schema-reconstruction (see
migration task work-log.md). The original Liquibase bcrypt hashes are
one-way and their plaintext passwords are unknown/unrecoverable, so this
migration issues NEW passwords instead of reusing those hashes:

    viewer / viewer123   (READ)
    editor / editor123   (READ, EDIT)
    admin  / admin123    (READ, EDIT, PLUGIN_MANAGEMENT)

Dev-only seed data, no schema change.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (username, bcrypt hash, permissions) — passwords documented in the module
# docstring above; hashes generated via this backend's own
# app.core.security.hash_password (bcrypt, gensalt default cost).
_USERS: list[tuple[str, str, list[str]]] = [
    ("viewer", "$2b$12$JoTjBGCQy1Ic7.vSmohyBela3Y5ke.qgRzNUWWYzF.Aa8ZEFEI1au", ["READ"]),
    (
        "editor",
        "$2b$12$AtydIUDGCRBrtNVbHy.v0.CJ9qU8IS4JthndcVetGZ7WthI8RPYlS",
        ["READ", "EDIT"],
    ),
    (
        "admin",
        "$2b$12$2mbgr6RbRaM1xB5Rx809Se1TrtyHk6aVIYdb.yafhZlSCzxcBOYoe",
        ["READ", "EDIT", "PLUGIN_MANAGEMENT"],
    ),
]


def upgrade() -> None:
    for username, password_hash, permissions in _USERS:
        op.execute(
            sa.text(
                "INSERT INTO users (username, password_hash, created_at, updated_at) "
                "VALUES (:username, :password_hash, now(), now()) "
                "ON CONFLICT (username) DO NOTHING"
            ).bindparams(username=username, password_hash=password_hash)
        )
        for permission in permissions:
            op.execute(
                sa.text(
                    "INSERT INTO user_permissions (user_id, permission) "
                    "SELECT u.id, :permission FROM users u "
                    "WHERE u.username = :username "
                    "AND NOT EXISTS ("
                    "  SELECT 1 FROM user_permissions p "
                    "  WHERE p.user_id = u.id AND p.permission = :permission"
                    ")"
                ).bindparams(username=username, permission=permission)
            )


def downgrade() -> None:
    for username, _password_hash, _permissions in _USERS:
        op.execute(
            sa.text(
                "DELETE FROM user_permissions "
                "WHERE user_id = (SELECT id FROM users WHERE username = :username)"
            ).bindparams(username=username)
        )
        op.execute(sa.text("DELETE FROM users WHERE username = :username").bindparams(username=username))
