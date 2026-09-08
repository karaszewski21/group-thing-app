"""Slug generation for an Organization's public page
(`domena.pl/<slug>`, see `PublicOrganizationPage` on the frontend).

`RESERVED_SLUGS` is a manually-maintained allowlist of every top-level path
segment the frontend router (`router.tsx`) already owns — an organizer can
never register one of these as their Organization's slug, since the
frontend mounts the public organization page as a catch-all route *after*
every fixed route, so a colliding slug would otherwise be permanently
unreachable (shadowed by the real page). Update this set whenever a new
top-level route is added to `router.tsx`.
"""

from __future__ import annotations

import re
import unicodedata

RESERVED_SLUGS: frozenset[str] = frozenset(
    {
        # Top-level frontend routes (router.tsx) — keep in sync.
        "login",
        "register",
        "oauth2",
        "krag",
        "panel",
        "onboarding",
        "organization",
        "products",
        "plugins",
        "carbon-footprint",
        # Backend/static namespaces and other names that must never be
        # shadowed by a public organization page.
        "api",
        "assets",
        "static",
        "favicon.ico",
        "index.html",
        "admin",
        "app",
        "public",
        "www",
        "mine",
        "",
    }
)

_POLISH_TRANSLATION = str.maketrans(
    "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
    "acelnoszzACELNOSZZ",
)


def slugify(name: str) -> str:
    """Lowercase, ASCII-only, hyphen-separated slug derived from `name`.
    Never returns an empty string (falls back to "organizacja") or a
    reserved word on its own — callers are still responsible for the
    uniqueness/reserved-word collision loop (see
    `service._generate_unique_slug`), since this function has no DB
    access and can't check either."""
    value = name.translate(_POLISH_TRANSLATION)
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "organizacja"
