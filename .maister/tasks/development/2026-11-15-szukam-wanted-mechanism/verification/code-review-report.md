# Code Review Report

**Date**: 2026-11-16
**Path**: uncommitted changes of `2026-11-15-szukam-wanted-mechanism` (backend `src/backend/app/wants/`, `alembic/versions/0099_wants.py`, edits in `app/main.py`, `app/core/authorization_matrix.py`, `app/notifications/`, `app/moderation/text_guard.py`, `app/groups/infrastructure/visibility.py`; frontend `features/wanted/`, `hooks/useWants.ts`, `hooks/useWantMatches.ts`, `api/wants.ts`, the wanted routes, the item-page take flow, shared components)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found

## TL;DR
- No critical issue. The match statement is fully bound (no string splicing of user data), excludes own, hidden PRIVATE and non-takeable items as the spec says, and every `/{id}` route selects by (id, seeker) with withdrawn = 404.
- 3 warnings, all in the scan or the write paths: (1) the bell-row step does not re-check the want's status, so a withdraw that commits during a run can still get a match row; (2) the run holds row locks from its sweep through the whole reverse match, and after downtime the window has no upper bound; (3) no rate limit on the writes that run the forward match.
- 17 info items: most of the work-log open items are confirmed, plus a few small frontend gaps.

## Key Decisions
- Accepted items are not raised again: the 5.7 s reverse-scan budget miss, the cap race (ADR-011), stale pairs after a concurrent edit, the unpaged match list (FR-A-08), and items that become takeable after listing (ADR-005). W2 is raised only because it can make the accepted budget miss worse: the locks are held for the full match time, and the window after downtime has no limit.
- Work-log open items, checked against the code: cap link keyed on the message text = confirmed (I1); bell `created_at` from the writer's clock = confirmed, harmless (I6); `now` earlier than the marker = confirmed, harmless with one process (I7); marker conflict recognised by constraint name = confirmed, works (I5); two visibility definitions = confirmed, harmless (I2); `CLOSE_OUTCOMES` unused = confirmed (I4); `standards/backend/time.md` omits `app/search` and `app/wants` = confirmed (I8).

## Open Questions / Risks
- W1 should get a one-line fix (filter on `ACTIVE`) before release. The window is as long as the reverse match statement, which already takes seconds at the accepted scale.
- The deployment runs one uvicorn process (Dockerfile, docker-compose), so the marker race and deadlock paths can only happen if the backend is ever scaled out. A deadlock between two runs would raise `DeadlockDetected`, which the job wrapper does not catch.

## Summary
- **Critical**: 0 issues
- **Warnings**: 3 issues
- **Info**: 17 issues

## Verified (no issue found)
- **Bind discipline**: `matcher.py`, `reads.py` and `scan.py` are ORM/Core only. `text_queries.short_words_query` passes the name as a `bindparam` and escapes `\` and `'` inside the quoted tsquery operand in SQL. The only f-string SQL is `SET LOCAL statement_timeout`, and it uses a module constant (I9).
- **Match visibility** (`matcher.py:186-192, 241-245`): PUBLIC, or PRIVATE plus `owner_shares_group_with(Want.seeker_party_id, private_only=True)`. Own item: `owner_party_id <> seeker_party_id`. Takeable: balance `AVAILABLE`, `proposer_party_id IS NULL`, the place joined with `deleted_at IS NULL`. `listed_items_with_product_select` also drops soft-deleted items. `item_listing_preferences.item_id` is unique, so no item can fill two top-20 slots and the single `INSERT … ON CONFLICT DO NOTHING` sees no duplicate keys.
- **Set-based insert**: `gen_random_uuid()` and the timestamps come from the select (`include_defaults=False`). The notification batch writer sets ids and timestamps explicitly.
- **Authorization**: matrix rows 66-67 come before the catch-all. The router repeats `require_any("READ"/"EDIT")`. `_own_want` and `list_matches` filter by `seeker_party_id` and `status <> WITHDRAWN`. `mark_match_opened` checks ownership before it reads the pair. `matched_item_id` only narrows the caller's own wants.
- **Replace logic**: one `DELETE … AND read_at IS NULL RETURNING`, then one insert. The count is summed only when the previous row was really deleted. Entries and the `written` list stay aligned because the match entries go first. A muted want keeps its pointer.
- **Version races**: every set-based `wants` update in the scan sets `updated_at`, so a seeker write that loaded the want earlier gets `StaleDataError`, which the global handler maps to 409. The marker goes through the ORM.
- **Statement counts**: constant, as measured in the work log. Match cards batch the organizations and photos.
- **Frontend**: React Query hooks follow `data-fetching.md`, with awaited invalidation of the `wants` prefix and a stable empty fallback. The token is part of the key, a documented deviation because wants are private. Views derive their state in pure `resolve…View()` functions. Errors appear in `role="alert"` blocks. The switch uses `role="switch"`. A blocked submit uses `aria-disabled` plus `aria-describedby`. Withdrawing uses `ConfirmDeleteDialog`.

## Critical Issues
None.

## Warnings

### W1. A want withdrawn or edited during a scan run can still get a match bell row
- **Location**: `src/backend/app/wants/application/match_notifications.py:54-66` (`_wants_to_notify`), `:111-132` (`_point_wants_at_rows`)
- **Description**: The run reads the wants to notify with a plain `SELECT … WHERE id IN (…) AND notifications_enabled`. That select does not filter on status, takes no lock and checks no version. The pointer update matches on `id` alone. Under READ COMMITTED, a seeker's withdraw (or edit-reset) that commits after the reverse match but before this select passes the version check: the run has not touched that row yet. The run then deletes nothing, inserts a `WANT_MATCH_FOUND` row and points the WITHDRAWN want at it. The new row links to `/wanted/{id}`, which is now a 404, or for an edit it announces pairs of the old name. The INSERT into `want_matches` takes only a `FOR KEY SHARE` lock on `wants`, so it does not block the seeker's `UPDATE`. The race window is as long as the reverse match statement (seconds at the accepted scale).
- **Risk**: A notification for a want the seeker has just withdrawn, which breaks FR-L-04 / FR-N-06 ("unread match row deleted on withdraw").
- **Recommendation**: Add `Want.status == WantStatus.ACTIVE` to `_wants_to_notify`. Better still, read with `.with_for_update()`, so the select waits for an in-flight seeker write and then sees the committed state, and add the same status predicate to the `_point_wants_at_rows` update.
- **Fixable**: true

### W2. Row locks are held from the sweep through the whole reverse match, and the window after downtime has no limit
- **Location**: `src/backend/app/wants/application/scan.py:109-126`
- **Description**: `_expire` and `_remind` lock their want rows first. The reverse match comes next: 5.7 s at the accepted size, and much longer when the window is long. The run commits only after that. A seeker who extends, closes or edits one of those wants waits for the whole match and then gets a 409 (`StaleDataError`). After an outage, `window_start = marker.scanned_through - 5 min`, which can be hours or days back, and runs as one statement without a statement timeout. The run time grows linearly with window × wants, so lock time and memory grow with it, beyond the accepted budget.
- **Recommendation**: Run the match before the sweep, or commit the sweep in its own transaction, so locks are taken only near the end. Cap the window, for example `window_end = min(now, window_start + N × SCAN_INTERVAL)`, and store that as the marker so the next run continues from there.
- **Fixable**: false (a design change to the scan order)

### W3. No rate limit on the writes that run the forward match
- **Location**: `src/backend/app/wants/application/writes.py:139-172` (create), `:175-236` (PATCH with a matching-field change), `:274-293` (resume)
- **Description**: Each of these runs the heavy forward match for up to 3 s. The cap of 30 counts only ACTIVE wants, so a loop of create then withdraw (or a PATCH that flips the name) can keep starting 3-second statements without limit. It also adds `wants` and `want_matches` rows that stay for 30 days. A create also calls the text classifier.
- **Risk**: One authenticated account can cause noticeable database load (a denial-of-service vector).
- **Recommendation**: Add a per-party rate limit on these routes (the project has a deferred rate-limit item for guests, see memory W8). Or also count wants closed in the last 24 h toward a daily create quota.
- **Fixable**: false

## Informational

| # | Location | Description | Suggestion | Fixable |
|---|----------|-------------|------------|---------|
| I1 | `src/frontend/src/features/wanted/WantFormView.tsx:44, 193` | Confirmed: the "Zobacz listę" link appears only when the server text equals `LIMIT_MESSAGE`. If the copy changes, the link disappears silently. | Keep the HTTP status in `useWants` mutations (rethrow `ApiError`, or attach `status` to the Error) and test for 409 on create. | true |
| I2 | `src/backend/app/wants/application/reads.py:52` vs `matcher.py:186-192` | Confirmed: the read-time filter (`items_visible_to(seeker, ALL)`, which includes the counterparty branch) is wider than the match rule. It is harmless, because a pair can only be stored under the stricter rule. | Add a sentence to the `visible_matches` docstring, or leave as is. | true |
| I3 | `src/backend/app/wants/application/reads.py:174-178` | `matched_item_id` checks stored pairs only, so the closing prompt can name a want whose match card the read filter hides. This is harmless right after the seeker's own take. | None needed; document it. | true |
| I4 | `src/backend/app/wants/domain/lifecycle.py:22` | Confirmed: `CLOSE_OUTCOMES` is dead code. `CloseWantRequest` restricts the outcome itself. | Delete it, per `minimal-implementation.md`. | true |
| I5 | `src/backend/app/main.py:96-97` | Confirmed: the marker conflict is recognised by `MARKER_UNIQUE_CONSTRAINT in str(exc.orig)`. It works with asyncpg's message, but depends on the message text. | Prefer `getattr(exc.orig.__cause__, "constraint_name", None) == MARKER_UNIQUE_CONSTRAINT`. | true |
| I6 | `src/backend/app/notifications/service.py:97` | Confirmed: bell rows take `created_at` from `datetime.utcnow()` in the writer, not from the run's `now`. The difference is seconds. Also, the scan writes `updated_at = now` (the run's start), which can be earlier than a seeker write made during the run. The version check uses equality, so this is harmless. | Accept, or pass `now` into the writer. | true |
| I7 | `src/backend/app/wants/application/scan.py:115-125` | Confirmed: a `now` earlier than the stored `scanned_through` (clock skew) moves the marker backwards. With one process, the only effect is a harmless rescan. | `scanned_through = max(marker.scanned_through, now)`. | true |
| I8 | `.maister/docs/standards/backend/time.md` | Confirmed: the list of clock-guarded packages leaves out `app/search` and `app/wants`, although `tests/test_domain_clock_guard.py` was extended. | Update the standard and its INDEX summary (`/maister:standards-update`). | true |
| I9 | `src/backend/app/wants/application/writes.py:79` | `text(f"SET LOCAL statement_timeout = '{…}s'")` builds SQL with an f-string. The value is a constant, so this is safe, but it is a pattern `queries.md` discourages. | `select(func.set_config("statement_timeout", "3s", True))` with a bind. | true |
| I10 | `src/backend/app/wants/application/reads.py:188-234`, matcher top-N per run | Stored matches can grow by 20 per run (96 runs a day) for a broad want. `GET /matches` returns every pair, with a correlated reservation subquery per row. This was accepted as "unbounded in v1", but nothing caps it. | Consider a cap on stored pairs per want, or paging, in a follow-up. | false |
| I11 | `alembic/versions/0099_wants.py:132`, `models.py:154` | `ix_want_matches_item_id` (required by the spec) has no reader today. Every lookup goes through `(want_id, item_id)`. It adds write cost to every pair insert. | Keep it if item-side cleanup is planned; otherwise drop it in a later revision. | false |
| I12 | `src/frontend/src/features/wanted/MatchCard.tsx:24` | `onOpen` hangs on `<li onClick>`. A middle-click or Ctrl/Cmd-click (`auxclick`) opens the item without recording `opened_at`, and the handler sits on a non-interactive element. | Put `onClick` (and `onAuxClick`) on the `Link` inside `ItemCard`, through a prop. | true |
| I13 | `src/frontend/src/features/account/AccountView.tsx:14-17, 56` | When `useWants` fails, the "Szukam" row shows "brak", which is wrong because the user may have wants. | Show no meta while `error` is set. | true |
| I14 | `src/frontend/src/features/wanted/WantFormView.tsx:114-117, 157` | On create with a `?locality=` prefill, saving before `useLocality` resolves (or after it fails) sends `locality_id: null` and silently drops the prefilled place and radius. | Fall back to `initial.localityId` while `pickedLocality === undefined`, as edit mode does, or disable submit until it resolves. | true |
| I15 | `src/frontend/src/features/wanted/wantFormViewState.ts:61` | The `category` prefill is not checked for UUID shape, so a hand-edited URL gets the server's generic validation 400. | Check the UUID shape as for `locality`. | true |
| I16 | `src/frontend/src/features/wanted/WantMatchesView.tsx:37, 47-51` | The page also mounts `useWants()`, which issues an extra `GET /api/wants` per visit. It posts "seen" on every visit, even with 0 new matches. Auto-extension needs that post, so this is spec-conformant. | Optional: skip the POST when `new_match_count === 0` and the want is not in its last 30 days. | true |
| I17 | `src/backend/app/wants/application/matcher.py:120-271` | `match_statement` is about 150 lines (`write_bell_rows` about 70, `WantMatchesView` about 155). Each is cohesive and well commented, but well over the 50-line guideline. | Optionally extract the predicate builders (`visible`, `similar`, `in_locality`) into module functions. | false |

## Metrics
- Max function length: about 150 lines (`match_statement`); the largest React component is about 155 lines (`WantMatchesView`)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0 injection or authz; 1 abuse vector (W3)
- N+1 query risks: 0 (cards batched, statement counts constant per the tests)
- Race conditions: 1 open (W1)

## Prioritized Recommendations
1. W1: add the `ACTIVE` status filter (and ideally `FOR UPDATE`) to the bell-row want read and to the pointer update.
2. W2: move the sweep after the match, or commit it on its own, and cap the scan window after downtime.
3. W3: add a per-party rate limit to create, resume and matching-field PATCH.
4. I1, I14, I12: small frontend robustness fixes (keep the 409 status, the locality prefill fallback, auxclick on open).
5. I4, I8: delete `CLOSE_OUTCOMES` and update `standards/backend/time.md`.
