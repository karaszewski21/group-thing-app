# Reality Check: D — Organization media (logo, cover, gallery) — iteration 2

**Date**: 2026-10-11
**User request**: "chce dodac u organizatora zdjecia do jego strony" (organizer adds photos to their public page)
**Status**: ⚠️ Issues Found (no Critical/High gaps). **Deployment decision: GO**, conditional on: commit including the untracked files, the R-Deploy order, and one manual smoke run against a migrated DB.

---

## 1. Verdict

The code-level fixes from iteration 1 are in place and I confirmed each one by reading the code (section 3). The feature still meets the user's need: an owner uploads a logo, a cover and up to 3 gallery photos from the "Zdjęcia" tab. Those images go through the existing moderation pipeline, and visitors see only approved images in the hero and in the gallery block of all 5 layouts.

One thing has not changed since iteration 1: **nothing has run end to end against the new backend.** The local `aj` DB is still at alembic `0053` (checked: `alembic_version = 0053`, and `organization_media` does not exist). The crash the user reported came from running the new frontend against that old, un-migrated backend. That crash is fixed in the frontend, but it also shows that every "it works" claim so far rests on automated tests with `FakeStorage`, not on the real loop (browser upload → Spaces → cron → public ACL → page).

---

## 2. Evidence (test execution skipped per instructions; read from `verification/test-suite-results.md`)

| Suite | Result |
|---|---|
| Backend full (`pytest`) | **751/751 passed**. That is up from 743, with the new W1, I5 and backstop tests |
| Frontend full (`vitest`) | **801/818**. The 17 failures are exactly the HEAD baseline (PanelPage 8, TermPage 5, extension-points 2, auth 1, foundation 1); none is in an organizer, media or moderation file |
| group-thing-ai | **147/147 passed** |
| Work-log claims for the fix iteration | Backend: ruff clean, mypy 32 (the baseline). Frontend: tsc and eslint clean |

Runtime state (checked directly, presence only, no secrets):
- Local Postgres `aj` DB is at `0053`, so the `organization_media` table is missing.
- `group-thing-ai-moderation-cron-1` is running the local stack.
- The new modules (`app/organizations/media.py`, `0054_organization_media.py`, `PhotosTab.tsx`, `GalleryBlock.tsx`, `useOrganizationMedia.ts` and the tests) are still **untracked** in git.

---

## 3. Iteration 1 gaps: status after the fixes

| ID | Iteration 1 gap | Status | Evidence |
|---|---|---|---|
| G1 | No runtime verification | **OPEN** | DB still at 0053; no e2e or `visual-fidelity.md` report; the user's crash happened in exactly this mismatched environment |
| G2 | Reorder 409 without storage (R11) | **Closed** | `media.py:518-523` saves the order, commits, and returns `[]` when `storage is None`. Test `test_reorder_storageNone_appliesOrderReturns200EmptyList` |
| G3 | Invented cover copy | **Closed** | The user approved it; recorded in spec line 307 (R26) |
| G4 | Weak M1 regression guard | **Closed** | `test_organization_media_moderation.py:305` asserts that no `OrganizationMedia` is in `identity_map` after `lock_media_parent`. The work log says this check was proven to catch a regression |
| G5 | Confusing duplicate message for a rejected image | Open (Low, copy/spec decision) | Unchanged; the spec R5.1 behaviour is intentional |
| G6 | Logo ring colour over the cover | **Closed** | `HeroBlock.tsx:98`: `ringColor = overCover ? "border-on-ink" : "border-on-primary"`. Asserted in `organizerMediaBlocks.test.tsx:140` |
| G7 | Deploy-order risk | Open (Info, process) | Unchanged; documented in R-Deploy and the README |
| G8 | `datetime.utcnow()` | Open (Info) | Unchanged; matches the repo convention |
| W2 (code review) | Upload held a txn and connection during processing and S3 | **Closed** | `media.py:346-350`: `_require_owner`, then `db.rollback()`, then processing in a thread and the puts, then `_lock_organization`. Both puts are inside the cleanup `try`; cleanup failure is logged and the original exception is re-raised (I2/I3) |
| User crash | `isGalleryEmpty` on undefined `gallery` | **Fixed, no regression test** | `GalleryBlock.tsx:8,14` uses `?? []` and a default `[]`; `HeroBlock` uses `cover != null` and `logo?.`; `useMyOrganization` uses `media?.some`; `PhotosTab` uses `data?.media ?? NO_MEDIA`. No test renders a public response without `gallery`/`logo`/`cover` or an owner response without `media` |
| I7c | Two media sources in the editor | **Closed** | `PhotosTab` reads `useMyOrganization({ pollPendingMedia: true })`, which uses the same `[MY_ORGANIZATION_KEY, token]` key as the page; the `media` prop is removed. A status change invalidates `PUBLIC_ORGANIZATION_KEY`, so the page behind the editor refreshes |

---

## 4. Remaining gaps

None are Critical or High.

| ID | Severity | Gap | Location | Fixable |
|---|---|---|---|---|
| R1 | Medium | **No runtime proof of the end-to-end loop.** The local DB is at 0053 and the dev backend does not serve the new routes. Upload → private put → cron tick → public ACL → hero/gallery update has only been proven piecewise (FakeStorage integration tests, cron contract tests). The user's own crash shows this environment has not been exercised with the new backend. | environment (local `aj` DB, backend container, cron) | Yes: `alembic upgrade head`, restart the backend, then do one manual or e2e smoke run (section 6) |
| R2 | Medium (deploy hygiene) | **Feature files are untracked.** `app/main.py` imports `app.organizations.media`. A commit or image built without the untracked `media.py`/`0054` takes the API down at import time, or returns 500 on `/public/{slug}` and `/mine`. | `git status`: 8 backend + 5 frontend `??` files; group-thing-ai changes uncommitted | Yes: commit using the spec's suggested split and confirm a clean `git status` before building |
| R3 | Low | **No regression test for the crash the user reported.** The defensive `?? []` / `!= null` code has no test feeding a response without `gallery`/`logo`/`cover` (public) or without `media` (owner). The defensive code could be removed later as "redundant" with nothing catching it. | `src/frontend/src/test/organizerMediaBlocks.test.tsx` / `LayoutRenderer.test.tsx` (missing case) | Yes: one test rendering `LayoutRenderer` with an organization object that has no media fields |
| R4 | Low | Duplicate message after rejection ("To zdjęcie jest już dodane jako logo.") reads as if the image is live | `src/backend/app/organizations/media.py` (dedup messages), spec R5.1 | Yes, but it is a copy/spec decision |
| R5 | Low | An admin reversing a REJECTED gallery row to APPROVED can produce 4 public photos or a duplicate `sort_order` (code-review I1). The page still renders | `src/backend/app/organizations/media.py` `after_media_decide` (GALLERY early return) | No (product decision; admin-only edge case) |
| R6 | Info | `ModerationQueueEntry.media_kind` is not a discriminated union on the frontend (I7b, deferred) | `src/frontend/src/api/moderation.ts:24` | Yes (follow-up) |
| R7 | Info | Deploy-order and grants-password risks (the 3-subject cron fails fast before the 0054 grants, which stops all image moderation; re-running the grants rotates the cron password). `MODERATION_IMAGE_ENABLED` defaults to `false` in compose, so production must be checked | deploy process; `group-thing-ai/scripts/moderation_db_role.sql`; `docker-compose.yml` | Process (follow R-Deploy); the conditional `ALTER ROLE` is fixable |
| R8 | Info | `datetime.utcnow()` in `_set_sort_orders` (deprecated, matches the repo convention) | `src/backend/app/organizations/media.py` | Yes (optional) |

---

## 5. Functional completeness

**About 97%.** Every spec requirement now has code behind it, including R11 (reorder without storage). The only open requirement deviation is a copy choice (R4). What is left is runtime proof (R1) and release hygiene (R2), not missing functionality. Nothing blocks the user's goal of the organizer adding photos to their page.

---

## 6. Pragmatic action plan

| # | Action | Success criterion | Priority | Effort |
|---|---|---|---|---|
| 1 | Run `alembic upgrade head` on the local `aj` DB and restart the backend with the new code | `alembic_version = 0054`; `GET /api/organizations/mine` includes `media`; `/public/{slug}` includes `logo`/`cover`/`gallery` | Medium | 5 min |
| 2 | With moderation off, as the owner, upload a logo, a cover and 2 gallery photos on `/rodzinny-grajdolek?edit=1&tab=…` (Zdjęcia), then reorder and delete one, at phone width | All three appear on `/{slug}` without a reload; no console errors; the reorder persists after a refresh | Medium | 15 min |
| 3 | Turn moderation on, re-run the grants with the **current** cron password, restart the cron, upload a logo, and wait one tick | A `moderation_decisions` row with `ORGANIZATION_MEDIA` exists; the badge changes from "W weryfikacji" to on-page; the hero updates through polling | Medium | 20 min |
| 4 | Add a test that renders the organizer page from a response without media fields | The test fails if `?? []` is removed from `isGalleryEmpty` | Low | 10 min |
| 5 | Commit following the spec's split, including all `??` files; commit group-thing-ai separately | `git status` is clean; the image build contains `media.py` and `0054` | Required before deploy | 10 min |
| 6 | Production: app + 0054, then the grants (current password), then the cron; check `MODERATION_IMAGE_ENABLED` presence/value as on/off only | Product and avatar moderation never stops; org media is moderated | Required at deploy | — |

## 7. Deployment decision

**GO (conditional).** All Medium and Low code findings from iteration 1 (G2, G4, G6, W2, I2, I3, I5, I7c) are fixed and covered by tests, the copy is approved, and all three suites are green apart from the known HEAD baseline. Before production, items 5 and 6 are mandatory. I strongly recommend items 1–3: about 40 minutes to close R1, the only remaining gap with real uncertainty, which the user has already partly run into.
