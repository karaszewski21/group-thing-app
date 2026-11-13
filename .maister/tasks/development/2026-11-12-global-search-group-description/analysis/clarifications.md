# Phase 1 Clarifications

## TL;DR
Group description uses existing synchronous text moderation (no pending state). "Szukam" ranking rule deferred; empty-state button links to /add/hunting?name=<q>. "My groups" = standing member or current organizer of a non-deleted group, and this becomes THE single definition (`my_group_ids(user)`) replacing the five existing ones. /search opens to guests via GET /api/public/search.

## Key Decisions
- Moderation: synchronous `check_text(TextField.GROUP_DESCRIPTION, ...)` — stored = approved; no "w moderacji" badge; Product "moderated != true" filter is moot (all stored text approved).
- Szukam: ranking rule (1) deferred to backlog; "Dodaj do listy 'szukam'" navigates to `/add/hunting?name=<q>` (prefill, no write).
- My groups: member OR current organizer, non-deleted groups; RSVP and family memberships do NOT count. **User requirement: replace the five existing membership definitions with one function `my_group_ids(user)` and use it in `visible_to` — no sixth definition.**
- Guest access: remove /search from PROTECTED_PREFIXES, anonymous branch in PanelGate, endpoint `GET /api/public/search` (existing PUBLIC matrix row). Guests: scope forced to "wszędzie", scope toggle hidden.

## Open Questions / Risks
- Unifying five membership definitions may change semantics of existing lists (role_type filters, GroupRole.valid_to, deleted groups, family inclusion in `member_group_ids_query`). Gap analysis must enumerate each consumer and the behaviour delta.

## Q&A

1. **Moderacja opisu grupy** — Q: sync vs new async state? — A: **Synchronicznie (Rekomendowane)**.
2. **Lista „szukam”** — Q: defer vs build backend? — A: **Odłożyć (Rekomendowane)**.
3. **„Moje grupy”** — A (verbatim): "1 — członek lub organizator. I ważniejsze od wyboru: ta jedna definicja ma stać się jedyną — zadanie powinno zastąpić pięć istniejących definicji jedną funkcją my_group_ids(user) i użyć jej w visible_to. Inaczej za pół roku będziesz mieć szóstą."
4. **Dostęp gościa** — A: **Odblokować /search (Rekomendowane)**.
