# Scope Clarifications — Phase 2 (2026-10-10)

## Critical
- **C-1 Layout placement → A**: gallery block (max 3) in **all 5 layouts**; cover only in the `cover` hero variant (CLASSIC, CIRCLES); logo in all hero variants. The "Zdjęcia" tab tells the owner where the cover is shown.
- **C-2 Superseded logo/cover cleanup → B (periodic app sweep)**: public read always picks the newest APPROVED per LOGO/COVER; the existing APScheduler periodically deletes superseded rows (older APPROVED/REJECTED rows of a slot that has a newer APPROVED) and stages their files via the OBJECTS_DELETE outbox. After an admin takedown the slot is empty (initials) — an older approved image never resurfaces (sweep/read rule must guarantee this).

## Important (all recommendations accepted)
- I-1 Subject `ORGANIZATION_MEDIA` + subject→model map in moderation service (`_set_photo_files_public`, `list_photos`, `decide`, `delete_upload`); admin label "Organization · {name} · {kind}".
- I-2 REJECTED files deleted when the owner removes them or uploads a new photo to the same slot; otherwise the row stays (sha dedup blocks re-upload).
- I-3 Owner sees REJECTED with note "Odrzucone przez moderację — dodaj inne zdjęcie" + Usuń; REJECTED does not count toward the gallery limit of 3.
- I-4 Accept 1-year immutable CDN cache on takedown (parity); document.
- I-5 Move `app/product/images.py` → `app/storage/images.py` now.
- I-6 `moderation_image_enabled=false` → auto-APPROVED + public (parity); storage unconfigured → upload 409, public read returns empty media.
- I-7 Routes `/api/organizations/{organization_id}/media` (POST multipart `kind`, DELETE `/{media_id}`, PATCH `/order`) + ownership check; no PUT.
- I-8 sha256 dedup per kind: UNIQUE(organization_id, kind, content_sha256).
- I-9 Pending photos visible only in the Zdjęcia tab; hero shows approved.
- I-10 Empty-gallery owner ghost has a CTA opening the editor on the Zdjęcia tab.

## From Phase 1
- Gallery max 3; one pending upload per LOGO/COVER slot; last approved stays public until new approved; og:image out of scope; migration 0054 (task C → next free number, update B/HLD notes).
