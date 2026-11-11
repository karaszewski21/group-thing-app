# Scope Clarifications (Phase 2)

## TL;DR
Scope is not expanded: a behaviour-preserving extraction plus a boundary guard test and three small pre-existing cleanups. All five important decisions from the gap analysis were answered with the recommended option.

## Key Decisions
- Add a boundary guard test (one file, 2 AST-scan tests): nothing under `app/` except `app/main.py` imports `app.pages`; pages modules outside `infrastructure/` import only shared kernels and `app.pages` — the rule is the purpose of the extraction and there is no import-linter.
- `groups.service` exports only what pages calls (`listed_items` and the counts function under a public name), not `owner_summary`/`count_owner_items` — no exports without a consumer.
- `resolve_viewer_party_id` is exported through `groups.service` — one line, no third copy, stays next to `load_reserved_by_names`.
- `get_organization_by_slug` and `get_owner_party_id` are removed from `groups/infrastructure/organizations_acl.py`; the 2 tests in `tests/test_organizer_bridges.py` point at `app.pages.infrastructure.organizations_acl` — no code that only tests call.
- Three pre-existing cleanups are in scope: delete dead `repository.party_leads_public_circle`, delete dead `events_acl.has_authored_event` (and its `__all__` entry), add `GET /api/public/parties/{party_id}` to the personalised routes in `architecture.md`.

## Open Questions / Risks
- The diff is no longer a pure move (two dead-function deletions); reviewers should expect them.

## Phase gate
Question: continue to Phase 5 (requirements and specification)? Answer: yes.
Phases 3 (TDD red) and 4 (UI mockups) do not apply: `has_reproducible_defect` and `ui_heavy` are false. `e2e_enabled` and `user_docs_enabled` are false.
