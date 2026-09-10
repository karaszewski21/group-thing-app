"""`AUTHORIZATION_MATRIX`/`resolve_requirement` reproduce spec.md's full
25-entry authorization matrix verbatim, in its exact evaluation order, as a
directly-testable reference: FastAPI has no native path-pattern
security-filter-chain equivalent to wire this table centrally the way Spring
does, so actual enforcement for rows 11-25 still happens per-route via
`require_any(...)` (each router declares the call matching its own row);
rows 1-10 (public) need no dependency at all — that's the FastAPI default.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

# --- Full authorization matrix (spec.md, verbatim, evaluation order) -------

Requirement = Literal["PUBLIC", "AUTHENTICATED"] | tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MatrixEntry:
    methods: frozenset[str] | None  # None = any method
    pattern: re.Pattern[str]
    requirement: Requirement


def _methods(*names: str) -> frozenset[str]:
    return frozenset(names)


# Raw (methods, path-regex, requirement) rows — spec.md's table verbatim,
# kept as plain strings/tuples here so each row fits on one line; compiled
# into `AUTHORIZATION_MATRIX` below.
_RawEntry = tuple[frozenset[str] | None, str, Requirement]

_RAW_MATRIX: tuple[_RawEntry, ...] = (
    (_methods("GET"), r"^/\.well-known/oauth-authorization-server$", "PUBLIC"),  # 1
    (_methods("POST"), r"^/oauth2/register$", "PUBLIC"),  # 2
    (_methods("POST"), r"^/oauth2/token$", "PUBLIC"),  # 3
    (_methods("POST"), r"^/oauth2/introspect$", "PUBLIC"),  # 4
    (_methods("GET"), r"^/api/oauth2/client-info$", "PUBLIC"),  # 5
    (_methods("POST"), r"^/api/auth/login$", "PUBLIC"),  # 6
    (_methods("GET"), r"^/api/health$", "PUBLIC"),  # 7
    (None, r"^/assets/.*$", "PUBLIC"),  # 8
    (None, r"^(/|/index\.html|/[^/]+\.js|/[^/]+\.css|/favicon\.ico)$", "PUBLIC"),  # 9
    # 10 - any path NOT starting with /api/. Spec.md's table literally says
    # method "any", but its own prose note says `/oauth2/authorize` (a POST,
    # non-/api/ path) is deliberately NOT public and needs authentication —
    # a literal "any method" reading of row 10 would swallow it here, before
    # ever reaching row 25, contradicting that note. Resolved as GET-only:
    # this is an SPA-fallback rule (serving index.html to a browser
    # navigating), which is inherently a GET concern; scoping it to GET
    # excludes `/oauth2/authorize` (POST) without needing to special-case
    # that path, and lets it correctly fall through to row 25.
    (_methods("GET"), r"^(?!/api/).*$", "PUBLIC"),
    (_methods("GET"), r"^/api/products(/.*)?$", ("READ", "mcp:read")),  # 11
    (_methods("GET"), r"^/api/footprints/calculations/[^/]+/export$", ("READ", "mcp:read")),  # 12
    (_methods("GET"), r"^/api/plugins$", ("READ",)),  # 13
    (_methods("GET"), r"^/api/plugins/[^/]+$", ("READ",)),  # 14
    (_methods("GET"), r"^/api/plugins/[^/]+/objects(/.*)?$", ("READ",)),  # 15
    (_methods("GET"), r"^/api/plugins/[^/]+/products/[^/]+/data$", ("READ",)),  # 16
    (_methods("POST", "PUT", "DELETE"), r"^/api/products(/.*)?$", ("EDIT", "mcp:edit")),  # 17
    (_methods("PUT", "DELETE"), r"^/api/plugins/[^/]+/objects(/.*)?$", ("EDIT",)),  # 18
    (_methods("PUT", "DELETE"), r"^/api/plugins/[^/]+/products/[^/]+/data$", ("EDIT",)),  # 19
    (_methods("PUT"), r"^/api/plugins/[^/]+/manifest$", ("PLUGIN_MANAGEMENT",)),  # 20
    (_methods("PATCH"), r"^/api/plugins/[^/]+/enabled$", ("PLUGIN_MANAGEMENT",)),  # 21
    (_methods("DELETE"), r"^/api/plugins/[^/]+$", ("PLUGIN_MANAGEMENT",)),  # 22
    # Caller's own Term RSVPs (R10). Declared ahead of the public groups rows
    # and row 26's blanket `^/api/groups(/.*)?$` READ row so the literal
    # `mine/attendances` path matches here. Caller's party is derived from the
    # principal in the route — no ownership check beyond authentication + READ.
    (_methods("GET"), r"^/api/groups/mine/attendances$", ("READ", "mcp:read")),
    # Public circle/term page (`/krag/:groupId/publiczny`) — declared ahead of
    # row 26's blanket /api/groups READ requirement so an anonymous visitor
    # can load it, RSVP, and merge into a real account. Mirrors row 48's
    # placement.
    (_methods("GET"), r"^/api/groups/public/[^/]+$", "PUBLIC"),
    # Stays PUBLIC (no require_any, no reorder): the route optionally honours a
    # valid session token via get_current_principal to attach the RSVP to the
    # caller's account; a missing/invalid/expired token degrades silently to
    # the anonymous path — never a 401.
    (_methods("POST"), r"^/api/groups/public/[^/]+/rsvp$", "PUBLIC"),
    (_methods("POST"), r"^/api/groups/public/merge$", "PUBLIC"),
    # Fine-grained circle rename — declared ahead of row 26's blanket
    # /api/groups READ row and after the /mine + /public rows above, so
    # first-match evaluation reaches it. The active-organizer check lives in
    # `app.groups.service.update_group`; the matrix only gates it to EDIT.
    (_methods("PATCH"), r"^/api/groups/[^/]+$", ("EDIT", "mcp:edit")),
    # 26-47: app.party / app.circulation — added beyond spec.md's original 25
    # rows for the Organizer/Circle/Family + Wypożyczalnia domain. Ownership
    # checks the matrix itself can't express (active organizer, own-family
    # guardian, reservation party, ...) are enforced in each vertical's
    # service.py — see standards/backend/security.md.
    (_methods("GET"), r"^/api/groups(/.*)?$", ("READ", "mcp:read")),  # 26
    (_methods("POST"), r"^/api/groups(/.*)?$", ("EDIT", "mcp:edit")),  # 27
    # Fine-grained families routes — declared ahead of rows 28-29's blanket
    # families requirements, in evaluation order. Idempotent create-own
    # family and the guardian-only rename; the PATCH guardian check itself
    # lives in `app.families.service.rename_family` (raises
    # AccessDeniedException), the matrix only gates it to EDIT.
    (_methods("POST"), r"^/api/families/mine$", ("EDIT", "mcp:edit")),
    (_methods("PATCH"), r"^/api/families/[^/]+$", ("EDIT", "mcp:edit")),
    # Guardian-only soft-close of a family member — declared ahead of rows
    # 28-29's blanket families rows (which only cover GET/POST, so a
    # DELETE would otherwise fall through to row 25's AUTHENTICATED
    # catch-all). The guardian + last-guardian checks live in
    # `app.families.service.remove_family_member`; the matrix gates to EDIT.
    (_methods("DELETE"), r"^/api/families/[^/]+/guardians/[^/]+$", ("EDIT", "mcp:edit")),
    (_methods("GET"), r"^/api/families(/.*)?$", ("READ", "mcp:read")),  # 28
    (_methods("POST"), r"^/api/families(/.*)?$", ("EDIT", "mcp:edit")),  # 29
    (_methods("POST"), r"^/api/leaderships(/.*)?$", ("EDIT", "mcp:edit")),  # 30
    (_methods("POST"), r"^/api/memberships(/.*)?$", ("EDIT", "mcp:edit")),  # 31
    # Fine-grained term / needed-item edit + soft-delete — ahead of the
    # blanket rows below (first-match-wins). Active-organizer checks live in
    # `app.groups.service`; the matrix only gates them to EDIT.
    (_methods("PATCH"), r"^/api/terms/[^/]+$", ("EDIT", "mcp:edit")),
    (_methods("GET"), r"^/api/terms(/.*)?$", ("READ", "mcp:read")),  # 32
    (_methods("POST"), r"^/api/terms(/.*)?$", ("EDIT", "mcp:edit")),  # 33
    (_methods("PATCH", "DELETE"), r"^/api/needed-items/[^/]+$", ("EDIT", "mcp:edit")),
    (_methods("GET"), r"^/api/needed-items(/.*)?$", ("READ", "mcp:read")),  # 34
    (_methods("POST"), r"^/api/needed-items(/.*)?$", ("EDIT", "mcp:edit")),  # 35
    (_methods("GET"), r"^/api/pledges(/.*)?$", ("READ", "mcp:read")),  # 36
    (_methods("POST"), r"^/api/pledges(/.*)?$", ("EDIT", "mcp:edit")),  # 37
    (_methods("GET"), r"^/api/inventories(/.*)?$", ("READ", "mcp:read")),  # 38
    (_methods("POST"), r"^/api/inventories(/.*)?$", ("EDIT", "mcp:edit")),  # 39
    # Fine-grained inventory-item edit + soft-delete — ahead of rows 40-41's
    # blanket inventory-items requirements (first-match-wins). The owner check
    # (`inventory.owner_user_id == acting user`) lives in
    # `app.circulation.service`; the matrix only gates it to EDIT.
    (_methods("PATCH", "DELETE"), r"^/api/inventory-items/[^/]+$", ("EDIT", "mcp:edit")),
    (_methods("GET"), r"^/api/inventory-items(/.*)?$", ("READ", "mcp:read")),  # 40
    (_methods("POST"), r"^/api/inventory-items(/.*)?$", ("EDIT", "mcp:edit")),  # 41
    (_methods("GET"), r"^/api/reservations(/.*)?$", ("READ", "mcp:read")),  # 42
    (_methods("POST"), r"^/api/reservations(/.*)?$", ("EDIT", "mcp:edit")),  # 43
    (_methods("GET"), r"^/api/accounts(/.*)?$", ("READ", "mcp:read")),  # 44
    (_methods("GET"), r"^/api/circulation-transactions(/.*)?$", ("READ", "mcp:read")),  # 45
    (_methods("GET"), r"^/api/people(/.*)?$", ("READ", "mcp:read")),  # 46
    # 47: public self-registration — the party-module counterpart to row 6's
    # `/api/auth/login`. No existing row matches this literal path, so it's
    # appended here rather than inserted next to row 6, to avoid renumbering
    # rows 7-22's original spec.md sequence.
    (_methods("POST"), r"^/api/auth/register$", "PUBLIC"),  # 47
    # Public organizer page (`domena.pl/<slug>`) — declared ahead of row 49's
    # blanket READ requirement so an unauthenticated visitor can load it.
    (_methods("GET"), r"^/api/organizations/public/[^/]+$", "PUBLIC"),  # 48
    (_methods("GET"), r"^/api/organizations(/.*)?$", ("READ", "mcp:read")),  # 49
    (_methods("POST", "PATCH"), r"^/api/organizations(/.*)?$", ("EDIT", "mcp:edit")),  # 50
    (None, r"^.*$", "AUTHENTICATED"),  # 25 - catch-all
)

AUTHORIZATION_MATRIX: tuple[MatrixEntry, ...] = tuple(
    MatrixEntry(methods, re.compile(pattern), requirement)
    for methods, pattern, requirement in _RAW_MATRIX
)


def resolve_requirement(method: str, path: str) -> Requirement:
    """Walks `AUTHORIZATION_MATRIX` in spec.md's exact evaluation order,
    first match wins. Exposed for direct verification and as the single
    source of truth future routers should consult when deciding which
    `require_any(...)` call matches their own route.
    """
    normalized_method = method.upper()
    for entry in AUTHORIZATION_MATRIX:
        if entry.methods is not None and normalized_method not in entry.methods:
            continue
        if entry.pattern.match(path):
            return entry.requirement
    return "AUTHENTICATED"  # unreachable: row 25 matches every path/method
