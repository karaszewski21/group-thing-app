# Clarifications (Phase 1)

## TL;DR
Groups keeps everything that encodes groups rules or is shared with `item_actions`; `app/pages` becomes a thin read-only composition layer that reaches groups (and, through groups, the events reads) via `pages/infrastructure/groups_acl.py`. The seven routes get the OpenAPI tag `pages`.

## Key Decisions
- `owner_summary`, `count_owner_items`, `_counts`, `listed_items` and their schemas stay in `app/groups` (small application module, exported through `groups.service`) — `item_actions` needs them and groups must not import pages; one source for the item counts.
- The 8 owner-page SQL queries stay in `groups/infrastructure/repository.py`, exported through `groups.service` and reached by pages through its `groups_acl` — groups rules (active organizer, PUBLIC, soft delete) stay with the owner of the tables.
- Pages reads events through `groups.service` exports (`list_upcoming_events_for_parties`, `count_upcoming_authored_events`, `author_slugs`) — smallest change; to be tidied when the `exchange` module is extracted.
- OpenAPI tag of the seven routes changes from `groups` to `pages` — nothing consumes the tag; URLs, operationIds and response shapes stay the same.
- `pages/infrastructure/product_acl.py` is added for item thumbnails (orchestrator assumption, same convention as `events/infrastructure/product_acl.py`) — product was missing from the original dependency list.

## Open Questions / Risks
- Pages reading events via groups is a known detour, accepted for this step.

## Questions and answers

1. **`item_actions` in groups uses `owner_summary` and `count_owner_items`; where do they live?**
   Answer: they stay in groups (recommended option).
2. **Where do the 8 SQL queries over groups tables live?**
   Answer: they stay in groups (recommended option).
3. **Where does pages get the events queries from?**
   Answer: through `groups.service` (recommended option).
4. **OpenAPI tag after the move?**
   Answer: `pages` (recommended option).
