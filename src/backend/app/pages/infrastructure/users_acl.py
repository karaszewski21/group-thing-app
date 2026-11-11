"""Anti-corruption layer over `app.users`: the ONLY `app.pages` module that
imports the users vertical. It loads a party's `UserProfile` (name, bio,
appearance) and resolves the effective profile page layout. It must not
import `..schemas`."""

from __future__ import annotations

from app.users.models import UserProfile
from app.users.profile_layouts import resolve_profile_page_layout
from app.users.service import get_profile_by_party

__all__ = ["UserProfile", "get_profile_by_party", "resolve_profile_page_layout"]
