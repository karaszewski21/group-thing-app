# Implementation Verification — Globalna wyszukiwarka + opis grupy

## TL;DR
⚠️ **Passed with Issues** after 2 fix cycles (24 fixes) — 0 critical, 5 warnings (N1 awaits a topology decision; 4 open by design or user decision), 3 info.
Plan 116/116; full suite re-run after fixes with 0 regressions; every acceptance criterion and mandated test (U1–U4, R1–R12) met; no visibility leak; production GO.
Remaining: confirm nginx real-IP behind any production proxy (N1); EXPLAIN on real data (W2). Cycle 2 fixed N2, R1–R3, R6–R8.

## Open Questions / Risks
- What sits in front of nginx in production? If a TLS proxy/CDN, add real_ip settings or every visitor shares one rate-limit bucket (N1).
- Search query plans are unverified on real data (W2).
- Rebrand files must be committed separately (W16); the standards update awaits approval (W14).

## Executive Summary
After one fix cycle (16 review findings plus search timeout -> 503) the implementation solves the brief end to end with no regressions: one membership definition with a guard test, one SQL visibility predicate, a moderated group description, and guest search behind rate limits and timeouts. There are no critical issues; the remaining warnings are a production-topology confirmation, frontend retry behaviour, and items open by design or user decision.

## Per-Check Results

| Check | Result | Report |
|---|---|---|
| Implementation plan | ✅ 116/116 steps (100%); every fix has code evidence | [completeness-report.md](completeness-report.md) |
| Test suite (re-run after fixes) | ✅ backend 1337 passed (2 pre-existing), frontend 1640 passed (24 pre-existing, all on HEAD), mypy 15, typecheck 5 known — 0 regressions | [test-suite-results.md](test-suite-results.md) |
| Standards compliance | ⚠️ Mostly compliant — 20/20 followed; standards text stale (W14) | [completeness-report.md](completeness-report.md) |
| Documentation | ✅ Adequate — CHANGELOG, runbook 0085-0096, INDEX; spec amendment pending (R7) | [completeness-report.md](completeness-report.md) |
| Code review | ⚠️ 0 critical / 4 warning / 9 info; no access widening | [code-review-report.md](code-review-report.md) |
| Pragmatic review | ✅ Appropriate — 0 warnings / 4 info | [pragmatic-review.md](pragmatic-review.md) |
| Production readiness | ✅ GO — 0 blockers / 2 warning / 3 info (readiness 90%) | [production-readiness-report.md](production-readiness-report.md) |
| Reality check | ⚠️ Deployable — 0 critical; all acceptance criteria met; low items only | [reality-check.md](reality-check.md) |

The full test suite was re-run after the fixes (`verification/test-suite-results.md`); this supersedes the completeness checker's note that it was not.

## Visual Fidelity
No `verification/visual-fidelity.md` yet — E2E (Phase 12) will compare against the mockups. W12 (field order) is fixed; G11 filter deviations remain for visual sign-off.

## Overall Assessment

| Dimension | Status |
|---|---|
| Implementation | 100% |
| Tests | passing (pre-existing failures only, re-run after fixes) |
| Standards | mostly compliant |
| Docs | adequate |
| Optional reviews | no critical; production GO |
| **Verdict** | **⚠️ Passed with Issues** |

## Issues Requiring Attention

| ID | Severity | Source | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| N1 | warning | code_review, production, reality | nginx limit_req keys on $binary_remote_addr without set_real_ip_from/real_ip_header; behind a TLS/host proxy or CDN all clients share one 5 r/s bucket (site-wide 429s). Runbook now documents the real_ip settings; config change awaits the user's topology decision. | `src/frontend/nginx.conf:3,16-26` | yes | Confirm production topology; if proxied add set_real_ip_from <proxy CIDR>, real_ip_header X-Forwarded-For, real_ip_recursive on; optionally separate zones. |
| W2 | warning | code_review | About 3 heavy OR-across-relations statements per request; no EXPLAIN evidence; the 3 s cap is per statement. Open by design. | `app/search/application/search.py` | no | EXPLAIN ANALYZE on production-like data; UNION candidate CTE; count(*) OVER (). |
| W11 | warning | code_review, pragmatic | search.py is 799 lines; _items_select about 90 lines. Open by design. | `app/search/application/search.py` | no | Split builders and per-kind mappers later. |
| W14 | warning | completeness | Standards text still references the deleted repository._owner_in_circle. Awaiting user approval. | `.maister/docs/standards/backend/models.md:175; .maister/docs/INDEX.md:59` | yes | /maister:standards-update after approval. |
| W16 | warning | all reviewers | Unrelated Gooo rebrand files in the same uncommitted tree. Left for the user. | `src/frontend/public/*, app/layout.tsx, proxy.ts` | no | Commit separately. |
| R4 | info | reality | With a date filter, an org-run group card links to its terms page without the in-window date. | `app/search/application/search.py:692` | yes | Optionally set next_starts_at when windowed. |
| R5 | info | code_review | Logged-in non-members still see reserved_until (may be a PRIVATE group's term date, date only). Accepted by user decision. | `app/search/application/search.py:301` | no | Accepted. |
| R9 | info | completeness, production | Residuals: locations.formatted_address / localities.name_search lack trigram indexes; no error tracking or metrics project-wide; NFD/NFKD fold differences; any valid token personalises search; category router repeats the cache-header helper. | `various` | no | Decide after EXPLAIN; log_min_duration_statement=500ms for the launch week. |

## Fix & Re-Verification History

Cycle 1 (reverify_count 1, full re-verification) and cycle 2 (targeted tests: backend 86 passed, frontend 88 passed, mypy 15, typecheck 5 known):

| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 public search abuse | page cap 50, SET LOCAL statement_timeout 3s, 57014 -> 503 Polish, nginx limit_req 5r/s burst 20 | resolved (residual N1, N2) |
| W3 missing trigram indexes | category match on path_text only; migration 0096 description/slug trigram indexes | mostly resolved (R9) |
| W4 public categories | Cache-Control anonymous public / authenticated private + Vary; product_count 0 for anonymous | resolved (R3 frontend cache) |
| W5 CHANGELOG | 6 new lines | resolved (R1: two more) |
| W6 date filter on groups | groups only with next term in the window (user decision) | resolved, tested |
| W7 input cap | maxLength 100 | resolved |
| W8 copied slug rules | re-exported via groups ACL; term/event path stay local (module boundary) | resolved |
| W9 shared-group duplication + private import | parties_share_group / owner_shares_group_with; inventory repository move | resolved |
| W10 test overlap | duplicates removed; boundary tests merged into test_module_boundaries.py | mostly resolved (accepted residual) |
| W12 field order | Opis between name and visibility | resolved |
| W13 optional description type | required string | null + fixtures | resolved |
| W15 runbook gaps | 0085-0096, table sizes, pre-swap alembic, roll-forward BACKFILL_SQL, INVALID wording | resolved (R8 small note) |
| I1 reserved_until for guests | null for guests (user decision) | resolved (R5 logged-in non-members) |
| I2 search cache key | keyed by viewer username; placeholder only for the same viewer | resolved |
| I4 SAWarning | explicit join | resolved |
| I6 cleanups | BalanceStatus, dead checks removed, private _count_other_mode | mostly resolved (R6) |
| Search timeout -> 503 | ServiceUnavailableException; 57014 mapped in search() | resolved, verified against the real driver |
| [cycle 2] N2 retries / 429 | useSearch no retry on 503 (shared shouldRetry otherwise); nginx error_page 429 -> JSON envelope with Polish message (nginx -t ok, live 429 checked) | resolved, tests fail without fix |
| [cycle 2] R1 CHANGELOG | page-50 cap + 3 s timeout -> 503; nginx 5 r/s burst 20 -> 429 | resolved |
| [cycle 2] R2 page 51 | SEARCH_MAX_PAGE = 50 stops getNextPageParam | resolved, tested |
| [cycle 2] R3 categories cache | AuthContext token-change effect invalidates CATEGORIES_KEY | resolved, tested |
| [cycle 2] R6 cleanups | BalanceStatus.AVAILABLE, _leads_term_circle docstring, links parity test | resolved |
| [cycle 2] R7 spec + nginx comment | spec 'Verification amendments (fix cycles)' section; nginx comment fixed | resolved |
| [cycle 2] R8 runbook | docker compose build first, old-image blocking note, real_ip guidance for N1, step numbering | resolved |

## Recommendations
1. Before deploy: confirm proxy topology and apply the runbook real_ip settings if proxied (N1).
2. Follow-up outside this task: api/client.ts reads non-JSON error bodies twice (may surface as Network error).
3. Decisions for the user: W14 standards update, W16 rebrand commit split.
4. Later: W2 EXPLAIN on real data, W11 split search.py, R9 residuals.

## Roadmap
No `.maister/docs/project/roadmap.md` — nothing to update.

## Verification Checklist
- [x] Completeness checker run
- [x] Test suite (re-run after fixes)
- [x] Code review
- [x] Pragmatic review
- [x] Production readiness
- [x] Reality check
- [x] All review reports present on disk
