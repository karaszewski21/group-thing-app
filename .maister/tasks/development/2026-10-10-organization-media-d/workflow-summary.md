# Workflow Summary — D: Zdjęcia organizacji (logo, okładka, galeria)

**Status:** completed (2026-10-11)
**Request:** "chce dodac u organizatora zdjecia do jego strony"

## What was built
- **Backend (group-thing-app):**
  - `organization_media` table (migration 0054; LOGO / COVER / GALLERY; cron column contract like `profile_avatars`).
  - `app/organizations/media.py`:
    - public read of the newest approved logo/cover plus an ordered gallery, in 2 SQL statements;
    - `/mine` owner view;
    - upload with slot rules: one pending row per slot, the last approved image stays until the new one is approved, sha dedup, a gallery of at most 3;
    - delete via `DELETE … RETURNING` (safe against cron races);
    - reorder;
    - a 15-min APScheduler sweep of superseded rows;
    - moderation hooks.
  - Moderation now uses a `_SUBJECTS` map (PHOTO / AVATAR / ORGANIZATION_MEDIA). `images.py` moved to `app/storage`.
  - The `/{slug}` preview adds `og:image` from the cover (user addition).
- **Frontend:**
  - Hero logo and a cover in every layout (fixed light text/ring on a strong scrim).
  - A `gallery` block after `about` in all 5 layouts, with a ghost CTA for the owner.
  - A "Zdjęcia" tab in the editor (immediate save; 10 s polling only while the tab is open; the tab follows `?tab=`).
  - The admin moderation card shows organization media.
- **group-thing-ai:** a third cron subject `ORGANIZATION_MEDIA`, grants for `organization_media`, and a README section (deploy order, password warning, smoke step).

## Phases
1, 2, 4 (mockups), 5 (spec), 6 (audit: 2 High → fixed in spec), 7 (plan: 15 groups / 84 steps), 8 (implementation in 8 waves), 10–11 (verification + 1 fix iteration → Passed), 12 (E2E, 2 iterations), 13 (user guide), 14.

## Quality
- **Tests:**
  - Backend: 751/751 full suite, plus 38/38 rerun after the user's `og:image` change.
  - group-thing-ai: 147/147.
  - Frontend: 801/818. The 17 failures equal the HEAD baseline (PanelPage, TermPage, extension-points, auth, foundation).
- **Static checks:** mypy 32 (baseline); ruff clean on changed files.
- **Reviews:** code review 0 critical / 0 warning; pragmatic "appropriate"; production GO with mitigations; reality GO.
- **E2E:** upload / limit / reorder / delete / dedup / replace / polling / cleanup all pass; no bugs. Not verifiable locally: approved-photo rendering and the admin card.

## User decisions during the workflow
- Spec audit fixes applied.
- Cover S1 copy approved.
- All fixable verification issues fixed.
- The cover is shown in every layout (user change, recorded in spec R22/R26).
- E2E used the real Spaces bucket (test photos deleted afterwards).

## Open items / follow-ups
- **Product:** an admin re-approving a REJECTED gallery photo can exceed 3; the copy "To zdjęcie jest już dodane jako logo." when re-uploading a rejected image.
- **Optional:**
  - a discriminated union for `media_kind` in `api/moderation.ts`;
  - an ownership re-check under the lock;
  - a partial index for the sweep;
  - a test for responses without media fields;
  - sheet covering the ghost CTA (cosmetic);
  - product/avatar uploads may also hold a DB connection during S3 puts.
- **Standards updates suggested:**
  - models/migrations: UUID PKs since 0041;
  - "new moderated upload type = one `_SUBJECTS` entry";
  - `themeTokenUsage` for new organizer files;
  - `uv run python -m <tool>`;
  - test helpers simulating cron/admin decisions must commit;
  - text over user photos uses `on-ink` on `scrim-strong`.
- **Local environment:** the backend was restarted with `SPACES_*` from the root `.env` and `AWS_CA_BUNDLE` (scratchpad bundle) to fix TLS to Spaces. `src/backend/.env` has no Spaces keys.

## Release runbook
1. Commit (see the plan below), including the untracked files (`media.py`, `0054`, new FE files). Build images from a clean tree.
2. On VPS A, a presence-only check that `MODERATION_IMAGE_ENABLED` is true.
3. Back up the DB, then deploy the app (compose runs `alembic upgrade head` → 0054).
4. Re-run `group-thing-ai/scripts/moderation_db_role.sql` with the **current** cron password. A different value rotates it and stops all moderation.
5. Deploy group-thing-ai (cron with 3 subjects), then the README org-media smoke step.
6. **Rollback:** stop the cron → `pg_dump -t organization_media` → `alembic downgrade 0053` **with the new image** → redeploy the old image. This destroys the org media rows; prefer fix-forward.

## Suggested commits
- group-thing-app:
  1. `refactor(storage): move image processing to app/storage` (`git mv` already staged, plus the product/users import changes)
  2. `feat(organizations): organization media — logo, cover, gallery with moderation` (backend + 0054 + tests + og:image)
  3. `feat(organizer): photos tab, hero cover/logo and gallery block` (frontend)
- group-thing-ai:
  4. `feat(moderation): organization media as third cron subject` (merge/deploy only after step 4 of the runbook)
