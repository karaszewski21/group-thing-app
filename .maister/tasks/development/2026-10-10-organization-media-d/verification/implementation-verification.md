# Implementation Verification — D: Zdjęcia organizacji (logo, okładka, galeria)

**Date:** 2026-10-11
**Overall status: ⚠️ Passed with Issues** — 0 critical, 9 warnings (several duplicates across reviewers), ~15 info.

## Executive summary
All 84 plan steps are implemented across group-thing-app (backend + frontend) and group-thing-ai (cron subject + grants). Tests pass: backend 743 in the full suite, plus G15 tests (156 in the reality-check run); group-thing-ai 147; frontend 801/818, where the 17 failures equal the HEAD baseline. All four reviews found no critical issues. The main open items are one spec deviation (reorder without storage), the upload holding a DB connection during image processing, invented copy, and operator deploy-order risks.

## Results by verifier
| Check | Status | Critical | Warning | Info | Report |
|---|---|---|---|---|---|
| Completeness (plan/standards/docs) | ⚠️ passed_with_issues — 84/84 steps (100%), 18/18 applicable standards followed | 0 | 2 | 7 | (inline below) |
| Test suite | ⏭ skipped (passed during implementation); reality-check re-ran: BE 156 ✓, AI 147 ✓, FE 801 ✓ / 17 baseline | 0 | 0 | 0 | work-log.md |
| Code review | ⚠️ issues_found | 0 | 2 | 8 | code-review-report.md |
| Pragmatic review | ✅ appropriate | 0 | 2 (medium) | 7 | pragmatic-review.md |
| Production readiness | ⚠️ GO with mitigations (82%, risk medium) | 0 | 6 | 5 | production-readiness-report.md |
| Reality check | ⚠️ GO | 0 | 1 (medium) | 7 | reality-check.md |

Visual fidelity: no `visual-fidelity.md` yet (E2E is Phase 12).

## Deduplicated issues needing attention

### Warnings
| # | Issue | Location | Sources | Fixable |
|---|---|---|---|---|
| W1 | `reorder_gallery` returns 409 when storage is None; spec R11 says reorder works. The FE ignores the response body, so the simplest fix is to apply the reorder without storage (204, or `[]`). | `app/organizations/media.py:497-498` | completeness, code, pragmatic, production, reality | yes (spec decision) |
| W2 | Upload holds a DB connection/transaction during `process_upload` (up to 50 Mpx) and the S3 puts, so the pool can run out under load. | `media.py:344-362` | code | yes (end the read txn after `_require_owner`) |
| W3 | Invented cover S1 copy "Brak okładki — na stronie widać kolorowe tło." | `PhotosTab.tsx:41` | completeness, code, pragmatic, reality | yes (user confirms copy) |
| W4 | No live/browser verification of the full loop (local DB at 0053). | environment | reality | yes (Phase 12 E2E / manual smoke) |
| W5 | Deploy order across repos (app+0054 → grants with CURRENT password → cron); otherwise all image moderation stops. | deploy process | production, reality | no (runbook) |
| W6 | The grants SQL always runs ALTER ROLE PASSWORD, so a wrong value rotates the password under the running cron. | `group-thing-ai/scripts/moderation_db_role.sql` | production | yes (optional grants-only path) |
| W7 | Rollback destroys data; the downgrade must run with the new image. | migration 0054 / compose | production | no (runbook) |
| W8 | `MODERATION_IMAGE_ENABLED` defaults to false in compose; production value not verified. | docker-compose.yml | production | yes (presence check on VPS A) |
| W9 | Changes uncommitted (untracked `media.py`, `0054`, etc.). G1 and the R30 docs are already in commit 93ee637. | working trees | production, completeness | yes (commit per split) |

### Info (selected, fixable cheaply)
- I1 `isGalleryEmpty` throws if `gallery` is missing from the response → use `?? []` (`GalleryBlock.tsx:8`).
- I2 A failed `storage.delete` during cleanup masks the original 409 as a 500 (`media.py:374-377`).
- I3 The first rendition is orphaned if the second put fails (`media.py:361-362`; same as products).
- I4 Admin re-approval of a REJECTED gallery row skips the limit of 3 and dense ordering (`media.py:475`; product decision).
- I5 The M1 race test cannot detect an ORM-preload regression → assert the identity map is empty.
- I6 Redundant `_Subject.count` / `_count` / `functools.partial`; stale docstring in `moderation/router.py:58-59`.
- I7 Duplicate empty guard in GalleryBlock; unreachable null-`media_kind` branch in PhotoModerationCard; PhotosTab gets media from two sources.
- I8 Logo ring over cover keeps palette `border-on-primary` (dark on SUN) (`HeroBlock.tsx`).
- I9 Re-uploading a rejected logo says "już dodane jako logo" (copy).
- I10 `datetime.utcnow()` deprecated (`media.py:398`); sweep job registration untested; no boto3 timeouts; no upload rate limiting (pre-existing).
- I11 `delete_upload` unknown-id message now names "Upload" (404 unchanged).
- I12 Standards evolution pending: UUID PKs in models.md/migrations.md; "new moderated type = one `_SUBJECTS` entry"; `themeTokenUsage` for new organizer files; `uv run python -m <tool>`.

## Standards compliance
18/18 applicable standards followed (completeness checker). Minor: extra `className` prop on PhotoFileField. models.md/migrations.md are outdated (sequence PKs).

## Documentation
work-log.md complete for all 15 groups, baseline recorded. The "Standards Reading Log > Loaded Per Group" placeholder was not filled (standards are logged per group entry instead).

## Roadmap
No `.maister/docs/project/roadmap.md`, so nothing to update.

## Recommendations
1. Decide W1 (recommended: reorder without storage → apply and return `[]`), fix W2, I1, I2 (small, safe).
2. Confirm or replace the W3 copy.
3. Run Phase 12 E2E after migrating the local DB to 0054 (W4).
4. Follow the release checklist: commit (W9) → verify MODERATION_IMAGE_ENABLED (W8) → backup → app deploy → grants with current password (W5/W6) → cron → smoke; record the rollback runbook (W7).

---

# Re-verification — iteration 2 (2026-10-11)

**Overall status: ✅ Passed** (0 critical, 0 code warnings; remaining items are info, product decisions or release/runbook steps).

| Check | Result |
|---|---|
| Test suite (full) | Backend 751/751 · group-thing-ai 147/147 · Frontend 801/818 (17 = HEAD baseline, 0 regressions) — `test-suite-results.md` |
| Completeness | 100% plan; standards compliant; spec drift (R8, R25a, R26, M5 row, plan 12.3) synced after the check |
| Code review | 0 critical / 0 warning / 4 info — all previous warnings resolved, no new bugs from the fixes |
| Reality check | GO with conditions (~97%) |
| Pragmatic / production (iteration 1) | Appropriate / GO with mitigations — fixes addressed their code items |

## Fixed in iteration 1
W1 reorder without storage, W2 upload releases the txn before processing/S3, I1 FE tolerance of missing fields (user-reported crash), I2/I3 cleanup, I5 identity-map assertion, I6 redundant count + docstring, I7a/I7c FE simplification, I8 logo ring over cover, W3 copy approved.

## Still open (not blocking)
- Release: commit including untracked files (`media.py`, `0054`, new FE files) per commit split; deploy order app+0054 → grants with CURRENT cron password → cron; verify `MODERATION_IMAGE_ENABLED` on prod (presence-only); rollback runbook (data-destroying downgrade with the new image).
- Local: DB at 0053 → `alembic upgrade head` + backend restart, then a smoke run / E2E (Phase 12).
- Product decisions: admin re-approval of a REJECTED gallery row can exceed 3; the "już dodane jako logo" copy for re-uploading a rejected image.
- Info/optional: ownership re-check under the lock + BaseException for storage cleanup (I9); a test for a response without media fields (R3); discriminated union for `media_kind` (I7b); sweep partial index if the table grows; `datetime.utcnow()`.
