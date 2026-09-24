"""Server-rendered `<head>` meta tags (Open Graph / Twitter Card) for the
two shareable public pages — a circle/term (`/:slug/grupa/:groupId` and
`/:slug/grupa/:groupId/term/:termId`) and an organization
(`/:slug`) — injected into the same built `index.html` shell the SPA
hydrates from.

Link-unfurling bots (Messenger, WhatsApp, Slack, Discord, ...) read only
the raw HTML of the first response and never execute the SPA's JS, so the
real per-page title/description has to be present in that response. A real
browser gets back the exact same `index.html` (same `<script>`/`<link>`
tags Vite emitted) plus these extra `<meta>` tags, and hydrates into the
unchanged `PublicKragGrupyPage`/`PublicOrganizationPage` exactly as before.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

from app.groups.schemas import PublicCircleResponse
from app.organizations.schemas import PublicOrganizationResponse

_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
_INDEX_HTML_PATH = _STATIC_DIR / "index.html"

_TITLE_TAG_PATTERN = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)


def _inject(title: str, description: str) -> str:
    """Reads `index.html` fresh on every call — it's a few KB, and this way
    a redeployed frontend build is picked up without a backend restart."""
    safe_title = html.escape(title)
    safe_description = html.escape(description)
    meta_tags = (
        f'<meta property="og:title" content="{safe_title}">'
        f'<meta property="og:description" content="{safe_description}">'
        '<meta property="og:type" content="website">'
        '<meta name="twitter:card" content="summary">'
        f'<meta name="twitter:title" content="{safe_title}">'
        f'<meta name="twitter:description" content="{safe_description}">'
    )
    document = _INDEX_HTML_PATH.read_text(encoding="utf-8")
    document = _TITLE_TAG_PATTERN.sub(f"<title>{safe_title}</title>", document, count=1)
    document = document.replace("</head>", f"{meta_tags}</head>", 1)
    return document


def render_public_circle_meta(circle: PublicCircleResponse) -> str:
    if circle.term is not None:
        when = circle.term.occurs_on.strftime("%d.%m.%Y")
        description = f"Najbliższy termin: {when}."
        if circle.term.description:
            description += f" {circle.term.description}"
    else:
        description = "Dołącz i zobacz najbliższe spotkania."
    return _inject(circle.name, description)


def render_public_organization_meta(organization: PublicOrganizationResponse) -> str:
    return _inject(organization.name, f"Strona organizacji {organization.name}.")
