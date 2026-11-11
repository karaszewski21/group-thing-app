# Pragmatic Review: `app/pages` module extraction

## TL;DR
- Status: **Appropriate.** Complexity is Medium, which fits a refactor whose layered package and domain layer the user chose explicitly. Nothing in it is speculative: every new export, ACL name and domain function has a caller, and two dead functions plus two ACL wrappers were removed.
- Size: `app/groups` lost 898 lines and gained 70. `app/pages` is about 1,050 lines of source and 139 lines of tests, so the tree grew by about 360 lines. Most of that is module docstrings, ACL boilerplate and the guard test.
- Findings: 0 critical, 2 warnings, 6 info. The main pragmatic cost is ceremony: six re-export ACLs (four of them hold one to three names), two one-line link helpers, and a generic Protocol around a three-line sort. Each is required by the spec, the ACL standard or the user's choice, so none is flagged for removal.
- The warnings: (1) pages reaches straight into groups' SQL. It passes `groups_acl.listed_items()` (a SQLAlchemy `Select`) back into groups queries, and 7 of the 14 new facade exports are raw repository queries. The boundary is real at the import level but leaky at the abstraction level. (2) The three stale route docstrings moved verbatim. One of them now points to a function path that no longer exists.

## Key Decisions
- I judged against the stated user choices: layered packages plus a domain layer, and one ACL per foreign context per `standards/backend/models.md`. I did not judge against a hypothetical "one flat module" design. I only flag ceremony that goes beyond what those choices need.
- I judged the AST guard test as proportionate. The project has no import-linter, and adding one would be a new dependency for a single rule.

## Open Questions / Risks
- Fixing the stale docstrings changes OpenAPI `description`s, which the acceptance rule forbids. That needs a user decision (it is already in the spec's Open Questions).
- The statement budgets hold only while the ACLs stay pure re-exports. A wrapper added to an ACL later would silently add indirection but no statements, so this risk is small.

---

## 1. Complexity Assessment

| Dimension | Observation | Verdict |
|---|---|---|
| Project scale | Early-stage production. It has real business logic, about 80 migrations, runbooks and a microkernel. It is not an MVP. | A layered BC is in line with `app/groups` and `app/events` |
| Layers | router → application → domain / infrastructure(ACL) → groups facade | Matches the existing groups/events layout |
| New modules | 19 (3 empty `__init__`) | Proportionate for 7 routes and 18 schema classes |
| Indirection depth | route → `owner_pages.fn` → `groups_acl.fn` (re-export) → `groups.service` (re-export) → repository | 2 pure re-export hops, no runtime cost; costs one extra "go to definition" |
| Infrastructure | none added (no DB, cache or dependency) | Good |

Overall complexity: **Medium, appropriate**.

## 2. Key Issues Found

### Warning

**W1. Pages composes groups SQL directly instead of consuming groups reads** (fixable: yes, out of this task's scope)
- Location: `src/backend/app/pages/application/owner_pages.py:79-80` and `src/backend/app/pages/application/organization_page.py:65-66` (`groups_acl.list_owner_listed_items_page(db, party_id, groups_acl.listed_items(), mode, …)`, `count_owner_available_items_by_mode(db, owner_party_id, groups_acl.listed_items())`). Source: `src/backend/app/groups/application/owner_items.py:21` (`def listed_items() -> Select[Any]`).
- Problem: `listed_items()` returns a raw SQLAlchemy `Select` that pages hands back to two groups repository functions. Seven of the 14 new `groups.service` names are repository-level queries (`count_owner_*`, `list_owner_*`, `list_group_upcoming_terms`, `list_upcoming_public_terms_for_party`). The `app.pages` import boundary is enforced, but pages still knows how groups builds its queries. That is the coupling the module boundary is meant to hide.
- Impact: low today, because the refactor is a move. A future change to the groups listing select has to be traced through pages call sites.
- Suggestion: no change in this task (the spec deliberately keeps "no wrapper, no extra statement"). If it becomes painful later, fold the select into the groups functions, for example `list_owner_listed_items_page(db, party_id, mode, offset, limit)` building `listed_items()` internally. That would remove `listed_items` from the facade and the ACL. Effort: about 30 min.

**W2. Stale route docstrings moved verbatim, one now names a non-existent path** (fixable: yes, needs user consent because OpenAPI descriptions change)
- Location: `src/backend/app/pages/router/owner_pages.py`
  - `get_organization_owner_items`: "404 as for `get_organizer_page`" (no such function).
  - `get_party_owner_items`: "matched by the PUBLIC row `GET ^/api/public/` PUBLIC row" (garbled).
  - `get_party_profile`: "see `owner_items.get_party_profile`". The function is now `owner_pages.get_party_profile`, so the move made this reference stale.
- Impact: misleading API docs and source comments. This is a small DX cost.
- Suggestion: accept the three `description` changes in the OpenAPI allowlist and fix them, for example "see `owner_pages.get_party_profile`". Effort: 5 min.

### Info

**I1. Four of the six ACLs are near-empty re-export files** (fixable: no, required by the standard)
- Location: `src/backend/app/pages/infrastructure/{locations,product,media,users}_acl.py` (10-12 lines each, 1-3 names).
- Note: this is ceremony relative to the payload, but `standards/backend/models.md` requires one ACL per foreign context, and the boundary test depends on it. Keep it. Do not add function wrappers later, because that is what would turn the ceremony into real overhead.

**I2. `domain/links.py` wraps two f-strings** (fixable: optional)
- Location: `src/backend/app/pages/domain/links.py:10-17`, used at `organization_page.py:197`, `owner_pages.py:152,167`.
- Note: one-line functions with 3 call sites and one test. They are borderline, but they name the URL rule and give the user's domain layer real content. Keep them. Do not extend them to the inline f-strings that stay in groups (the spec correctly lists that as out of scope).

**I3. Generic `Protocol` plus a PEP 695 type parameter for a three-line sort** (fixable: optional)
- Location: `src/backend/app/pages/domain/owner_dates.py:12-25`.
- Note: `_HasStartsAt` and `[D: _HasStartsAt]` are more type machinery than the body (`sorted(...)[:limit]`). The Protocol does have a reason: it keeps the domain free of `pages.schemas`, which imports the ACLs. The tie-break test (`test_mergeUpcomingDates_termAndEventSameStart_termFirst`) is the most valuable part, because it pins a rule that had no test before. Acceptable.

**I4. Router split into an `__init__` aggregator plus two sub-modules for 7 routes** (fixable: optional)
- Location: `src/backend/app/pages/router/__init__.py`, plus `DbSession`/`Storage` aliases duplicated in `router/organization_page.py:23-24` and `router/owner_pages.py:25-26`.
- Note: a single `router.py` would be about 160 lines and would drop one file and the duplicate aliases. The split mirrors `app/groups/router` and the two application modules, and it keeps the diff readable as a move. That is a consistency gain at a trivial cost, so keep it.

**I5. The AST boundary guard is 87 lines** (fixable: no)
- Location: `src/backend/tests/test_pages_boundary.py`.
- Note: it resolves relative imports and matches whole dotted segments correctly. It is proportionate: import-linter would be a new dependency, and the test reuses the shape of `test_domain_clock_guard.py`. The three tests each check a distinct rule. A future second guarded package would justify moving the resolver into a shared `tests/` helper, but not now.

**I6. Context consistency and dead code: clean**
- Every name re-exported by the six pages ACLs is used in `app/pages`. `ReservedByResponse`, `GroupLayoutMode` and `PublicMediaResponse` are used only by `schemas.py`, as intended.
- The public helpers in `owner_pages.py` (`resolve_organization_owner`, `list_owner_recent_items`, `list_owner_dates`) are public because `organization_page.py` calls them. `get_owner_nearest` and `person_summary` are used only inside `owner_pages.py`, so they could have a `_` prefix, but their names were kept so the code reads as a move. Cosmetic only.
- `party_leads_public_circle`, `has_authored_event` and the two groups organizations-ACL wrappers were removed. There are no leftover callers.
- The `__pycache__` folders under `app/pages` are git-ignored (`.gitignore:2`), so they need no action.

## 3. Developer Experience
- Finding page code is easier: it is all under `app/pages`, and `app/groups` shrank by about 830 net lines.
- The cost is navigation. Getting from a pages call to the SQL takes two re-export hops (pages ACL → `groups.service` → repository). That is acceptable and matches how the other BCs work.
- The guard test gives an actionable failure message (file and offending module).
- No setup or tooling changes.

## 4. Requirements Alignment
- The implementation matches the spec's file table, the ACL table (names checked against `groups_acl.py`), the −2/+14 facade delta and the domain-module list. I found no feature beyond the spec and no future stubs.
- The `minimal-implementation.md` rules are met: no pages `service.py` facade, no export without a caller, no placeholder domain module, dead code deleted.

## 5. Recommended Simplifications (priority order)
1. **Fix the three stale route docstrings** (W2). This needs consent for the OpenAPI description change. Effort: 5 min.
   - Before: `nothing public (see `owner_items.get_party_profile`).`
   - After: `nothing public (see `owner_pages.get_party_profile`).`
2. **Follow-up, not this task: hide the `listed_items()` select inside groups** (W1). Effort: about 30 min. This removes 1 facade export and 1 ACL name and stops `Select` objects crossing the BC line.
   - Before: `groups_acl.list_owner_listed_items_page(db, party_id, groups_acl.listed_items(), mode, offset, limit)`
   - After: `groups_acl.list_owner_listed_items_page(db, party_id, mode, offset, limit)`
3. **Optional: `_`-prefix `get_owner_nearest` and `person_summary`** (I6) to show they are module-internal. Effort: 2 min, and there are no external callers.

## 6. Summary Statistics

| Metric | Value |
|---|---|
| `app/groups` lines | −898 / +70 |
| `app/pages` source lines | ~1,050 (19 modules) |
| New test lines | 139 (6 tests) |
| New dependencies | 0 |
| New `groups.service` exports | 14 (all called) |
| Re-exported ACL names unused | 0 |
| Dead code removed | 2 functions + 2 ACL wrappers |
| After recommendation 2 | −1 facade export, −1 ACL name |

## 7. Conclusion
The refactor is proportionate. Its extra structure comes from explicit user decisions and the ACL standard, not from speculation. Nothing needs to change before acceptance. The only action item is the stale-docstring fix (W2), and it needs consent. W1 is worth a later follow-up when the groups listing queries next change.
