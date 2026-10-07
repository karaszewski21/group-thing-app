# Deep dive: organizer content, media moderation, and public read model

**Category:** deep-content | **Date:** 2026-10-07
**Paths:** backend paths are relative to `src/backend/`, frontend paths to `src/frontend/src/`. `group-thing-ai/` is the sibling repo `../group-thing-ai` (VPS B).
**Builds on:** `outputs/research-report.md` §8 and §11 (D4, D5), and `codebase-backend-current-state.md`.

---

## 0. Summary (TL;DR)

| Topic | Recommendation | Confidence |
|---|---|---|
| Text fields (tagline, bio, location) | Plain nullable `VARCHAR` columns on `organizations`. Moderated with `check_text` (Bielik) using new `TextField` members. Clone the `user_profiles.bio` precedent (migration 0050). | High |
| Contact/social links | One `links JSONB NULL` column on `organizations` holding a Pydantic-validated list (`kind` allowlist, `https` only, at most 6 entries). Not text-moderated; validated structurally. | Medium-High |
| Logo, cover, gallery | A new table `organization_media` (kind `LOGO`/`COVER`/`GALLERY`). It reuses the exact moderated-image column set of `product_photos`/`profile_avatars`, so the VPS B cron needs only a new `Subject` and new grants. | High |
| Public page while an image is pending | Owner sees the pending image (signed URL, badge "w weryfikacji"). Visitors see the **last approved** logo/cover. If none exists, the hero falls back to the primary colour and initials. Pending gallery items are invisible to visitors. | Medium-High |
| Stats | Computed at read time, never stored: circle count, upcoming term count, family count (aggregate, PUBLIC circles only, suppressed below a threshold). Location is the text field. Gallery count comes from the media table. | Medium |
| New public endpoint | `GET /api/groups/public/organizers/{slug}`, owned by `app.groups` (it already depends on organizations through `organizations_acl`). It needs a new PUBLIC matrix row ahead of row 26. The response is capped (no paging) and the query count is constant (about 12). An optional paged `/terms` sub-resource serves the SCHEDULE layout. | High (placement) / Medium (shape) |
| Privacy | Only PUBLIC circles and their terms. No guardian or lister names, no children data, counts only. PRIVATE circles are excluded entirely (decision point). | High |
| PATCH | Switch `UpdateOrganizationRequest` to `model_fields_set` semantics: explicit `null` clears nullable fields; `name`/`page_layout` reject `null`. Safe because the frontend omits untouched fields. | High |
| Split | Task A: theme + `page_layout` + PATCH semantics. Task B: public read model endpoint. Task C: text content + links. Task D: organization media + cron (two repos). | High |

---

## 1. Existing moderation infrastructure (as built, not as researched)

The 2026-10-01 research proposed an outbox worker. The **built** system differs, and the code is the source of truth:

### 1.1 Text: synchronous Bielik-Guard on write

- `app/moderation/text_guard.py:66-87`, `check_text(field, new, current)`:
  - no-op when `settings.moderation_text_enabled` is off (`app/config.py:44`) or the value is blank or unchanged after whitespace normalisation (`:71-75`);
  - otherwise scores in a thread (`:81`);
  - raises `TextModerationRejected` (400) with a field-specific Polish message if any label is at or above `moderation_text_reject_threshold` (default 0.8, `app/config.py:49`);
  - raises `ModerationUnavailable` (503) when the classifier is missing or fails (`:78-84`). **It fails closed.**
- Fields are an enum with a **mandatory message per member**. `MESSAGES[field]` is indexed directly at `:87`, so a new member without a message causes a `KeyError` on rejection (`text_guard.py:18-48`). Existing members: `ORGANIZATION_NAME, GROUP_NAME, TERM_DESCRIPTION, PRODUCT_NAME, PRODUCT_DESCRIPTION, PROFILE_NAME, PROFILE_BIO`.
- Texts never enter the queue. `PRODUCT_TEXT` decisions survive only as old audit rows (`app/moderation/service.py:1-11`). An admin decision on text is a 400 (`app/moderation/schemas.py:33-40`).
- Call-site precedents:
  - organization name: `app/organizations/service.py:140` (`check_text(TextField.ORGANIZATION_NAME, data.name, organization.name)`);
  - profile bio: `app/users/service.py:112-125`. A blank bio is normalised to `None` (`bio = data.bio or None`), then checked against the current value;
  - group name: `app/groups/application/circles.py:37,168`;
  - term description: `app/groups/application/terms.py:36,110`.
- Regex contact-info rule: `app/moderation/rules.py:11-36` (`ensure_no_contact_info`) rejects phones, e-mails, URLs and messenger names. It applies **only to product texts** (`app/product/service.py:146,165,193,513`, `app/plugin/service.py:152`), not to org name or term description. Its message hard-codes "Nazwa i opis" (`rules.py:11-14`).

### 1.2 Images: Spaces + VPS B cron (ShieldGemma-2), private until approved

- **Storage:** `app/storage/service.py`.
  - Objects are written `private` or `public-read`; the CDN serves only public ones (`:1-4`, `:68-77`).
  - Keys are immutable, so the cache is permanent (`:19-21`).
  - `presigned_url` gives a 10-minute origin link for non-approved objects (`:22`, `:103-111`).
  - `get_storage()` returns `None` when the `SPACES_*` settings are unset, which means upload is disabled (`:126-129`).
- **Sanitising:** `app/product/images.py:15-70`.
  - Limits: 15 MB, 50 MP, JPEG/PNG/WebP only.
  - EXIF is transposed and all metadata dropped.
  - Two WebP sizes are written: `w1600` (large) and `w400` (thumb). Scaling uses `ImageOps.contain`, **no crop** (`:35-40`).
  - The SHA-256 of the original is kept for de-duplication.
- **Moderated table contract.** The cron reads and writes the same columns in every table:
  - `app.moderation` uses `id, storage_key, content_sha256, status, moderation_attempts, moderation_retry_at, created_at, updated_at`, plus a partial claim index `WHERE status='PENDING'` (migration `alembic/versions/0051_profile_avatars.py:1-41,64-96`, product photos in 0046/0049);
  - the matching definition on the cron side is `group-thing-ai/app/photo_store.py:79-115`: `_moderated_table(name)`, `Subject(table, subject_type, label)` and `SUBJECTS = (PRODUCT_PHOTO, PROFILE_AVATAR)`;
  - the least-privilege role grants **per table** live in `group-thing-ai/scripts/moderation_db_role.sql:41-60`, and `REQUIRED_PRIVILEGES` is derived from `SUBJECTS` (`photo_store.py:149-157`). A startup self-check exits when a grant is missing, and `tests/test_deploy_artifacts.py` fails if the grants drift.
  - The cron flips both file ACLs to public **before** writing APPROVED (`group-thing-ai/app/photo_moderation.py:107-125`). Keys are derived as `storage_key + "/w1600.webp"` and `"/w400.webp"` (`photo_store.py:193-198`).
- **Status enum:** `PENDING, APPROVED, NEEDS_REVIEW, REJECTED` (`app/moderation/status.py:10-14`). Audit log: `moderation_decisions` (`app/moderation/models.py:43-70`):
  - `subject_type` is `String(20)` with members `PHOTO/AVATAR/PRODUCT_TEXT` (`:22-25`);
  - `subject_id` has no FK (`:52-53`).
- **Admin side** (`app/moderation/service.py`):
  - `list_photos` is a `union_all` of product photos and avatars with a shared column shape (`:142-211`);
  - `decide` picks the model by subject type (a two-way `if`), sets ACLs idempotently, writes the status and appends a decision (`:251-288`);
  - `delete_upload` probes `ProductPhoto` first, then the avatar (`:291-297`);
  - `list_queue` covers **only product photos** (`:124-139`), but the admin UI uses `/photos` (`api/moderation.ts:31-49`), so the gap does not matter;
  - the decision request `Literal` limits subject types to `PHOTO | AVATAR` (`schemas.py:37`).
- **Two precedents for "who sees what":**
  - Product photo (`app/product/service.py:359-373`, `visible_photo_views`): APPROVED for everyone; the owner also sees PENDING/NEEDS_REVIEW with a status; REJECTED for no one. A pending product photo **withdraws the item from terms** (`:386-440`, `on_pending_photo`).
  - Avatar (`app/users/service.py:139-195`): one row per profile (`UNIQUE user_profile_id`, `0051:88`). Upload **replaces immediately**: the previous row is deleted and its files are removed through the outbox (`:183-189`). While the new avatar is pending, there is no approved avatar at all. Today the avatar is returned only on the caller's own profile (`app/users/router.py:59-65`, `app/users/schemas.py:56-57`), so there is **no public avatar precedent yet**. The organizer logo would be the first public-facing non-product image.
- Without image moderation (`moderation_image_enabled=False`, `config.py:45`), uploads are written public and APPROVED immediately (`users/service.py:171-182`, `product/service.py:425-433`).
- File deletion always goes through the outbox (`storage.objects_delete`, `app/storage/outbox_listener.py:145-158`), staged in the same commit as the row delete.

---

## 2. Content fields: storage, limits, moderation

Prototype reference: `pages/ProfilMobilny.tsx:383-405`. It has a hero image, avatar, name, a tagline ("Zajęcia umuzykalniające dla dzieci 0–6 lat · Poznań, Jeżyce"), stats tiles (Miejsce / Rodziny 32 / Galeria) and a two-paragraph bio with highlights. Its data mocks are at `:324-334`.

| Field | Storage | Type / limit | Validation | Moderation | Public read |
|---|---|---|---|---|---|
| `tagline` | column `organizations.tagline` | `VARCHAR(160) NULL` | strip whitespace; blank → `NULL`; single line (reject `\n`) | `check_text(ORGANIZATION_TAGLINE)`; **optionally** `ensure_no_contact_info` (decision D-C2) | as-is; also feeds OG `og:description` (`app/system/public_preview.py:60-61` currently uses a generic sentence) |
| `bio` | column `organizations.bio` | `VARCHAR(2000) NULL` (user bio is 1000, `users/models.py:67`, term description 2000, `groups/models.py:229`) | strip; blank → `NULL`; plain text, paragraphs by `\n\n`, **no HTML/Markdown** (render as text; prototype highlights `mv-hl` are dropped or become a later feature) | `check_text(ORGANIZATION_BIO)`; long texts are scored as a whole, same as term description | as-is |
| `location` | column `organizations.location` | `VARCHAR(120) NULL` (city / district, e.g. "Poznań, Jeżyce") | strip; blank → `NULL` | `check_text(ORGANIZATION_LOCATION)` (it is user text) | "Miejsce" stat tile. **No geo or lat-long**: `Term` and `Group` have no location column (`groups/models.py:97-117,215-229`), so a per-term place ("Sala nr 2") is not available. Adding it to `Term` is a separate scope. |
| `links` (contact/social) | column `organizations.links JSONB NULL` | list of at most 6 `{kind, url}` items | Pydantic `OrganizationLink`: `kind ∈ {WEBSITE, INSTAGRAM, FACEBOOK, TIKTOK, YOUTUBE, EMAIL, PHONE}`; `url` max 300; `https://` only for web kinds, with a per-kind host allowlist (e.g. `instagram.com`, `facebook.com`); EMAIL is a validated address rendered as `mailto:`; PHONE is a normalised `+48…` rendered as `tel:`; no duplicate kinds | **not** Bielik (it cannot judge URLs). Structural validation is the control. Frontend renders `rel="nofollow noopener ugc" target="_blank"` | as-is |
| `logo` | `organization_media` row, `kind=LOGO` | at most one live + one pending | `images.process_upload` | VPS B cron, subject `ORGANIZATION_MEDIA` | thumb `w400` URL, only APPROVED |
| `cover` | `organization_media`, `kind=COVER` | at most one live + one pending | same; displayed with `object-fit: cover` (no server crop; `images.py:35-40` uses `contain`) | same | large `w1600` URL, only APPROVED; also usable as `og:image` |
| `gallery` | `organization_media`, `kind=GALLERY`, `sort_order` | at most 12 non-rejected (product limit is 10, `product/models.py:62-68`) | same, plus duplicate SHA per org → 409 (product precedent `product/service.py:404-407`) | same | APPROVED only, ordered |
| stats | **not stored** | — | — | — | computed in the read model (§4.4) |

**Why columns plus one JSONB, not a profile table.**
- `Organization` is 1:1 with its profile, and the docstring decision is "simple flat columns rather than a separate branding table" (`app/organizations/models.py:55-60`).
- The `user_profiles.bio` precedent is a single `add_column` (`alembic/versions/0050_user_profile_bio.py:26-31`).
- `models.md` says "Use a JSONB column or a simple association table for value collections rather than a full mapped class" (`.maister/docs/standards/backend/models.md:9`). Links are exactly such a value collection: no identity, no lifecycle, always replaced whole. There is no `MutableDict` in the codebase, so the column is always reassigned (`codebase-backend-current-state.md` §10).

**Why images go in a table.** They have identity (id = moderation `subject_id`), a lifecycle (PENDING→…), and the cron contract requires a table with the moderated column set (§1.2).

**Content is separate from theme** (report §6.2): a layout switch never touches these columns.

### 2.1 Migration sketch (Task C: text plus links)

```python
op.add_column("organizations", sa.Column("tagline", sa.String(160), nullable=True))
op.add_column("organizations", sa.Column("bio", sa.String(2000), nullable=True))
op.add_column("organizations", sa.Column("location", sa.String(120), nullable=True))
op.add_column("organizations", sa.Column("links", postgresql.JSONB(), nullable=True))
```

- No backfill is needed.
- The DB has no CHECK on `links`: the shape belongs to the Pydantic model, the same as `plugin_data`.
- Add `TextField.ORGANIZATION_TAGLINE/ORGANIZATION_BIO/ORGANIZATION_LOCATION` together with their `MESSAGES` (`text_guard.py:18-48`), for example "Opis organizacji narusza zasady społeczności. Zmień go i spróbuj ponownie."

---

## 3. Organizer images: `organization_media` design and moderation path

### 3.1 Table (Task D, migration in group-thing-app)

```text
organization_media
  id                  UUID PK  (gen_random_uuid; = moderation subject_id)
  organization_id     UUID NOT NULL FK organizations.id
  kind                VARCHAR(10) NOT NULL     -- LOGO | COVER | GALLERY  (_enum_column native_enum=False)
  storage_key         VARCHAR(200) NOT NULL    -- "organizations/{org_id}/{media_id}"
  width, height       INTEGER NOT NULL
  size_bytes          INTEGER NOT NULL
  content_sha256      VARCHAR(64) NOT NULL
  status              VARCHAR(20) NOT NULL     -- ModerationStatus
  sort_order          INTEGER NOT NULL DEFAULT 0  -- dense 0..n-1 for GALLERY; 0 for LOGO/COVER
  uploaded_by_user_id UUID NOT NULL FK users.id
  moderation_attempts INTEGER NOT NULL server_default 0
  moderation_retry_at TIMESTAMP NULL
  created_at, updated_at TIMESTAMP NOT NULL   (BaseEntity; updated_at = version_id_col)
  UNIQUE (organization_id, content_sha256)
  INDEX  ix_organization_media_org_kind_status (organization_id, kind, status)
  INDEX  ix_organization_media_pending_created_at (created_at, id) WHERE status='PENDING'   -- cron claim index, same as 0051:91-96
```

- The column names and types for the cron are **identical** to `profile_avatars` (`0051:73-81`). That is the contract stated in `group-thing-ai/app/photo_store.py:79-81` ("the app keeps them identical in every moderated table").
- `ModerationSubjectType.ORGANIZATION_MEDIA` has 18 characters and fits `String(20)` (`app/moderation/models.py:49-51`). A single subject type per table keeps the cron mapping one-to-one (`Subject(table, subject_type)`). The kind is visible via a join, so separate `ORG_LOGO`/`ORG_COVER` types are unnecessary.

### 3.2 Upload flow (clone of `set_my_avatar` / `add_product_photo`)

1. `POST /api/organizations/{organization_id}/media?kind=LOGO|COVER|GALLERY`, multipart `file`, `EditPrincipal`.
   - Read at most `MAX_UPLOAD_BYTES + 1` (`app/users/router.py:84-96`).
   - Matrix row 50 already covers POST under `/api/organizations(/.*)?` (`app/core/authorization_matrix.py:184`).
2. Service:
   - `storage is None` → 409 "Dodawanie zdjęć jest chwilowo niedostępne" (`users/service.py:128,159-160`);
   - `process_upload` in a thread;
   - owner check, the same as `update_organization` (`organizations/service.py:133-138`);
   - **lock the organization row** (`with_for_update`) so concurrent uploads serialise, as `_lock_product` does;
   - duplicate SHA → 409; gallery limit → 409.
3. Approval state:
   - `approved = not settings.moderation_image_enabled`;
   - status is PENDING or APPROVED;
   - `storage.put(..., public=approved)` for both sizes.
4. Commit. On any failure, roll back and `storage.delete` the new keys (`users/service.py:183-194`).
5. Response: `OrganizationMediaResponse{id, kind, url, thumb_url, status, sort_order}`. URLs are public once approved, otherwise presigned (`product/service.py:346-356`).

Other routes:
- `DELETE /api/organizations/{id}/media/{media_id}` (owner) deletes the row and stages `storage.objects_delete` through the outbox.
- `PUT|PATCH /api/organizations/{id}/media/order` reorders the gallery (clone of `reorder_product_photos`, `product/service.py:483-498`).
- **Matrix gap:** row 50 is `POST, PATCH` only. `DELETE /api/organizations/...` today falls to the catch-all `AUTHENTICATED` (`authorization_matrix.py:231`). Add a row such as `(_methods("DELETE"), r"^/api/organizations/[^/]+/media/[^/]+$", ("EDIT","mcp:edit"))` ahead of the catch-all, or extend row 50's methods to `POST, PATCH, DELETE`. Use PATCH for reorder (not PUT) to stay inside row 50. Add cases to `tests/test_authorization_matrix.py`.

### 3.3 Pending, approved and what the public page shows

**Option A: avatar parity.** Replace on upload; the previous approved logo or cover is deleted immediately.
- Simple: a `UNIQUE(organization_id)` per kind is possible.
- But the public hero loses its image for the whole review window, which can be hours when the result is NEEDS_REVIEW. That hurts a public branding page.

**Option B (recommended): keep the last approved image live until the new one is approved.**
- On LOGO/COVER upload, delete any older **non-APPROVED** row of that kind (PENDING, NEEDS_REVIEW or REJECTED; files via outbox), then insert the new PENDING row. Approved rows are left alone.
- Public read: the **newest APPROVED** row per kind (`ORDER BY created_at DESC LIMIT 1`, or `DISTINCT ON (kind)` in one query for both kinds).
- Clean-up of superseded APPROVED rows happens on the owner's next upload or delete of that kind, and in the owner's media listing: delete APPROVED rows older than the newest APPROVED. The cron cannot do this: it only updates status (`moderation_db_role.sql:50-53`). Reads stay side-effect free; an extra 0.3 MB object until the next owner action is negligible (`research 2026-10-01` §cost).
- Edge case: an admin takedown (REJECTED) of the newest approved logo automatically reveals the previous approved one. This is acceptable, because it was itself approved. Document it.
- Invariant enforced in the service under the org-row lock: for each organization and LOGO/COVER kind, at most one non-approved row exists. A partial unique index `(organization_id, kind) WHERE status IN ('PENDING','NEEDS_REVIEW') AND kind <> 'GALLERY'` can back this, migration-only like the claim index.

**Visibility matrix** (mirrors `visible_photo_views`, `product/service.py:359-373`):

| Viewer | LOGO/COVER | GALLERY |
|---|---|---|
| Visitor / public endpoint | newest APPROVED, else none → hero uses primary colour and initials (report §8 "hero z kolorem primary") | APPROVED only |
| Owner (`GET /api/organizations/mine/media` and the editor) | newest APPROVED **and** the pending one with a status badge ("W weryfikacji" / "Odrzucone — dodaj inne") via a presigned URL | all non-REJECTED, plus REJECTED with a badge so the owner can delete it |
| Admin | via the extended `/api/moderation/photos` union | same |

- Unlike product photos, a pending organizer image **does not block anything else**. There are no listings to withdraw, because the image is not on the public page until approved.

### 3.4 Changes required in `app.moderation`

1. `ModerationSubjectType.ORGANIZATION_MEDIA` (`models.py:22-25`).
2. Add a third `select` to the `list_photos` `union_all` (`service.py:151-187`):
   - `OrganizationMedia.id`, the literal subject type, `NULL` product id, `Organization.name` as the title, `storage_key`, `status`, `created_at`;
   - plus a third count;
   - extend the `QueueEntry` and `ModerationQueueEntryResponse` docstrings ("`product_name` holds the profile's/organization's name").
3. `decide` model switch (`service.py:267`) becomes a dict `{PHOTO: ProductPhoto, AVATAR: ProfileAvatar, ORGANIZATION_MEDIA: OrganizationMedia}`. `_set_photo_files_public` typing (`:73-74`) must include the new model; it only needs `large_key/thumb_key`.
4. `delete_upload` (`service.py:291-297`) gets a third probe that delegates to `organizations.service.delete_media_as_admin`.
5. `ModerationDecisionRequest.subject_type` `Literal` gets the new member (`schemas.py:37`).
6. Frontend admin `api/moderation.ts` types and the admin photos view (label "Organizacja").
7. **Import direction:** `app.moderation.service` already imports `app.product` and `app.users`; importing `app.organizations.models` follows the same pattern.

### 3.5 Changes required in group-thing-ai (VPS B), a second repo and deploy

- `app/photo_store.py:112-115`: add `ORGANIZATION_MEDIA = Subject(_moderated_table("organization_media"), "ORGANIZATION_MEDIA", "organization image")` and append it to `SUBJECTS`. The cron alternates subjects per tick.
- `scripts/moderation_db_role.sql:41-53`: add `GRANT SELECT(...)` and `GRANT UPDATE(...)` on `public.organization_media`; update the header comment.
- `tests/test_deploy_artifacts.py`: grants must match `REQUIRED_PRIVILEGES`.
- **Deploy order:**
  1. App migration.
  2. Re-run `moderation_db_role.sql`.
  3. Deploy the cron.
- Without step 2 the cron's startup self-check exits (`moderation_db_role.sql:12-14`).
- Until the cron is deployed, the new rows simply stay PENDING. They never fail open, and an admin can still decide them.

---

## 4. New public endpoint: organizer's circles, terms and exchange

### 4.1 Placement and path

**Recommended:** `GET /api/groups/public/organizers/{slug}`, in `app/groups/router/circles.py` (or a new `router/organizer_page.py`).

- **Dependency direction.** `app.groups` → `app.organizations` already exists via the ACL (`app/groups/infrastructure/organizations_acl.py:1-19`, "the ONLY `app.groups` module that imports the organizations vertical"). Putting circles and terms under `/api/organizations/public/{slug}/…` would make `app.organizations` import `app.groups`, which is a new reverse dependency and a cycle risk (`exchange_summary.py:13-18` documents existing cycle workarounds).
- **ACL additions:**
  - `organizations_acl.get_organization_by_slug(db, slug)`;
  - `organizations_acl.get_owner_party_id(db, organization_id)`;
  - a new `organizations.service.get_owner_party_id`, the reverse of `get_own_organization` (`organizations/service.py:77-94`): `OrganizationMembership(valid_to IS NULL)` joined to `OrganizationRole(OWNER).party_id`.
  - Note that `Organization.party_id` is the **organization's own party**, not the owner's (`organizations/models.py:70-74`, `service.create_own_organization:97-127`).
- **Matrix:**
  - `^/api/groups/public/[^/]+$` does **not** match a three-segment path (`authorization_matrix.py:86`), and neither does `/access` (`:93`);
  - the request would fall to row 26 `GET ^/api/groups(/.*)?$` READ (`:125`);
  - so add a PUBLIC row **next to `:86`/`:93`, ahead of row 26**: `(_methods("GET"), r"^/api/groups/public/organizers/[^/]+(/terms)?$", "PUBLIC")`.
  - FastAPI route order: `/api/groups/public/{group_id}` takes `group_id: uuid.UUID` and a single segment, so there is no collision. Register the new route near the other `/public` routes anyway (`router/circles.py:112-131` docstring on ordering).
  - Add a `test_resolveRequirement_publicOrganizerPage_isPublic` and a regression test asserting `/api/groups/public/{uuid}` is still PUBLIC.
- **Organizers without an Organization** (`k-…` fallback slug, `groups/domain/organizer_slug.py:10-20`) have no organizer page today (`GET /api/organizations/public/{slug}` returns 404). The new endpoint also returns 404 for them. It does not try to reverse the blake2s hash.

**Alternative:** fold everything into `GET /api/organizations/public/{slug}`. That gives one request and zero FOUC for content, but needs the reverse dependency. Rejected. The frontend fires both requests in parallel: the org payload (theme plus content) gates the first paint, and sections render skeletons until the groups payload arrives. The theme is not delayed (report §5.4).

### 4.2 Response shape

```jsonc
// GET /api/groups/public/organizers/{slug}
{
  "circles": [                       // PUBLIC circles actively led by the org owner; ordered by next_term.occurs_on NULLS LAST, then name
    {
      "id": "uuid", "name": "Muzyczne Maluchy",
      "layout_mode": "CIRCLE",       // existing Group.layout_mode (mini-visualization in CIRCLES layout)
      "next_term": { "id": "uuid", "occurs_on": "2026-10-12T16:30:00", "attendee_count": 7 } | null,
      "upcoming_term_count": 4       // within the window (see caps)
    }
  ],
  "upcoming_terms": [                // flattened agenda across circles, ascending, capped
    { "term_id": "uuid", "group_id": "uuid", "group_name": "…", "occurs_on": "…",
      "description": "…" | null,     // already text-moderated on write (terms.py:36,110)
      "attendee_count": 7 }
  ],
  "exchange": {
    "counts": { "GIFT": 3, "SWAP": 4, "LEND": 0 },   // ReservationType values used by ItemListingPreference.mode
    "items": [ { "item_id": "uuid", "product_name": "…", "condition": "GOOD",
                 "mode": "SWAP", "thumb_url": "https://cdn…/w400.webp" | null,
                 "term_id": "uuid", "group_id": "uuid" } ]   // link target = that term page
  },
  "stats": { "circle_count": 3, "upcoming_term_count": 9, "family_count": 32 | null }
}
```

- The links the frontend builds are `/${slug}/grupa/${group_id}/term/${term_id}`. The slug comes from the request, and here it is validated, because it resolved the org.
- `attendee_count` and `family_count` are aggregates. That is the same exposure class as what `PublicCircleResponse` already gives for public terms, which is in fact more: it names guardians (`public_view.py:267-279`).
- `thumb_url` is the first **APPROVED** product photo only (`visible_photo_views(..., is_owner=False)`), via the public CDN URL.

### 4.3 Privacy rules

| Rule | Source / reason |
|---|---|
| Only `Group.visibility == PUBLIC` circles. PRIVATE circles are **omitted entirely**: not even a name or a count. | `public_view.py:199-213` gives a reduced view for PRIVATE only to someone who already has the link. Listing private circles on a public directory would disclose their existence. Decision D-P1: a later owner toggle could show "Prywatna grupa — poproś o dołączenie" (name only). |
| "Private terms" do not exist as a concept. Term privacy comes from group visibility (`groups/models.py:83-95,215-229` has no term visibility column). | So terms come only from PUBLIC circles. |
| Only active leadership (`Leadership.valid_to IS NULL`) of the **current** owner party. | `circles.py:245-250` (`list_active_leaderships_for_party`). Circles handed to another organizer leave the page. |
| Terms: `occurs_on >= now()` only (agenda). No fallback to past terms. | Unlike `public_view.py:220-225`, which falls back to the latest past term so a single page is never empty, the organizer page is an agenda. |
| **No personal names**: no guardian list, no `lister_display_name`, no `lister_party_id`, no `claimed_by_*`. | Data minimisation. The term page already shows names to whoever opens a term; the directory must not aggregate them across circles. |
| No children data beyond nothing. Even `child_count` sums are excluded from the organizer page. | `PublicCircleResponse` docstring (`groups/schemas.py:292-296`). |
| Withdrawn RSVPs are excluded from counts. | `repository.count_active_attendances_by_term` (`infrastructure/repository.py:373-390`). |
| `family_count` covers PUBLIC circles only and is **suppressed (`null`) below 3** (decision D-P2) to avoid "1 family" re-identification in a small village group. | Design judgment. |
| Exchange items: only `AVAILABLE` balance, only listers eligible for the circle's **next** term (attendees plus organizer), only products with no unmoderated photos (already enforced: a pending photo withdraws listings, `product/service.py:386-440`, `term_item_listings.py:854-870`). | Mirrors `list_public_term_item_listings` (`term_item_listings.py:437-459`). |
| Product names are text-moderated on write (`product/service.py:146,165`). Photos are APPROVED only. | — |

### 4.4 Stats definitions

- `circle_count` = `len(circles)`, PUBLIC only.
- `upcoming_term_count` = the count of PUBLIC-circle terms in the window.
- `family_count` = distinct `Family` ids reachable from the parties holding an active `Membership` in the PUBLIC circles.
  - Path: `Membership(valid_to IS NULL)` → `GroupRole.party_id` → `FamilyRole.party_id` → `FamilyMembership(valid_to IS NULL).to_family_id`, in **one** `COUNT(DISTINCT …)` query.
  - Same join chain as `exchange_summary._ordered_group_member_party_ids` plus `_resolve_family_guardians` (`application/exchange_summary.py:56-78,97-120`), which reads `app.families.models` directly.
  - **Open question (D-P3):** should one-off RSVP families (anonymous `TermAttendance` without a `Membership`) count? The prototype says "Rodziny 32". Recommendation: members only, which is stable and meaningful.
- `location`: a text field from `organizations` (§2), not computed.
- Gallery: `COUNT(*) WHERE kind='GALLERY' AND status='APPROVED'`. It lives in the **org** payload, not this one.

### 4.5 Caps and pagination

- Organizer cardinality is small: one owner has around 1-10 circles. Use **hard caps instead of paging** on the aggregate endpoint:
  - circles at most 30;
  - `upcoming_terms` at most 10 within 60 days;
  - `exchange.items` at most 12, with counts over all of them.
  - Caps are SQL `LIMIT`s (`.maister/docs/standards/backend/jooq.md`: "enforced SQL-level LIMIT").
- For the SCHEDULE layout ("Wszystkie terminy"), add `GET /api/groups/public/organizers/{slug}/terms?page=&size=&group_id=`:
  - returns `Page[OrganizerTermResponse]` via the existing `Pagination`/`Page` (`app/core/pagination.py:12-42`, default 20, max 100);
  - ordering `occurs_on ASC, id`;
  - the same privacy filter.
  - It is the same matrix row (the `(/terms)?` suffix). Defer it until SCHEDULE is built, per minimal implementation.

### 4.6 N+1 avoidance: constant query plan

The existing per-term helpers are **bounded loops per item**:
- `_resolve_item_display_info` runs 2 queries per item (`term_item_listings.py:276-301`);
- `_is_item_available` runs 2 per item (`:229-235`);
- `_resolve_listing_status` runs 1-3 per item (`:238-273`);
- `_resolve_lister_display_names` runs 1 per lister (`:303-310`).

That is acceptable for one term but multiplies across circles, so **do not reuse them** for the organizer page. Planned queries:

| # | Query | Helper |
|---|---|---|
| 1 | org by slug | ACL → `organizations.service.get_organization_by_slug` (`:66-72`) |
| 2 | owner party id | new ACL `get_owner_party_id` (join membership+role) |
| 3 | active leaderships → group ids for owner (`GroupRole ORGANIZATOR` ⋈ `Leadership valid_to IS NULL`) in **one** join | new repo fn (today two calls: `repository.py:147-175`) |
| 4 | `Group` rows `WHERE id IN (…) AND visibility='PUBLIC'` | new repo fn |
| 5 | upcoming terms for those groups, `ORDER BY occurs_on, id LIMIT 10` | new repo fn |
| 6 | next term per circle (`DISTINCT ON (circle_group_id) … ORDER BY circle_group_id, occurs_on`) plus per-circle upcoming counts (`GROUP BY`) | new repo fn (or one window query) |
| 7 | attendee counts for all shown term ids | existing `count_active_attendances_by_term` (`repository.py:373-390`) |
| 8 | family count (single `COUNT(DISTINCT)` join) | new |
| 9 | eligible listers = active attendances `WHERE term_id IN (next-term ids)` ∪ owner party | new batched repo fn (today per-term `list_active_attendances_for_term`, `:359-371`) |
| 10 | listing preferences for the lister set | existing `list_item_listing_preferences_for_parties` (`repository.py:472-484`) |
| 11 | available items plus product name and condition in **one** join (`InventoryItem` not deleted ⋈ `InventoryBalance.status='AVAILABLE'` ⋈ `Product`) `WHERE item_id IN (…)` | **new** `circulation_bridge.list_available_items_with_product(item_ids)` (no batch variant exists today: `circulation_bridge.py:214-232` are single-item) |
| 12 | first APPROVED photo per product (`DISTINCT ON (product_id) … ORDER BY product_id, sort_order`) | new `product_bridge` fn |

- The listing "taken" status is unnecessary: AVAILABLE balance already implies "open". This skips the per-item `_resolve_listing_status`.
- Mapping item to term: assign each item to the earliest next-term among the circles whose eligible set contains its lister (in Python, over already-loaded rows).
- Add a test asserting the query count stays constant (for example with a SQLAlchemy `before_cursor_execute` counter) for 1 vs 5 circles.

---

## 5. Owner PATCH changes (`PATCH /api/organizations/{id}`)

Current behaviour:
- `UpdateOrganizationRequest` (`app/organizations/schemas.py:44-52`): `None` means untouched, and colors cannot be cleared.
- Service (`app/organizations/service.py:130-149`): applies each field `if … is not None`.

Proposed:

```python
class UpdateOrganizationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    accent_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    page_layout: OrganizationPageLayout | None = None
    tagline: str | None = Field(default=None, max_length=160)
    bio: str | None = Field(default=None, max_length=2000)
    location: str | None = Field(default=None, max_length=120)
    links: list[OrganizationLink] | None = Field(default=None, max_length=6)

    @model_validator(mode="after")
    def _non_nullable(self) -> Self:
        for field in ("name", "page_layout"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self
```

**Service semantics:** `sent = data.model_fields_set`.
- Field **omitted** → untouched.
- Field **explicitly `null`** → cleared, for `primary_color`, `accent_color`, `tagline`, `bio`, `location` and `links`. Clearing colors is "Przywróć domyślne" (report §9.2).
- Blank string → `None` for the text fields, matching `users/service.py:118`.
- `links: []` is stored as `NULL`.

**Moderation order:**
1. Run structural validation, then `check_text` for each **sent** text field against its current value (`check_text(…, new, current)` skips unchanged values, `text_guard.py:74`).
2. Run all checks **before** mutating, so a rejected bio does not half-apply a colour change. That matches the existing pattern of checking before assigning (`service.py:140-146`).

**Compatibility:**
- The frontend sends only changed fields: `api/organizations.ts:25-28` has optional keys, and `OrganizationPage.tsx:65` sends `{ name }`. Switching to `model_fields_set` semantics therefore changes no existing behaviour.
- `tests/test_organizations.py:149-168` sets colors, and the request still works. Add tests for null-clears-color, null-name → 422, and omitted-untouched.

**Responses:** `OrganizationResponse` gains all new fields. `PublicOrganizationResponse` (`schemas.py:26-37`) gains `page_layout`, `tagline`, `bio`, `location`, `links`, and `logo/cover: {url, thumb_url} | null` plus `gallery: [...]` (APPROVED only). The response stays narrow: no ids of uploaders and no statuses.

**PATCH vs dedicated endpoints:** keep a single PATCH for scalar fields and theme, covered by matrix row 50. Media gets its own multipart routes (§3.2), because multipart cannot share a JSON PATCH.

**Concurrency:** `updated_at` is `version_id_col`, so concurrent editor saves raise a `StaleDataError` that is already handled (`codebase-backend-storage-options.md` constraint 6).

---

## 6. Suggested task split

| Task | Contents | Repos | Depends on | Size |
|---|---|---|---|---|
| **A: Theme + layout** | `page_layout` column, `model_fields_set` PATCH (colors reset), `organizer_theme` in `PublicCircleResponse`, frontend `OrganizerThemeScope` / tokenisation / editor "Układ/Kolory" | app | — | M |
| **B: Public organizer read model** | `GET /api/groups/public/organizers/{slug}` (+ ACL fns, matrix row, batched bridge fns, constant-query test); `CLASSIC`/`CIRCLES`/`EXCHANGE`/`LINKS` blocks consume it | app | — (A is independent) | M-L |
| **C: Text content** | `tagline`, `bio`, `location`, `links` columns + `TextField`s + PATCH fields + public response + editor tab "Treść" (text part); OG description from tagline | app | A (PATCH semantics) | S-M |
| **D: Organization media** | `organization_media` table, upload/delete/reorder routes, matrix DELETE row, moderation union/decide/delete, admin UI label; **cron `Subject` + grants + deploy-artifact test** | app **+ group-thing-ai** | C optional; needs Spaces configured | M |
| D2 (later) | Gallery block, `og:image` from cover (`public_preview.py:30-46` + `twitter:card summary_large_image`), paged `/terms` for SCHEDULE | app | B, D | S |

- A and B can run in parallel.
- D is the only cross-repo change with a deploy-ordering constraint (§3.5), which is the main reason to isolate it.
- Layouts ship first with gracefully missing blocks (report §8, principle "każdy blok łagodnie znika").

---

## 7. Open decisions raised by this deep dive

- **D-C1:** bio as plain text (recommended) or limited Markdown (bold only), which would bring back the prototype's `mv-hl` highlights.
- **D-C2:** apply `ensure_no_contact_info` to `tagline`/`bio` so contacts go only through structured `links`? This needs a field-specific message, because the current one says "Nazwa i opis" (`rules.py:11-14`). Recommendation: yes for `tagline`, no for `bio`.
- **D-C3:** expose `EMAIL`/`PHONE` link kinds publicly? This publishes personal data chosen by the organizer, and scraping risk is acceptable for a business card. Alternatively, only social and website links.
- **D-M1:** pending-image behaviour: Option B (keep last approved; recommended) vs Option A (avatar parity).
- **D-M2:** gallery limit (12?) and whether a GALLERY item may carry a caption. A caption would need a `TextField` and a column.
- **D-P1:** PRIVATE circles: omit (recommended) or show name-only teasers.
- **D-P2:** the suppression threshold for `family_count` (3?).
- **D-P3:** whether `family_count` counts members only (recommended) or also one-off RSVP families.
- **D-P4:** agenda window (60 days?) and caps.

## 8. Confidence

| Claim | Confidence |
|---|---|
| Built moderation = sync Bielik for text + VPS B cron for images on table columns; adding a subject needs app union/decide changes plus cron `SUBJECTS` and grants | High (code read in both repos) |
| `organization_media` with the avatar column set plugs into the cron unchanged except `SUBJECTS`/grants | High |
| Matrix: new PUBLIC row needed ahead of row 26; DELETE under `/api/organizations` not covered by row 50 | High |
| No term-level privacy, location or capacity data exists | High (`groups/models.py`) |
| The constant-query plan is feasible with 3-4 new batched repo/bridge functions | Medium-High (not prototyped) |
| `model_fields_set` PATCH is backward compatible | High (frontend payloads checked) |
| Option B pending semantics | Medium (design judgment; no precedent in repo) |
