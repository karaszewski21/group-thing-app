"""`app.families` business logic: Family bootstrapping, guardian
management, and the `is_primary_contact` lifecycle — the identity bridge
`app.groups.service.fulfill_pledge` ultimately resolves through
`app.users.service.get_profile_by_party`.

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express (only a
family's own guardians may add another guardian) live here.

This module is a flat re-export facade over the cohesive sibling modules
(`bootstrap`, `repository`, `guardians`, `members`, `primary_contact`);
`app.families.router` imports every symbol it needs from here."""

from __future__ import annotations

from .bootstrap import bootstrap_family_for_party, create_family, create_own_family
from .guardians import (
    add_guardian,
    build_guardian_responses,
    remove_family_member,
    rename_family,
)
from .members import create_lightweight_members_batch
from .primary_contact import make_primary_contact
from .repository import (
    count_active_child_members,
    get_family,
    list_families_for_guardian_party,
    list_group_memberships_for_family,
    list_guardian_memberships,
)

__all__ = [
    "add_guardian",
    "bootstrap_family_for_party",
    "build_guardian_responses",
    "count_active_child_members",
    "create_family",
    "create_lightweight_members_batch",
    "create_own_family",
    "get_family",
    "list_families_for_guardian_party",
    "list_group_memberships_for_family",
    "list_guardian_memberships",
    "make_primary_contact",
    "remove_family_member",
    "rename_family",
]
