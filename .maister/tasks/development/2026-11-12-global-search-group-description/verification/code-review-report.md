# Code Review Report (re-verification after fix cycle 1)

**Date**: 2026-11-12
**Path**: uncommitted working tree of `group-thing-app`. Focus on the fix-cycle changes: `app/search/**`, `app/core/errors.py`, `app/groups/infrastructure/{visibility,membership,repository}.py`, `app/inventory/{service.py,infrastructure/repository.py}`, `app/category/{router,service}.py`, `alembic/versions/0096_*`, `src/frontend/nginx.conf`, `hooks/useSearch.ts`, `GroupFormFields.tsx`, `api/groups.ts`
**Scope**: all (quality, security, performance, best practices)
**Reverify count**: 1
**Status**: ⚠️ Issues Found (no critical issues)

## TL;DR
- No critical issues, and the security result is unchanged. Guests and non-members still have no way to reach PRIVATE items, terms of closed groups or PRIVATE groups. `:q` stays a single bound parameter, and `include_deleted=True` is still passed only from messaging. The new date window for groups narrows what is shown and opens no new access.
- Most earlier findings are fixed. Search pages are capped at 50. Search statements run under `SET LOCAL statement_timeout = '3s'`, and a timeout (SQLSTATE 57014) becomes a 503. nginx now rate-limits search. The category name match was dropped and description and slug got trigram indexes. Guests no longer get `reserved_until`. The cache is keyed by viewer. The private import, the duplicated predicate and the SAWarning are gone.
- Two new warnings come from the fixes themselves:
  - **N1**: the nginx `limit_req` key is `$binary_remote_addr`. If a TLS proxy sits in front of `:5174`, every visitor arrives from the same address and shares one 5 r/s budget for the whole site.
  - **N2**: the frontend retries any 5xx up to 2 times, so a statement-timeout 503 makes the same slow search run 3 times per user request.
- Still open by decision: W2 (no EXPLAIN; every request still runs about 3 heavy statements), W11 (`search.py` is now 799 lines) and W16 (unrelated rebrand files).

## Key Decisions
- **The timeout-to-503 mapping is correct for the real driver.** I checked that SQLAlchemy 2.0.44's asyncpg dialect sets `.sqlstate` on the translated exception (`dialects/postgresql/asyncpg.py:794`), so `getattr(exc.orig, "sqlstate", None) == "57014"` works in production, not only in the mocked test. The f-string in `SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'` only ever inserts the module constant `"3s"`, so there is no injection. `SET LOCAL` ends with the request transaction and does not leak into the pool.
- **`ModerationUnavailable` now subclasses `ServiceUnavailableException`, accepted.** It keeps the same 503 envelope and message (`str(exc)`). The handler was re-registered on the base class, and the moderation 503 test still passes.
- **The single "shares a group" predicate is accepted.** `parties_share_group` nests `group_ids_for(other)` inside `group_ids_for(party)`. Both use `correlate_except(Group)`, so the inner `Group` stays independent, and `private_only` filters the outer row. All three earlier copies (search ACL, `_shares_group_with_owner`, `repository.shares_private_circle`) now go through it.
- **Groups under a date window: they only narrow.** When `windowed` is set, a group needs its next term (≥ `start`) to fall inside `[start, end)`. Org terms-page groups with no term in the window drop out. `groups_visible_to` is still applied first.
- **Anonymous `/api/categories` accepted.** It returns `product_count` 0 and skips the aggregate, sends `public, max-age=60, s-maxage=300` with `Vary: Authorization, Cookie`, and logged-in callers get `private, no-store`. Only admin pages read `product_count` (`CategoryListPage`, `ProductFormPage`), so the guest search picker is unaffected.

## Open Questions / Risks
- **Production topology (N1)**: what sits in front of `frontend:80` / host `:5174` in production? The session cookie is `Secure` on https while nginx listens on plain port 80, which suggests a TLS proxy upstream. If so, the limit has to key on the real client address.
- **Retry policy for 503 (N2)**: should a search timeout be retried at all? I recommend no.
- **W2 still open**: the 3 s cap bounds each statement, not the request. One search runs up to about 5 statements, so the worst case is about 15 s of database time per request, or about 45 s with N2's retries.
- **`reserved_until` for logged-in non-members (residual I1)**: a logged-in user who is not a member still sees the date of a reservation made for a PRIVATE group's term. Only the date is shown, never the group name. Please confirm this is acceptable.
- I did not re-run the tests. I relied on the work-log figures: backend 283 + 149 + 44 + 82 targeted runs passed, and mypy reported 15 (the baseline).

## Summary
- **Critical**: 0 issues
- **Warnings**: 4 issues (2 new: N1, N2; 2 open by decision: W2→R-W1, W11→R-W4)
- **Info**: 9 issues

## Re-check of previous findings

| Previous ID (this report) | Verification ID | Status | Evidence |
|---|---|---|---|
| W1 OR across joined tables; 3 heavy statements per request | W2 | **Partially resolved, open by decision** | The category match is now on `path_text` only (`search.py:196`), so the trigram index can serve it. The ORs across relations, the separate `total` and `other_mode_count` statements, and the missing EXPLAIN all remain. |
| W2 No rate limit, deep offsets | W1 | **Resolved, with new residuals N1 and N2** | `MAX_SEARCH_PAGE = 50` (`router/search.py:30`). `SET LOCAL statement_timeout` 3 s (`search.py:784`). 57014 becomes a 503 (`search.py:796-799`). nginx `limit_req` 5 r/s, burst 20, returns 429 (`nginx.conf:3,16-26`). |
| W3 Match fields without a trigram index | W3 | **Resolved** | Redundant `fold_pl(category.name)` filter removed (it is still used for ranking only). `0096` adds `ix_groups_description_trgm` and `ix_organizations_slug_trgm`, also declared on the models. Locality and address stay unindexed, which was accepted earlier. |
| W4 Long module and functions | W11 | **Open by decision** | `search.py` is now 799 lines; `_items_select` 170-259 (about 90 lines); `_meeting_results` 640-707 (about 68 lines). |
| W5 Unrelated branding files | W16 | **Open by decision** | Not part of this re-check. |
| I1 `reserved_until` shown to guests | I1 | **Resolved for guests, residual for logged-in users** | `search.py:301` (`… and not guest`). Test at `test_search_acceptance.py:431`. |
| I2 Private `_events`/`_terms` imported across the facade | W9 (part) | **Resolved** | `newest_open_reservation_starts_at` moved into `inventory/infrastructure/repository.py:714` and re-exported by `inventory/service.py`. |
| I3 Duplicated "shares a group" predicate | W9 | **Resolved** | `visibility.parties_share_group` / `owner_shares_group_with`. `repository.shares_private_circle:863` delegates to it. The search ACL re-exports it. |
| I4 Duplicated link and slug rules | W8 | **Mostly resolved** | `derive_party_slug` and `derive_organizer_slug` are re-exported from `groups.domain.organizer_slug`. `term_path` and `event_path` still mirror `app.pages.domain.links`, which the pages boundary allows and the docstring documents. There is no parity test (I-3 below). |
| I5 Magic string `"AVAILABLE"` | I6 (part) | **Resolved in search, residual in groups** | Search uses `BalanceStatus.AVAILABLE` (`search.py:233`). `groups/infrastructure/repository.py:961` still compares to `"AVAILABLE"`. |
| I6 SAWarning in `current_organizer` | I4 | **Resolved** | Explicit `.join(GroupRole, GroupRole.id == Leadership.from_role_id)` (`groups_acl.py:73`). |
| I7 Search cache not keyed by viewer | I2 | **Resolved** | `queryKey: [SEARCH_KEY, {...request, viewer}]`. Placeholder data is kept only when the viewer is the same (`useSearch.ts:58-64`). |
| I8 Any valid token personalises | I3 | **Unchanged (by design)** | Consistent with the other personalised public routes. |
| I9 Fold mismatch | I5 | **Unchanged (low)** | The frontend `isSearchTooShort` now collapses whitespace like Python `fold_polish`. NFD vs. NFKD differences remain. |
| I10 Stale `_leads_term_circle` docstring | I6 (part) | **Not resolved** | `groups/infrastructure/repository.py:1309-1310` still says "the SQL twin of `attendance._is_term_organizer`". |
| I11 Proxy matcher misses `public/icons/` | I12 (part) | **Unchanged** (belongs to W16) | `proxy.ts:70`. |
| I12 Migration operations | I9 | **Unchanged (documented)** | The 0085–0096 runbook was extended in `architecture.md:463-490`. |

## Critical Issues
None.

## Warnings

### N1. nginx rate limit keyed on the immediate peer address (new)
- **Location**: `src/frontend/nginx.conf:3` (`limit_req_zone $binary_remote_addr zone=public_reads:10m rate=5r/s`), `:16-26`
- **Description**: nginx listens on plain port 80 and is published as host `:5174`. In production the session cookie is `Secure` on https (`architecture.md:41`), so TLS is very likely terminated by a proxy in front of this container. It could also be Docker's userland proxy. In either case `$binary_remote_addr` is the proxy's address, and every visitor shares one 5 r/s budget with a burst of 20. At normal traffic the search and the category tree would start returning 429 for everyone. Search and categories also share one zone, so loading the search page (categories plus a debounced search) uses up the same budget. Separately, users behind carrier-grade NAT, which is common on Polish mobile networks, share one key even when the address is real.
- **Recommendation**: Confirm the production topology. If there is a proxy in front, add `set_real_ip_from <proxy CIDR>; real_ip_header X-Forwarded-For; real_ip_recursive on;`. Never trust the header from arbitrary peers. Consider separate zones for search and for categories (categories are now cacheable), and a slightly higher burst for NAT users.
- **Fixable**: true (config)

### N2. Search timeouts (503) are retried twice by the frontend (new)
- **Location**: `src/frontend/src/api/queryClient.ts:8-11` (`shouldRetry`: anything ≥500 is retried up to `MAX_RETRIES`); `src/frontend/src/hooks/useSearch.ts:57-66` (no `retry` override)
- **Description**: The new 503 means "this query is too expensive, narrow it". Retrying it runs the same 3-second statements again twice, so one keystroke-debounced search costs up to 3× the capped database time, and it does so exactly when the database is already slow. The nginx 429 is not retried (it is a 4xx), but its HTML body falls back to the generic message in `extractProblemMessage`.
- **Recommendation**: In `useSearch`, set `retry: (count, err) => !(err instanceof ApiError && err.status === 503) && shouldRetry(count, err)`, or `retry: false`. Alternatively, make the global `shouldRetry` skip 503. Give the search error state a Polish message for a 429 without an envelope.
- **Fixable**: true

### R-W1 (verification W2). Heavy statements per request and no EXPLAIN evidence (open by decision)
- **Location**: `src/backend/app/search/application/search.py:200-213, 456-466, 566-572, 333-334, 741-742`
- **Description**: Unchanged apart from W3. Each request runs the page, total and other-mode statements, each an OR across relations. They are now bounded by the 3 s statement timeout, but that bound applies per statement, not per request.
- **Recommendation**: As before: EXPLAIN on production-like data, pre-select candidate ids per index, use `count(*) OVER ()` for the total.
- **Fixable**: false

### R-W4 (verification W11). Size of the search module (open by decision)
- **Location**: `src/backend/app/search/application/search.py` (799 lines; `_items_select` about 90 lines, `_meeting_results` about 68 lines)
- **Fixable**: false

## Informational
1. **Infinite scroll asks for page 51 (new)**: `useSearch.ts:61`. `getNextPageParam` keeps going while `page*size < total`. With more than 1000 matches at size 20, the 51st page is a 400 (`MAX_SEARCH_PAGE`) and shows as `nextPageError`. Stop at `last.page < 50` and mirror the constant as `SEARCH_MAX_PAGE`.
2. **The 503 test mocks the exception (new)**: `tests/test_search_api.py:146-183` raises a hand-built `OperationalError` carrying `sqlstate`. The production mapping is correct (see Key Decisions), but no test proves that a real timeout cancels and maps to 503. Optionally add one integration test that monkeypatches `STATEMENT_TIMEOUT` to `"1ms"` with a slow branch, or uses `pg_sleep`.
3. **No parity test for the term and event paths**: `app/search/domain/links.py:108-115` mirrors `app.pages.domain.links`. A small test comparing the two would catch drift.
4. **Category cache across a login (new, low)**: `hooks/useCategories` (staleTime 5 min) is not keyed by viewer. If an admin logs in in the same tab after browsing anonymously, the admin tree can show `product_count` 0 for up to 5 minutes, and the delete buttons are enabled. The backend still refuses with 409 (`CategoryHasProductsException`), so this is cosmetic. Invalidate the categories prefix when the session changes.
5. **Logged-in non-members see `reserved_until` (residual I1)**: `search.py:301`. The date can belong to a PRIVATE group's term. Only the date is shown.
6. **Stale docstring (residual)**: `groups/infrastructure/repository.py:1309-1310`. `_leads_term_circle` excludes soft-deleted circles. `_is_term_organizer` includes them.
7. **Magic string (residual)**: `groups/infrastructure/repository.py:961` `!= "AVAILABLE"`. Use `BalanceStatus.AVAILABLE`, which `inventory_bridge` provides.
8. **Any valid token personalises results (unchanged, by design)**: `router/search.py` `OptionalPrincipal`.
9. **Folding and migration-ops notes (unchanged)**: NFD vs. NFKD differences in the frontend; the `pg_trgm` ownership note in 0086. Both are documented.

## Security Verification Detail (focus areas)
| Path | Verdict |
|---|---|
| Guest → PRIVATE item | Blocked: `items_visible_to(None)` = PUBLIC only; scope forced to `ALL` (`search.py:791-792`) |
| Non-member → PRIVATE item | Blocked: requires `owner_shares_group_with(viewer, private_only=True)` (live PRIVATE group), counterparty or owner; own items excluded (`search.py:215-216`) |
| Closed-group terms | `terms_visible_to`: PUBLIC circle or the viewer's live circle, `deleted_at IS NULL` |
| PRIVATE groups / descriptions | `groups_visible_to` applied before the windowed / terms-page condition; the description is only projected on visible rows |
| Date window on groups | Narrows only; `next_term` LATERAL is bound to visible groups |
| `reserved_until` | Guests: `None`; `reserved: true` kept |
| SQL injection | `:q` bound once (`bindparam("q")`); `SET LOCAL` interpolates a constant; regconfig a constant `literal_column`; 0096 DDL from constants |
| `include_deleted` | Only messaging (unchanged); `parties_share_group` uses the default `False` |
| Cache headers | Search: `set_personalised_cache_headers` after success; a 503 carries no cache headers (tested). Categories: public cache only for anonymous, `Vary: Authorization, Cookie` |
| DoS | Page ≤ 50, `size` ≤ 100, `q` ≤ 100, 3 s per statement, nginx 5 r/s (see N1 and N2) |

## Metrics
- Max function length: about 90 lines (`_items_select`)
- Max nesting depth: 3 levels
- Largest new module: `app/search/application/search.py`, 799 lines
- Potential vulnerabilities: 0 critical; 1 configuration risk on the abuse protection (N1)
- N+1 query risks: 0 (fixed statement budget unchanged)
- Statements per search request: page, total, other-mode count, plus 2 batches (and a viewer lookup and a category check), each capped at 3 s

## Prioritized Recommendations
1. Confirm the production proxy chain and set `real_ip` (or a different key) for the nginx `limit_req` (N1).
2. Do not retry a 503 from search (N2). Stop the infinite scroll at page 50 (I-1).
3. Still before scaling: EXPLAIN with production-like data (R-W1).
4. Small cleanups: the stale docstring and magic string in `groups/infrastructure/repository.py` (I-6, I-7), a parity test for the links (I-3), invalidating categories on session change (I-4).
