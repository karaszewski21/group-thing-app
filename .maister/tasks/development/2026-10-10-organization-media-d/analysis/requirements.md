# Requirements — D: Zdjęcia organizacji

## Initial description
User: "chce dodac u organizaotra zdjecia do jego storny" — the organizer can add photos to their public page.
Research task D (+ D2 gallery block): `analysis/research-context/research-report.md` §10.3, task table l.857-858.

## Q&A (all rounds)
### Phase 1 (analysis/clarifications.md)
- Scope: logo + cover + gallery block; og:image out of scope.
- Management: new "Zdjęcia" tab in the appearance EditorSheet; immediate save, outside the draft.
- Migration 0054 for D; task C takes the next free number (update B/HLD notes).
- Gallery max **3** photos.
### Phase 2 (analysis/scope-clarifications.md)
- Gallery in all 5 layouts (after `about`); cover only in `cover` hero (CLASSIC, CIRCLES); logo in all hero variants.
- Superseded logo/cover: periodic APScheduler sweep; newest APPROVED shown; takedown → empty slot, older never resurfaces.
- I-1…I-10 accepted: ORGANIZATION_MEDIA + subject map; REJECTED visible to owner with Usuń, not counted, files removed on owner delete / next upload to slot; accept CDN cache parity; move images.py to app/storage/images.py; moderation off → auto-APPROVED, storage off → 409 + empty public media; routes `/api/organizations/{organization_id}/media` (POST multipart kind, DELETE /{media_id}, PATCH /order); dedup per kind; pending only in Zdjęcia tab; ghost CTA opens Zdjęcia tab.
### Phase 4
- ASCII mockups approved as-is (gallery after `about`, also above terms in CLASSIC; no delete confirmation; "Wysyłanie…" without %).
### Phase 5
- **User journey**: entry only via the settings icon on the owner's public page (Zdjęcia tab) and the empty-gallery ghost "Dodaj zdjęcia →" (`?edit=1&tab=zdjecia`). No panel shortcut. Personas: organization owner (upload/manage), visitors/parents (see approved media), admin (moderates in existing photo moderation page), cron (AI moderation).
- **Code reuse confirmed**: product image processing and limits (JPG/PNG/WebP, 15 MB, WebP 1600/400), ItemGalleryEditor pieces (ModerationBadge with labels prop, PhotoFileField with label/multiple props, up/down rows), SafeImage, avatar-style status notes; ProfileAvatar migration/columns as cron contract; ProductPhoto service patterns (lock parent, dedup, renumber, reorder permutation, outbox file delete).
- **Visual assets**: ASCII mockups in `analysis/design-context/` are sufficient (binding); match existing organizer page style.

## Functional requirements summary
1. Owner uploads LOGO (1 slot), COVER (1 slot), GALLERY (≤3) via multipart; server validates/processes (WebP 1600/400), stores private until approved (public immediately when moderation disabled).
2. One pending upload per LOGO/COVER slot; new pending replaces older pending/rejected in that slot; current approved stays public until the new one is approved.
3. Owner deletes any own media row (approved, pending, rejected); gallery renumbers; storage files deleted via outbox.
4. Owner reorders gallery (full permutation, PATCH /order; stale list → 409).
5. Public organization response embeds approved media (logo, cover, gallery) — single query; organizer page renders logo in all heroes, cover in `cover` hero, gallery block in all layouts (hidden when empty for visitors; owner ghost with CTA).
6. Owner data (`/mine`) embeds all non-superseded media with status + presigned URLs; Zdjęcia tab polls every 10 s while PENDING/NEEDS_REVIEW.
7. Moderation: new subject ORGANIZATION_MEDIA in app (list, decide, delete, admin label "Organization · {name} · {kind}") and in group-thing-ai cron (Subject, grants, tests). Admin takedown leaves the slot empty.
8. Periodic sweep deletes superseded LOGO/COVER rows and their files.
9. Errors in Polish: storage unavailable 409, duplicate 409, limit 409, stale order 409, invalid/too large 400.

## Reusability
See analysis/codebase-analysis.md §templates; images.py relocation; ModerationBadge/PhotoFileField props; SECTION_LABEL export.

## Scope boundaries
In: above. Out: og:image / twitter large card (D2 part), lightbox, drag & drop, CDN purge, task C content (tagline/description), panel shortcut.

## Technical considerations
- Deploy order: app + 0054 → re-run moderation_db_role.sql → deploy cron (cron before grants stops all image moderation). Rollback: stop cron before downgrade.
- Public org endpoint needs its own query-count test.
- Lock organization row (FOR UPDATE, no version bump) after S3 put; don't hold ORM photo rows across awaits (cron bumps updated_at).
- LayoutRenderer must evaluate `isEmpty` for the non-directory gallery block.
- Never print env/secret values.
