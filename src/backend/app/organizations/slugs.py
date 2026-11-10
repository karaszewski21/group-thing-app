"""Slug generation for an Organization's public page
(`domena.pl/<slug>`, see `PublicOrganizationPage` on the frontend).

`RESERVED_SLUGS` is a manually-maintained allowlist of every top-level path
segment the frontend route tree (`src/app`, mirrored in
`routing/reservedSlugs.ts`) already owns — an organizer can never register
one of these as their Organization's slug, since the public organization
page is the dynamic `[organizationSlug]` segment and every static segment
wins over it, so a colliding slug would otherwise be permanently
unreachable (shadowed by the real page). Update this set whenever a new
top-level route is added under `src/app`.
"""

from __future__ import annotations

import re
import unicodedata

RESERVED_SLUGS: frozenset[str] = frozenset(
    {
        # Top-level frontend routes (`src/app`, `routing/reservedSlugs.ts`)
        # — keep in sync. "home" is the internal rewrite target of `/` for
        # cookie holders (`proxy.ts`).
        "home",
        "login",
        "register",
        "oauth2",
        "krag",
        "panel",
        "onboarding",
        # Panel sections and the other logged-in pages, mounted at the top
        # level (`/items`, `/messages`, `/groups/:id`, …).
        "meetings",
        "items",
        "podarki",
        "profile",
        "settings",
        "places",
        "family",
        "account",
        "search",
        "wanted",
        "add",
        "messages",
        "groups",
        "events",
        "organization",
        "product",
        "products",
        "categories",
        "moderation",
        "plugins",
        # Second-segment organizer routes (`/:slug/product/:id`,
        # `/:slug/group/...`, `/:slug/event/:id`, `/:slug/terms`) — reserved
        # so an organization slug never reads like one of those path segments
        # ("product" and "terms" are listed elsewhere).
        "group",
        "event",
        # Backend sub-paths under `/api/public/organizers/{slug}` (`/terms`)
        # and `/api/public/groups/{group_id}/access`.
        "access",
        "terms",
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
