# Workflow summary — Featured items („Wyróżnione rzeczy”)

**Status:** completed 2026-11-28 · branch `feature/gooo-the-best-items` · work uncommitted (by user rule)

## What was built
- Owners feature listed items from „Moje rzeczy” (`PUT /api/item-listing-preferences/{item_id}/featured`, `featured_at` on `item_listing_preferences`, migration 0111); the mark clears on unlisting and hand-over, stays on mode/visibility change.
- „⭐ Wyróżnione” badge on item tiles, the product header and previews; featured-first on term pages, the event preview window and owner/profile/organization items (search and wants unchanged).
- New `app/settings` module: single-row `app_settings` (`max_featured_items` 0–20, seed 3, migration 0110), ADMIN `GET`/`PUT /api/admin/settings` (matrix row 74), admin page `/admin/settings`.

## Verification
- Backend 1937 passed / 2 stale baseline; frontend 2197 passed / 52 pre-existing env failures (phase 8/11).
- Verification passed with issues (no blocking); E2E 8/8, GO WITH CAVEATS — the one minor finding (featured badge covering the offer badge on narrow `ItemCard` tiles) fixed 2026-11-28 and confirmed on recaptured screenshots.
- User guide: `documentation/user-guide.md` (Polish, 16 screenshots).

## Skipped phases
- 3 and 9 (TDD gates): no reproducible defect.

## Open before merge
- **Group 10 (deferred):** when rebasing onto `main` after the email module lands (0110–0112, likely matrix row 74), renumber 0110/0111, the migration test, matrix row 74 and the runbook lines in `architecture.md`/`INDEX.md`. Skipping it gives two Alembic heads and a failing matrix test.
- Nothing committed yet.
