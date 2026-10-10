# Implementation Verification — B: organizer directory + layouts SCHEDULE/CIRCLES/EXCHANGE

**Date**: 2026-10-10
**Scope**: commits 1a72956 (backend) + 60a7ec7 (frontend), diff c026f28..60a7ec7
**Overall Status**: ⚠️ Passed with Issues (0 critical, 9 warnings, info items below)

## Executive Summary

All 15 task groups are implemented and every spec requirement R1–R19 traces to code or tests. Independent re-runs pass: backend feature suite 164/164 on real Postgres, frontend feature suite 278/278, `tsc -b` clean, mypy at baseline (32). No reviewer found a critical defect; issues are robustness hardening (unbounded pagination, unbounded IN-lists, migration locking), duplication, stale docs and minor a11y.

## Results by Verifier

| Verifier | Status | Report |
|---|---|---|
| Completeness | passed_with_issues (0C/3W/4I) | (inline below) |
| Test suite | skipped — passed in implementation; reality-assessor re-ran feature suites: BE 164 ✓, FE 278 ✓ | — |
| Code review | issues_found (0C/2W/12I) | code-review-report.md |
| Pragmatic review | ✅ appropriate (0C/0H/1M/4L/2I) | pragmatic-review.md |
| Production readiness | GO with mitigations (82%, risk medium) | production-readiness-report.md |
| Reality check | GO (no critical/high gaps) | reality-check.md |

Plan: 107/107 checkboxes `[x]` (the "92 steps" figure excludes acceptance-criteria boxes). Standards: 17/17 applicable followed (models.md partially — documented bridge exception). Visual coverage: 28/28 IDs.

## Issues Requiring Attention (deduplicated)

### Warnings (fixable)
1. `app/core/pagination.py:27` — no upper bound on `page`; anonymous `/organizers/{slug}/terms` can 500 on bigint OFFSET overflow. [code review]
2. Agenda results UI (~60 LOC) duplicated in `blocks/AgendaBlock.tsx` and `OrganizerTermsPage.tsx`. [code review, pragmatic]
3. Public-circle qualification rule (R3) duplicated in `groups/infrastructure/repository.py` (`list_owner_public_circles` vs `_owner_public_terms_select`) — divergence risk. [pragmatic]
4. `organizations/service.py:97-114` `get_owner_party_id` uses `scalar_one_or_none` → 500 on public endpoint if 2 active owners. [code review, reality]
5. Migration 0053 builds index without CONCURRENTLY (write lock during deploy); old `ix_terms_circle_group_id` now a redundant prefix. [production, code review]
6. Unbounded preference/attendee loads → one large IN-list (asyncpg 32767 param limit); `needed_items` uncapped. [production, code review]
7. No `Cache-Control` on anonymous organizer payload. [production]
8. Stale docs: `.maister/docs/INDEX.md:71` and `project/architecture.md:39,155` still say matrix in `auth_deps.py` / "25 entries". [completeness]
9. `spec.md` Known Limitations missing the 30-circle cap note (stats/terms chip undercount). [completeness, code review]

### Info (fixable)
10. Term path template built in 8 places; `GIFT+SWAP+LEND` total in 4. [pragmatic, code review]
11. `hasStatus` imported from unrelated `useTermAttendees`. [code review]
12. `OrganizerTermsPage.tsx:49` strips valid `?group_id=` when directory fetch fails (non-404). [code review]
13. A11y: `ExchangeItemCard` alt duplicates link text; `AgendaList` aria-label overrides visible text; `BlockSkeleton` gives no SR loading cue; h3 under h1 on `/terminy`. [code review, completeness]
14. `router.tsx:159` comment misattributes collision prevention. [code review]

### Manual / user decisions (not fixable in code here)
- **Pre-deploy**: `SELECT id, slug FROM organizations WHERE slug IN ('access','terms','terminy');`
- Project-wide: no rate limiting (edge/proxy decision).
- Naive `datetime.now()` + container in UTC → "upcoming" off by up to 2h (set `TZ=Europe/Warsaw`?).
- Weekday capitalisation "Śr" vs mockup lowercase.
- Term-page thumbnails only for AVAILABLE listings — confirm intended.
- 17 pre-existing FE test failures (unrelated to B).

## Visual Fidelity
Not yet produced — E2E (Phase 12) pending.

## Roadmap
No `.maister/docs/project/roadmap.md` — nothing to update.

---

# Round 2 (re-verification after 14 fixes) — 2026-10-10

**Overall Status**: ✅ Passed with minor issues (0 critical, 2 warnings)

| Verifier | Status |
|---|---|
| Test suite (full) | BE 702/702; FE 763/780 (17 pre-existing only); tsc clean; mypy 32 = baseline |
| Completeness | passed_with_issues (0C/1W/4I) — round-1 W1–W3 resolved; stale spec sentences |
| Code review | 0C/1W/6I — all round-1 issues resolved/accepted; exchange SQL equivalent, no PII |
| Pragmatic | ✅ appropriate (0C/0H/0M/1L optional) — M1, L1–L3 resolved |
| Production readiness | GO with mitigations, 88% (from 82%), risk low-medium |
| Reality check | GO — SQL rewrite semantically equivalent; 1 Medium (cache staleness) |

Also applied (user feedback, mid-verification): settings icon at page top replaces "Edytuj wygląd" pill; editor closes after successful save (35/35 tests).

## Round-2 issues (deduplicated)
- **W-A (warning, fixable)** Migration 0053 + `autocommit_block` with env.py single-transaction: partial failure → index exists / INVALID while alembic_version=0052 → crash-loop on restart. Fix: `transaction_per_migration=True` in env.py; `DROP INDEX CONCURRENTLY IF EXISTS` before create. [code review, production, reality]
- **W-B (medium, fixable)** `Cache-Control: public, max-age=60` served from browser HTTP cache → panel edits / RSVPs invisible on `/:slug` and `/:slug/terminy` for up to 60 s; no shared cache exists so no server benefit. Fix: `public, max-age=0, s-maxage=60` (or drop). [reality, production, code review]
- **I-C (info, fixable)** Stale spec sentences: spec.md:568 (SC3), :247 ("4–11"), :229 (0053 row), R9 bridge list / file table (new `available_items_with_product_select`), :608 note; optionally tighten query-budget test to 10. [completeness, code review]
- **I-D (info, optional)** `/terminy` on directory error: unfiltered agenda with `?group_id=` kept and no retry. [reality, code review]
- **I-E (info, optional)** `COLLATE "C"` sorts Polish diacritics after Z in the exchange tie-break. [code review]
- Manual/user decisions unchanged: reserved-slug SQL check (gating), rate limiting, TZ, weekday casing, AVAILABLE-only thumbnails.
