# Workflow Summary — Globalna wyszukiwarka + opis grupy

## TL;DR
Delivered: global search (`/search`, guests included, `GET /api/public/search`) over items, terms, events, groups and organizations with one SQL visibility predicate, plus a moderated `groups.description` (≤500) shown on search cards and the group terms header. All 11 membership definitions were replaced by one `group_ids_for` (guard test). Verification: passed with issues (0 critical, 5 warnings open by decision/design), E2E GO (11/11), no regressions. Nothing committed.

## Key Decisions
- Synchronous moderation for the description; „szukam” ranking deferred; single membership primitive with `include_deleted` (messaging read-only) and family as a filter on top.
- PRIVATE items visible only via a shared non-deleted PRIVATE group; counterparty visibility moved into SQL.
- Generated STORED tsvector columns, `categories.path_text`, SQL `fold_pl()`, `pg_trgm`; response `SearchPage(Page[SearchResult]) + other_mode_count`.
- Only intended behaviour change for existing users: organizers may pledge items (CHANGELOG); other new behaviours listed in CHANGELOG.

## Open Questions / Risks
- **N1**: if a proxy/CDN fronts nginx in production, add `real_ip` settings (runbook documents them) or all visitors share one 5 r/s bucket.
- **W2**: search query plans unverified on real data — run EXPLAIN ANALYZE after deploy.
- **W14**: standards text (`backend/models.md`, INDEX) still names the deleted `_owner_in_circle` — standards update awaits approval.
- **W16**: the unrelated „Gooo” rebrand changes share the working tree; `src/frontend/src/test/proxy.test.ts` contains changes from BOTH (hunk-level split needed).
- Pre-deploy: run the legacy-data query (3 counts must be 0) and the `pg_trgm` privilege check from the runbook; deploy off-peak (0088–0090 rewrite tables).
- Dev DB is migrated to 0096 and contains E2E test records (kept by decision).

## Phases
| Phase | Result |
|---|---|
| 1 Codebase analysis | done — 4 Explore agents, clarifications |
| 2 Gap analysis | done — 18 scope decisions |
| 3 TDD red | skipped — no reproducible defect |
| 4 Mockups | done — 7 HTML screens, approved |
| 5 Specification | done — 23 requirements, R1–R12 |
| 6 Spec audit | pass-with-concerns → all findings resolved in spec |
| 7 Planning | 15 groups / 116 steps |
| 8 Implementation | 15/15 groups; full suite no regressions |
| 9 TDD green | skipped — Phase 3 not run |
| 10 Verification options | all reviews + E2E + docs |
| 11 Verification | 2 fix cycles, 24 fixes; passed with issues (0 critical) |
| 12 E2E | GO with caveats → M1, M2, C1, C3 fixed |
| 13 User docs | Polish guide, 20 screenshots |
| 14 Finalization | this summary |

## Test status (latest)
- Backend full suite: 1337 passed, 2 pre-existing stale failures; mypy 15 (baseline).
- Frontend full suite: 1640 passed, 24 pre-existing failures (all fail on HEAD b8c45e0); typecheck 5 pre-existing errors.
- Fix cycle 2 and E2E fixes verified with targeted runs (backend 86, frontend 88 + 68).

## Artifacts
All declared artifacts exist on disk (20 checked, 0 missing): analysis/*, implementation/spec(.html), implementation-plan(.html), visual-coverage.md, work-log.md, full-test-suite-results.md, verification/* (+ html companions), documentation/user-guide.md.

## Standards candidates (proposed, not applied)
1. LIKE/ILIKE on user input only via `autoescape=True` or trigram/tsvector with bound params.
2. Group membership only via `group_ids_for` (guard test); `include_deleted=True` only for messaging read paths.
3. Visibility only via `visibility.py` builders; „listed only” belongs in the base select.
4. Generated STORED columns mapped `Computed(persisted=True)` + `deferred(raiseload)`; expression indexes declared at module level with `.label()`.
5. Derived search text computed only in SQL with `fold_pl()`; changing it means a revision that rebuilds columns/indexes.
6. Cross-module rules re-exported through the ACL, never copied into `domain/`.
7. URL-state setters compose from the latest written params; personalised infinite queries key by viewer and keep placeholder data only for the same viewer.
8. A panel page opened to guests changes `PROTECTED_PREFIXES`, `PanelGate` and the routeManifest guest test together.

## Follow-ups (backlog)
- „Szukam” backend + ranking rule (1); `update_group` warning before PRIVATE→PUBLIC with private items; revisit „Moje terminy” PRIVATE-only filter.
- `api/client.ts` reads non-JSON error bodies twice; `useAppSearchParams` facade same-tick race for other callers.
- Split `search.py` (W11); EXPLAIN and residual trigram indexes (W2/R9).
- Pre-existing stale tests: `test_owner_items_page` (location_name), `test_terms_circle_occurs_on_index_migration` (0053).
