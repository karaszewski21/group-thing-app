# Pragmatic Review (round 2): B — Organizer directory + SCHEDULE / CIRCLES / EXCHANGE layouts

**Scope:**
- Feature B as committed: `git diff c026f28..60a7ec7`.
- Uncommitted verification fixes: `git diff`, 40 files, +425/-351.
- New untracked files: `blocks/AgendaResults.tsx` and `organizerHelpers.ts`.

**Reference:** round-1 report (superseded by this one), `implementation/spec.md` and `standards/global/minimal-implementation.md`.

## 1. Executive Summary

**Status: ✅ Appropriate.** All round-1 findings that called for action are resolved. The fixes add no speculative abstraction, and they leave no dead code.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 1 (L4, carried over and optional) |
| Info | 4 (new, no action needed) |

## 2. Round-1 Status

| ID | Finding | Status | Evidence |
|---|---|---|---|
| M1 | Agenda-results UI duplicated in the block and the page | **Resolved** | See details below. |
| L1 | Term path built in 8 places | **Resolved** | `organizerTermPath()` in `pages/organizer/organizerHelpers.ts:4`. A grep for the inline `grupa/${` template finds only that helper. Both local `termPath` functions are deleted. |
| L2 | Exchange total computed 4 times | **Resolved** | `exchangeTotal()` in `organizerHelpers.ts:9` is used in `registry.ts`, `LinkStackBlock`, `ExchangeCountsBlock` and `ExchangeBoardBlock`. |
| L3 | Circle-qualification join duplicated | **Resolved** | `_qualifying_owner_circles()` at `groups/infrastructure/repository.py:665` is used at lines 722 (circles) and 739 (terms). The R3 privacy rule is now defined once. |
| L4 | Tests import `_`-prefixed helpers from other test modules | Open (optional) | Unchanged. This is an existing project pattern and a DX note only. |
| — | Round-1 DX note: `hasStatus` lived in `hooks/useTermAttendees` | **Resolved** | It moved to `api/problem.ts:36`, and all 6 importers were updated. |
| I1 / I2 | Redundant `storage is None` check; `FALLBACK_TITLE` repeat | I1 gone, I2 unchanged | I1 disappeared in the `_build_exchange` rewrite. I2 is trivial. |

**M1 details:**
- `blocks/AgendaResults.tsx` (88 LOC) now owns `countBeforeMore`, `showMore`, the live-region announcement and both button constants.
- `AgendaBlock.tsx` dropped to 37 LOC, and `OrganizerTermsPage.tsx` lost about 80 lines.
- The filter reset uses `key={groupId ?? ""}` as round 1 recommended, so neither caller needs a manual `setCountBeforeMore(null)` anymore.

## 3. New Complexity Introduced by the Fixes

### 3.1 Exchange rewrite into SQL (`groups/infrastructure/repository.py:862-934`, `groups/application/organizer_page.py:191-247`)

**What changed:**
- The Python candidate and nearest-term assembly (`Counter`, `min`, `sorted()[:12]`) moved into SQL.
- One composable `_exchange_candidates` subquery does the work: a `UNION ALL` of the owner's terms and the attendees' RSVPs, then `DISTINCT ON (party_id)` to pick each party's nearest term, then joins to `ItemListingPreference` and to the available items.
- Two thin executors sit on top of it: `count_exchange_items_by_mode` and `list_nearest_exchange_items`.
- `list_active_attendee_parties_for_terms` was deleted. The application function shrank from about 50 lines to about 25.

**Verdict: justified.**
- The old code loaded every listing preference of every eligible party plus every matching item, only to keep 12 of them. That made the load unbounded with attendance.
- The SQL version caps the load and keeps the statement budget (the docstring now says ≤10).
- Each part of the query maps to one rule in the docstring.
- Moving it to SQL did not add a generic query builder or a new layer.

**Info (I-A):** the candidate subquery runs twice, once for the counts and once for the top-12.
- A single statement using `count(*) OVER (PARTITION BY mode)` could merge the two.
- That version would be harder to read, and when there are no candidates the current code already returns after the count.
- Leave it as is.

### 3.2 New circulation select passed through the bridge (`circulation/infrastructure/repository.py:177`, `circulation/service.py`, `groups/infrastructure/circulation_bridge.py:163`)

**What changed:**
- `available_items_with_product_select()` returns an unexecuted `Select`.
- It is re-exported through the service and the bridge, and the application layer hands it to the groups repository.
- The existing `list_available_items_with_product` now uses it internally. That function is still used by `public_view.py:171`, so it is not dead.

**Verdict: acceptable.**
- The groups repository imports no circulation models. Passing the select in from the application layer keeps the bounded-context rule (cross-module access only via bridges) without duplicating the "live + AVAILABLE" definition inside groups.
- This is three one-line pass-throughs, the same boilerplate as the round-1 `AvailableItemView` chain, and it is the mandated pattern.

**Info (I-B):** the groups repository types the parameter as `Select[tuple[uuid.UUID, uuid.UUID, str, Any]]`, using `Any` so it does not have to import `ItemCondition`. That is a reasonable trade-off.

### 3.3 `AgendaResults` props surface (`blocks/AgendaResults.tsx:12-19`)

**What changed:** the component takes 5 props: `slug`, `agenda`, `moreLabel`, `dayHeadingLevel` and an optional `onShowAll`.

**Verdict: minimal.**
- `agenda` is the whole hook result, so there is no prop explosion.
- `dayHeadingLevel` exists because of an accessibility fix: the heading hierarchy differs between the block (h3 under an h2) and the page (h2 under an h1).
- `onShowAll` being optional cleanly encodes "only offer this when a filter is active".
- There are no config knobs or render-prop hooks.

**Info (I-C):** the empty-state box now uses `py-6` in both places, where the page used `py-8` before. This is a negligible visual change.

### 3.4 Other small fixes (all proportional)

| Fix | Location | Note |
|---|---|---|
| `MAX_PAGE = 10_000` | `core/pagination.py:15` | Global, but one line. It turns a bigint-overflow 500 into a 400. |
| `NEEDED_ITEMS_LIMIT` plus a SQL `LIMIT` | `organizer_page.py`, `repository.py` | Caps an unbounded list. |
| `Cache-Control: public, max-age=60` | `groups/router/organizer_page.py:30` | Documented in the spec (line 584). |
| `CONCURRENTLY` index build | `alembic/versions/0053_...py` | Uses `autocommit_block()`. Standard zero-downtime practice. |
| `get_owner_party_id` with `ORDER BY ... LIMIT 1` | `organizations/service.py:97` | Deterministic instead of a 500 if there are ever duplicate owners. |
| Removed redundant `aria-label`, decorative `alt=""`, sr-only "Ładowanie…" | `AgendaList`, `ExchangeItemCard`, `BlockSkeleton`, `LinkStackBlock` | Accessibility fixes. Removing the label reduced code. |

**Info (I-D):** the `get_owner_party_id` guard handles a state the data model should never produce ("should there ever be several"). It is mildly defensive but costs two lines, so it is acceptable.

## 4. Developer Experience

- The agenda states now live in one place, the route shape is defined once, and the R3 rule is defined once. This removes the three drift risks that round 1 flagged.
- Moving `hasStatus` to `api/problem.ts` makes it discoverable for future hooks.
- The exchange query is denser SQL than the Python it replaced. Its docstrings, however, state the eligibility and tie-break rules in one sentence each, and the statement-budget tests still guard it.

## 5. Requirements Alignment

- The fixes add no functionality beyond the spec.
- The new limits and the cache header are spec-documented or production-readiness hardening, not scope inflation.

## 6. Context Consistency

**Unused code:** none.
- `list_active_attendee_parties_for_terms` was removed together with its only caller.
- `list_item_listing_preferences_for_parties` is still used by `exchange_summary`, `term_end_scan` and `term_item_listings`.
- `list_available_items_with_product` is still used by `public_view`.
- Every new symbol has a caller.

**Imports and duplication:**
- `OrganizerTermsPage.tsx` still imports `BlockSkeleton` and `pluralPl`, and both are still used, at lines 72 and 96.
- No duplicated logic remains from the round-1 list.

## 7. Recommended Simplifications

None required. Optional:
1. L4: move shared test builders into `tests/conftest.py` or `tests/factories.py`. Effort: about 30 minutes.

## 8. Summary Statistics

| Metric | Round 1 | Round 2 |
|---|---|---|
| Duplicated agenda-results blocks | 2 | 1 |
| Term-path builders | 8 | 1 |
| Exchange-total copies | 4 | 1 |
| Circle-qualification definitions | 2 | 1 |
| Organizer-page exchange rows loaded | unbounded | ≤12 (and counts aggregated in SQL) |
| Unused functions or exports | 0 | 0 |
| New dependencies or infrastructure | 0 | 0 |

## 9. Conclusion

Round-1 items M1, L1, L2 and L3 are resolved as recommended. The only noticeable new complexity is the SQL exchange rewrite, and it is justified because it replaces an unbounded Python load while keeping one composable subquery. Nothing blocks release.
