"""Renders a mail from its `*.html.j2` + `*.txt.j2` pair.

HTML is autoescaped (bell messages are user text) and every variable is
strict, so a missing value raises instead of rendering a blank; the send job
treats any render error as a permanent `render_error`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from app.config import settings
from app.core import clock
from app.email.models import EmailTemplate
from app.email.rules import CATEGORY_LABELS, KIND_RULES

_environment = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(("html", "html.j2")),
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)

_ACCOUNT_SUBJECTS = {
    EmailTemplate.VERIFY_EMAIL: "Potwierdź swój adres e-mail",
    EmailTemplate.PASSWORD_RESET: "Ustaw nowe hasło",
    EmailTemplate.PASSWORD_CHANGED: "Hasło zostało zmienione",
}


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str


def _first_name(display_name: str | None) -> str:
    words = (display_name or "").split()
    return words[0] if words else ""


def _naive_utc(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value)


def render(template: EmailTemplate, context: Mapping[str, Any]) -> RenderedEmail:
    """`context` carries the template's own values: `kind`, `message`,
    `link_path` and `unsubscribe_token` for a bell; `token` (plus
    `google_only` for a reset) or `changed_at` (naive UTC) for account mail;
    and optionally `display_name`."""
    base_url = (settings.app_public_base_url or "").rstrip("/")
    values: dict[str, Any] = {
        **context,
        "brand": settings.email_from_name,
        "base_url": base_url,
        "settings_url": f"{base_url}/settings",
        # PNG, not the site's webp: Outlook desktop does not render webp.
        "logo_url": f"{base_url}/assets/logo-gooo-email.png",
        "first_name": _first_name(context.get("display_name")),
    }
    if template is EmailTemplate.NOTIFICATION:
        rule = KIND_RULES[context["kind"]]
        values["subject"] = rule.subject
        values["cta_label"] = rule.cta_label
        values["category_label"] = CATEGORY_LABELS[rule.category]
    else:
        values["subject"] = _ACCOUNT_SUBJECTS[template]
    if template is EmailTemplate.PASSWORD_CHANGED:
        local = clock.utc_to_local(_naive_utc(context["changed_at"]))
        values["changed_when"] = clock.format_term_when(local)
    return RenderedEmail(
        subject=values["subject"],
        html=_environment.get_template(f"{template.value}.html.j2").render(values),
        text=_environment.get_template(f"{template.value}.txt.j2").render(values),
    )
