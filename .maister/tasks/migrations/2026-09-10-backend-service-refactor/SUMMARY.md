# Workflow Summary — Backend Service Decomposition (DDD / Clean Architecture)

**Type**: architecture migration — strict mechanical decomposition, zero behavior change
**Status**: COMPLETE (Phases 1–5; Phases 6–8 skipped by user — per-commit regression gate served as verification)
**Date**: 2026-09-10
**Branch**: `main` (user: "to nie jest produkcja, wszystko na main")

## What changed

| Vertical | Before | After | Depth |
|---|---|---|---|
| `core/auth_deps.py` | 323 lines, matrix + runtime chain mixed | `_auth/{token,principal,dependencies,exception_handlers}.py` + new `authorization_matrix.py` + flat `auth_deps.py` facade | layered split |
| `families/service.py` | 418 lines, 15 fns, dup guardian check | `bootstrap.py` `repository.py` `guardians.py` `members.py` `primary_contact.py` + flat `service.py` facade; `_require_family_guardian` deduped | layered split |
| `circulation/service.py` | 569 lines | `domain/` (constants, reservation_rules) + `application/` (7 modules) + `infrastructure/` (repository, `ledger.post_circulation` port) + flat `service.py` facade | full DDD |
| `groups/service.py` | 983 lines, the coupling hub | `domain/organizer_slug.py` + `application/` (9 modules) + `infrastructure/` (repository, `circulation_bridge`, `organizations_acl`, `slug_resolver`) + flat `service.py` facade | full DDD |
| `groups/router.py` | 378 lines, 30 routes, one file | `router/` package: `circles.py` `leaderships.py` `memberships.py` `terms.py` `pledges.py` + `__init__.py` | by resource |

Largest in-scope file: **983 → 290** lines (`groups/application/public_view.py`).

## Commits (on `main`)

```
5623352  refactor(core): split auth_deps into _auth/ modules, relocate authorization matrix
617cb1a  refactor(families): split service into cohesive modules behind facade
0b695e2  refactor(circulation): domain/application/infrastructure layers behind service facade
e33cecf  refactor(groups): domain/application/infrastructure layers, ACL modules, drop dead end_group_role
0cefd98  refactor(groups): split router into router/ package by resource
```
(plus `03ac31f` planning artifacts + interleaved `docs(refactor):` tracking commits)

Each is independently `git revert`-able (no schema/data/config/wire changes). Dependency for revert order: TG4a/TG4b depend on TG3's circulation facade — see `analysis/rollback-plan.md`.

## Verification (regression gate, run after every commit)

- `uv run pytest` (Docker + TestContainers PG18, ~113 tests): **113 passed** — unchanged throughout
- `uv run ruff check app`: **2 errors** — both pre-existing E501 in `models.py` files (untouched)
- `uv run mypy app`: **4 errors** — pre-existing baseline set; the 3 in-scope ones (`groups/service.py:612/618/904`) were carried **verbatim** into `groups/application/pledge_fulfillment.py` + `public_view.py`, NOT fixed
- OpenAPI route dump: **101 operations, byte-identical** before vs after (`verification/routes_before.txt` == `routes_after.txt`)
- D1: every surviving `db.commit()`/`db.flush()` preserved in place — circulation 15, groups 21 (= 22 − `end_group_role`'s deleted commit), families 13; **zero** in any `domain/` or `repository.py`
- Cross-vertical imports quarantined: only `groups/infrastructure/circulation_bridge.py` imports `app.circulation`; only `organizations_acl.py` imports `app.organizations`

## Decisions applied (Phase 2 gate)

- **D1** preserve every commit boundary verbatim ("full DDD" = layer structure, not 1-txn-per-use-case)
- **D2** no new characterization tests — mechanical-move discipline only
- **D3** move the triplicated organizer-slug resolver as-is; keep the 500-vs-`None` edge divergence
- **D4/D7** flat `service.py` facade; `ledger.post_circulation` a plain function (no Protocol); layer folder `application/`
- **D5** `groups/router/` package by resource
- **D6** matrix → `app/core/authorization_matrix.py`, test import updated, no facade shim
- **D8** left `groups/schemas.py`'s `ItemCondition` cross-context import

## Deviations from strict verbatim (all behavior-preserving, logged)

1. `_require_family_guardian` (TG2) + `_load_reservation_for_transition` (TG3) — sanctioned dedups
2. TG3 review-correction: reshaped `_load_reservation_for_transition` so each caller keeps `get_reservation` + status guard **before** the item/holder lookup (preserves the original short-circuit order — a re-cancel of a cancelled reservation whose item was later soft-deleted would otherwise have returned 404 instead of 409)
3. TG4a: `groups/application/leaderships.py` merged into `circles.py` — genuine import cycle (`assign_leadership`→`get_group` ↔ circle fns→`_require_active_organizer`); handled by merge per cross-cutting rule 3, no `TYPE_CHECKING` hacks
4. TG4a: `soft_delete_needed_item` + `create_rsvp` attendance queries kept inline (routing to `repository` would force a new `cast()`)
5. `ruff format` whitespace normalization on a handful of moved functions (the old `service.py`/`router.py` were pre-existing format debt); tokens/logic byte-identical

## Follow-ups (NOT done — deferred by decision or discovered)

- [ ] **D3**: consolidate the 3 organizer-slug resolvers into one, choosing the graceful (200-with-null) path — this is a deliberate behavior change, needs its own task
- [ ] **`circulation/domain/balance_state_machine.py`**: extract the inline `InventoryBalance` transition cascades into a pure domain state machine — behavior-risk on D2-untested paths; do after adding characterization tests
- [ ] **Characterization tests** for reservation confirm/cancel/fulfill/swap, `_current_holder_user_id`, double-entry ledger, `POST /api/pledges/{id}/fulfill` + `/sync` — currently zero HTTP coverage
- [ ] **`oauth2/` + `plugin/`** — the two verticals excluded from this pass (oauth2/router.py 722 lines with no service.py, zero tests; plugin/service.py 290, zero tests)
- [ ] **Standards update** (`/maister:standards-update`): the `repository.py` / `application/` / `infrastructure/*_acl.py` per-vertical layering is now demonstrated 4× — worth documenting as a backend standard
- [ ] Pre-existing lint/type debt (out of scope, untouched): 2 E501 in `models.py`, 2 redundant-cast + the `int|None` arg-type errors, 9 `ruff format` files repo-wide

## Next steps

1. Nothing to merge — already on `main`.
2. If any commit misbehaves: `git revert <sha>` (newest-first if reverting circulation, since groups depends on it).
3. Consider the follow-ups above, especially characterization tests before the `balance_state_machine.py` extraction.
