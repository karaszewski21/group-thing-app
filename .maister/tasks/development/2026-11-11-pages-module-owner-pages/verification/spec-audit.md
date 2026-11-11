# Specification Audit: read-only `app/pages` module (public owner pages)

## TL;DR
- Verdict: **pass-with-concerns** (pre-implementation audit). 0 critical, 4 warnings, 7 info.
- The move itself is implementable as written: every name, line reference, caller, ACL source and import path in the spec was checked against the code and is correct.
- All four warnings are in the Verification section and the success criteria, which cannot be met as written (ruff is not clean today, the mypy command has no target, two "returns nothing" searches match text the spec itself creates), plus one lint trap in the domain typing.
- Requirements coverage is complete; no internal contradiction changes behaviour.

## Key Decisions
- No finding is rated critical — nothing in the spec would produce wrong code or a broken tree; the defects are in how success is measured.
- Verification defects are rated warning, not info — success criterion 4 is unachievable without reformatting about 50 unrelated files, which would break the "diff reads as a move" goal.
- Baselines were measured, not taken from the analysis files: OpenAPI (205 components, 7 operationIds), mypy (15 errors in 8 files), ruff (69 errors, 50 unformatted files).

## Open Questions / Risks
- Should ruff be judged as "no new findings against the step-0 baseline", or only on new and touched files? `app/groups/infrastructure/repository.py` is touched and is unformatted today.
- The three stale route docstrings stay verbatim (spec's own open question); the audit agrees this is the only choice consistent with "OpenAPI unchanged except the tag".
- The test suite was not run (audit constraint); statement budgets were checked by reading the code only.

---

## 1. Scope and method

Audited: `implementation/spec.md` against `analysis/requirements.md` and the current tree (`src/backend`, branch `feature/page-media-appearance`). Read-only commands run from `src/backend`: import probes in fresh interpreters, `app.openapi()`, `uv run python -m mypy app`, `uv run python -m ruff check`, `uv run python -m ruff format --check`, one ruff probe on a scratch file. No source or spec file was changed.

## 2. Warnings

### W1. Ruff "clean" cannot be reached — the tree is not clean today
- **Spec**: Verification 3 ("`ruff check` and `ruff format --check` — clean"), Success Criteria 4.
- **Evidence**: `uv run python -m ruff check` → `Found 69 errors` (35 in `app`, 30 in `alembic`, 4 in `tests`). `uv run python -m ruff format --check` → `50 files would be reformatted` (27 in `app`, 13 in `alembic`, 10 in `tests`). None of the 69 check errors is in a file the spec touches. One touched file is unformatted today: `app/groups/infrastructure/repository.py` (the spec deletes `party_leads_public_circle` at 1164-1166 there). Thirteen `app/groups` files are in the unformatted list.
- **Gap**: Unimplementable as written. An implementer either fails the criterion or runs `ruff format` over the tree and adds an unrelated diff to a behaviour-preserving move.
- **Suggested change**: Step 0 also records the ruff baseline (69 / 50). Pass condition: no new `ruff check` finding and no new unformatted file; every new file under `app/pages` and the two new test files pass both commands; `ruff format` is never run on `app/groups/infrastructure/repository.py` or any other file already in the baseline list.

### W2. The mypy command has no target, and "none in a touched file" is false at baseline
- **Spec**: Verification 2 ("`uv run python -m mypy` as the project runs it — … 15, none of them in `app/pages` or in a touched file").
- **Evidence**: `uv run python -m mypy` → `mypy: error: Missing target module, package, files, or command.` (`pyproject.toml:68-73` has no `files`). `uv run python -m mypy app` → `Found 15 errors in 8 files (checked 217 source files)`. One of the 15 is `app/main.py:20` (`apscheduler` import-untyped), and `app/main.py` is touched in step C. The other seven files: `circulation/application/inventory_items.py`, `families/bootstrap.py`, `groups/application/exchange_summary.py` (3), `groups/application/public_view.py` (4), `groups/application/term_item_listings.py`, `organizations/service.py`, `plugin/router.py` (3) — none moved or edited.
- **Suggested change**: "`uv run python -m mypy app` — 15 errors in the same 8 files as the step-0 run; no error in `app/pages`; the only error in a touched file is the existing `app/main.py:20`."

### W3. Two "returns nothing" searches in Verification 5 match text the spec itself produces
- **Spec**: Verification 5 — searches over `src/backend/app` for `_counts(` and for `app.pages` outside `app/pages/`.
- **Evidence**:
  - `_counts(` is a substring of `owner_item_counts(`, the new name the spec gives the function. After the change it appears in `app/groups/application/owner_items.py` (definition and the call in `count_owner_items`) and in `app/pages/application/owner_pages.py` (three calls). Today the only matches are in `owner_items.py` (lines 82, 88, 274, 290, 321).
  - The spec requires the text `app.pages` in four groups places: the `groups/service.py` module docstring ("gains `app.pages` in its list of cross-slice consumers"), the rewritten `owner_items.py` docstring ("through the facade, by `app.pages`"), the `events_acl.py` docstring ("serve `app.pages` through `groups.service`") and the `groups/schemas.py` section comment ("through `app.pages`' ACL").
- **Suggested change**: Search for `\b_counts\(` (word boundary) or for `def _counts`. Replace the `app.pages` text search with "the boundary test `test_appModules_importingPages_onlyMain` passes" (it scans imports, not text), or restrict the search to import lines (`^\s*(from|import)\s+app\.pages` and `from app import pages`).

### W4. `merge_upcoming_dates` typed "with a type variable" fails the project's ruff rules
- **Spec**: Domain table — "Typed with a structural protocol and a type variable".
- **Evidence**: `pyproject.toml:60-63` (`target-version = "py312"`, `select = [..., "UP", ...]`), ruff 0.16.5. A scratch file with `T = TypeVar("T", bound=_HasStartsAt)` and `def merge_upcoming_dates(terms: Sequence[T], events: Sequence[T], limit: int) -> list[T]` gives `UP047 Generic function merge_upcoming_dates should use type parameters`.
- **Suggested change**: State the signature: `def merge_upcoming_dates[D: _HasStartsAt](terms: Sequence[D], events: Sequence[D], limit: int) -> list[D]`, with `_HasStartsAt` a `Protocol` exposing a read-only `starts_at: datetime` property, and the body `sorted([*terms, *events], key=lambda d: d.starts_at)[:limit]`.

## 3. Info

### I1. Test import edits cannot stay on the cited lines
- **Spec**: "Edits to existing tests" — `test_organizer_page.py` line 22, `test_party_profile.py` line 20, `test_organizer_bridges.py` line 17.
- **Evidence**: `tests/test_organizer_page.py:22-29` — the current import sits between `app.core` and `app.groups.models`; `app.pages.domain.page_content` sorts after `app.organizations.page_layouts` (line 29). Ruff rule `I` is enabled and `tests` has only 4 findings today, so a misplaced import shows up as a new `I001`.
- **Suggested change**: Say "replace the import and place it where isort puts it (after the `app.organizations` imports)".

### I2. Two call-site mappings are implied but not written
- **Evidence**: `app/groups/application/organizer_page.py:58, 89, 143, 154, 176` call `owner_items.resolve_organization_owner`, `owner_items.list_owner_recent_items` and `owner_items.list_owner_dates`. The spec's call-site mapping lists only `owner_items.listed_items()`. `app/groups/router/organizer_page.py:80, 100` use `ExchangeMode` as a query-parameter type; the spec does not say where `router/owner_pages.py` imports it from.
- **Suggested change**: Add "`owner_items.<page function>` → `owner_pages.<same name>` (`from . import owner_pages` in `application/organization_page.py`)" and "`router/owner_pages.py` imports `ExchangeMode` from `..infrastructure.groups_acl` at module level (FastAPI resolves the annotation from module globals)".

### I3. Step C and step D disagree on when the clock guard is edited
- **Evidence**: Step C says "update the four test imports"; step D says "extend the clock guard". The four-file table includes `tests/test_domain_clock_guard.py`, whose edit is a `_GUARDED_DIRS` entry (`tests/test_domain_clock_guard.py:28-32`), not an import. Three files have import edits.
- **Suggested change**: Step C: "update the three test imports (`test_organizer_page.py`, `test_party_profile.py`, `test_organizer_bridges.py`)"; step D keeps the guard edit. Success criterion 1: "the three import edits and the `_GUARDED_DIRS` entry".

### I4. Guard test rule 2 — matching and coverage details
- **Evidence**: The rule says each imported module "starts with one of `app.core`, `app.db`, `app.storage`, `app.pages`". A plain string prefix also accepts a module such as `app.dbx` or `app.core_tools`. The rule checks nothing inside `pages/infrastructure/`, so an ACL importing `..schemas` or a second foreign context (both forbidden by `standards/backend/models.md:149`) would pass.
- **Suggested change**: Match whole dotted segments (`name == prefix or name.startswith(prefix + ".")`). Optionally add to the same test: each `pages/infrastructure/<x>_acl.py` imports only `app.<x>` and never `app.pages.schemas`. The allowlist does not flag any import the moved code needs (`app.core.{clock,auth_deps,errors,pagination,cache_headers}`, `app.db`, `app.storage.service` — the same set `app/events/page.py:14-15` and `app/events/router.py:12-15` use).

### I5. The OpenAPI comparison needs an explicit key-order check
- **Evidence**: Verification 4 asks for deep equality "including key order". Python `dict` equality ignores order.
- **Suggested change**: The script additionally asserts `list(before["paths"]) == list(after["paths"])`. Note: `components.schemas` is emitted sorted by FastAPI, so only `paths` order can differ.

### I6. Docstrings of the moved application modules are not specified
- **Evidence**: `app/groups/application/owner_items.py:1-18` (module docstring) names `organization_layout.py` (no such file), `events_acl` and `term_item_listings.py`; the spec rewrites the docstring of the reduced groups file but does not say what `pages/application/owner_pages.py` and `organization_page.py` open with. These docstrings are not published in OpenAPI, so "verbatim" is not required, and `standards/global/commenting.md` asks for present-state docstrings.
- **Suggested change**: One sentence — the two pages application module docstrings are rewritten for the new location (no `organization_layout.py`, `events_acl` → "through `groups_acl`"); function docstrings move verbatim.

### I7. Pre-existing doc inconsistency stays
- **Evidence**: `architecture.md:231` says "always `Vary: Authorization`"; `INDEX.md` and `security.md` say `Vary: Authorization, Cookie`. The spec edits the same sentence (7 → 8 reads) and reports the mismatch as out of scope.
- **Suggested change**: None required; fixing one word in a line already being edited would be cheaper than leaving it.

## 4. Claims verified as correct

| Area | Result | Evidence |
|---|---|---|
| Source line references (RP, AP, OI, GS) | all match | `router/organizer_page.py:31-148`, `application/organizer_page.py:47-201`, `application/owner_items.py:61-366`, `schemas.py:296, 406-608` |
| 17 moved classes + alias; 5 staying | counted, no other type needed | moved classes use only `uuid`, `datetime`, `Literal`, `Annotated`, `Field`, `ExchangeMode`, `ReservedByResponse`, `GroupLayoutMode`, `OwnerSummaryResponse`, `OwnerItemCountsResponse`, `PublicMediaResponse` |
| `Annotated` in `groups/schemas.py` | becomes unused (only use is line 538); `Field` and `Literal` stay used | `schemas.py:9, 538, 613` |
| Facade edits in `groups/service.py` | lines 69-72, 86, 123-132, 133, 169, 200 as stated; 2 removed, 14 added | `service.py` |
| Repository, events ACL, slug resolver, reserved_by targets | exist at the stated lines | `repository.py:1164, 1169, 1174, 1230, 1251, 1308, 1324, 1342`; `events_acl.py:108, 163, 174, 192`; `slug_resolver.py:40`; `reserved_by.py:35, 81` |
| Other importers of removed names | none beyond those the spec lists | `app/`: only `service.py:69`, `router/__init__.py:21, 28`, `item_actions.py:42`. `tests/`: only `test_organizer_page.py:22`, `test_party_profile.py:20`, `test_organizer_bridges.py:17, 100, 101, 114, 138`. No caller of `party_leads_public_circle` or `has_authored_event`; no test calls `service.get_organization_layout` / `get_organization_group_terms`; no test asserts a tag or reads `app.openapi()` |
| ACL lists sufficient for the moved code | yes | every foreign call and annotation in the three moved files maps to a listed re-export |
| ACLs are pure re-exports, no added statement | yes | the three groups wrappers being bypassed are one-line delegations: `groups/infrastructure/organizations_acl.py:28-37`, `locations_acl.py:39-44`, `product_bridge.py:38-41` |
| Foreign sources exist | yes | `organizations/service.py:85, 93, 133`; `users/service.py:143`; `users/profile_layouts.py:16`; `media/service.py:88`; `product/service.py:328`; `locations/service.py:48` |
| No import cycle | each of `app.groups.service`, `app.users.service`, `app.media.service`, `app.product.service`, `app.locations.service`, `app.organizations.service` imports alone in a fresh interpreter; none loads `app.events.service` or `app.main`; only the first loads `app.groups.service` | import probes; `tests/test_event_reservations_migration.py:245-259` stays valid |
| Domain functions preserve behaviour | yes | `owner_items.py:164-191` builds terms then events, stable sort on `starts_at`, slice — identical to `sorted([*terms, *events])[:limit]`; path strings at `owner_items.py:172, 186` and `organizer_page.py:197` equal the two proposed formats |
| OpenAPI baseline | 205 components; the 7 operationIds equal the gap-analysis table; only `app__events__schemas__ReservedByResponse` and `app__groups__schemas__ReservedByResponse` are module-prefixed; no top-level `tags` list | `app.openapi()` run without lifespan |
| `paths` order is kept | the 7 paths are indices 35-41 and are the first `groups`-tagged paths, because `organizer_page.router` is the first include | `groups/router/__init__.py:28`, `main.py:159-160` |
| Step order keeps the tree importable | yes; `_counts` has no caller outside `owner_items.py`; duplicate schema classes in step B are not route-reachable | grep over `app/` |
| Clock guard | text scan for `datetime.now(` / `date.today(`; the moved code contains neither | `tests/test_domain_clock_guard.py:27-45` |
| Statement budgets | 6/14/13/14, 17, 5 as stated | `tests/test_organizer_page_queries.py:30-35` |
| Doc line references | all point at the stated content | `architecture.md:201, 208, 210, 211, 231, 238, 304-306`; `time.md:9`; `INDEX.md:23, 77` |
| OpenAPI script location | works from the task folder; `app` is installed in the project venv | isolated import probe |
| `main.py` import position | `app.pages.router` sorts between `app.outbox` (47) and `app.plugin.router` (48) | `main.py:47-48` |

## 5. Requirements coverage

| Requirement (`analysis/requirements.md`) | Spec | Status |
|---|---|---|
| FR1 seven routes, identical contract and cache headers | Core 1, Technical Approach | covered |
| FR2 OpenAPI unchanged except tag | Core 2, Verification 4 | covered |
| FR3 router before `groups_router`, only `main.py` imports pages | Core 3, Router registration | covered |
| FR4 moved code leaves groups | Core 5, 6; Changes in `app/groups` | covered |
| FR5 statement counts | Core 7 | covered |
| FR6 clock call form and guard | Core 8, test table | covered |
| FR7 boundary test, test import edits | Core 9, Testing Approach | covered |
| FR8 docs | Documentation edits | covered |
| Decisions 1-10 (stay in groups, facade exports, tag, product ACL, wrappers removed, three cleanups) | Core 6, 10, 11; ACL table | covered |
| Layered layout with `domain/`, no placeholder module | Target tree, Domain table | covered (three modules, each with content) |
| No `service.py`, no `models.py` | Target tree | covered |
| No commit, no secrets printed | Core 13, Verification | covered |

## 6. Extra items in the spec (not in requirements)
- The guard also holds `pages/domain/` to "no `app.*` import" — consistent with the requirement's definition of `domain/`.
- `tests/test_pages_domain.py` (3 tests) — follows from extracting two pure functions.
- Adding `app/events` to the guard list in `time.md:9` and `INDEX.md:77` — corrects an omission the guard already covers.

## 7. Recommendations
1. Rewrite Verification 2, 3 and 5 and Success Criterion 4 as in W1-W3 before implementation starts; record the ruff and mypy baselines in step 0 next to `openapi-before.json`.
2. Fix the `merge_upcoming_dates` signature in the spec (W4).
3. Apply the small wording fixes I1-I3 and I5-I6; decide on the optional ACL check in I4.
