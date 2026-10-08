# Specification: A2 "Układ i edytor" (organizer page layout + palette editor)

## Goal
Let an organization owner choose the layout (CLASSIC or LINKS) and color palette (10 palette choices = the default "Mięta" tile, which has no key, plus 9 keyed presets; or "Własny") of their public page `/:slug`, editing it inline on the live page (`/:slug?edit=1`) and saving with an explicit "Zapisz". The registry/allowlist seams stay ready for B (more layouts) and E (paid layouts) without schema changes.

## User Stories
- As an organization owner, I want to open my own page in edit mode from "Moja organizacja" or the Home hint, so that I can change how visitors see it without hunting for a settings screen.
- As an owner, I want to switch between "Klasyczny" and "Wizytówka" and see the real page change under the editor before saving, so that I pick with confidence.
- As an owner, I want to pick a ready palette or my own brand color (with readable-text correction explained), so that the page, my term pages and product pages match my brand.
- As an owner, I want "Anuluj", "Przywróć domyślne" and a warning before losing unsaved changes, so that experimenting is safe.
- As a visitor, I want the page to always render sensibly (hero, "Udostępnij", footer) and never see owner placeholders.

## Scope

### In scope
- Backend: migration 0052, allowlist modules, PATCH `model_fields_set` semantics, extended owner/public responses, `organizer_theme.palette_preset`, DELETE in matrix row 50.
- Frontend: palette presets + "Własny", `resolveOrgTheme` preset branch, `describeColorAdjustment`, layout registry + `LayoutRenderer` + A2 blocks, page moved to `pages/organizer/`, non-modal `EditorSheet`, unsaved-changes guard, hooks `useMyOrganization` / `useUpdateOrganization`, entry points (AccountMenu, HomeView), FE/BE key parity test.

### Out of scope
See "Out of Scope" section at the end.

## Core Requirements

### Backend
1. **BR-1 Migration 0052** adds `organizations.page_layout VARCHAR(64) NOT NULL server_default 'CLASSIC'` (default kept permanently) and `organizations.palette_preset VARCHAR(40) NULL`. No CHECK, no DB enum. Reversible, proven by a downgrade/upgrade round-trip test.
2. **BR-2 Allowlists in code**: `PAGE_LAYOUT_KEYS = {"CLASSIC","LINKS"}`, `FALLBACK_PAGE_LAYOUT = "CLASSIC"`, `resolve_page_layout(stored)` is the only place computing the effective layout; `PALETTE_PRESET_KEYS` = 9 keys (no `MINT`).
3. **BR-3 PATCH `/api/organizations/{id}`** uses `model_fields_set`: omitted = unchanged, explicit `null` clears nullable fields; `name: null` / `page_layout: null` → 400; unknown body key → 400; key outside allowlist → 400; whitespace-only name → 400 (strip). Moderation runs before any mutation.
4. **BR-4 Responses**: owner `OrganizationResponse` gains stored `page_layout` + `palette_preset`; `PublicOrganizationResponse` gains effective `page_layout` + `palette_preset`, consistently at both construction sites (`organizations/router.py:39` and `system/router.py:124`; `public_preview.py` only receives the already-built model).
5. **BR-5** `organizer_theme.palette_preset` (circle/term public response) carries the stored preset.
6. **BR-6** Authorization matrix row 50 covers `POST|PATCH|DELETE`.

### Frontend
7. **FR-1** Public page `/:slug` renders through `LayoutRenderer` with the layout from the server (unknown key → CLASSIC) inside `OrganizerThemeScope`. Visitor sees only blocks with content. The owner also sees non-interactive ghosts.
8. **FR-2** Palette resolution order: known preset → generator from stored hex → default. It applies on `/:slug`, the term page and the organizer product page (through the widened `OrganizerThemeScope`).
9. **FR-3** Owner-only "Edytuj wygląd" pill opens the editor (`?edit=1`). `?edit=1` is silently ignored unless `useMyOrganization().data?.slug === slug`.
10. **FR-4** `EditorSheet` is non-modal, rendered inside the theme scope (no portal), and has tabs "Układ" and "Kolory". The page under it is the live preview of the draft. Zapisz sends only the changed fields. Anuluj resets the draft and keeps the sheet open. X closes the sheet, confirming first when the draft is dirty.
11. **FR-5** Unsaved-changes confirm on X (dirty) and on in-app navigation that changes the pathname (`useBlocker`). No `beforeunload`.
12. **FR-6** "Kolory": "Mięta (domyślna)" (keyless default tile, all-null theme) + 9 keyed presets + "Własny" = 11 tiles; "Własny" has primary required, accent auto/custom, contrast hint and hex validation; plus two static mini previews and "Przywróć domyślne". The requirements' "10 presets" means these 10 ready palettes (Mięta + 9 keyed); there is exactly one key set of 9, shared by FE and BE.
13. **FR-7** Entry points: AccountMenu "Moja organizacja" and HomeView hint link to `/${slug}?edit=1` (fallback `/organization`). The HomeView hint description changes.
14. **FR-8** Hooks `useMyOrganization` and `useUpdateOrganization` follow `data-fetching.md`. They export the key constants. `useMyOrganizationSlug` becomes a thin wrapper.
15. **FR-9** FE/BE parity test: FE layout registry keys == `PAGE_LAYOUT_KEYS`; FE preset keys == `PALETTE_PRESET_KEYS`.
16. **FR-10** Every preset passes the generator sweep's WCAG contrast pair set plus extra pairs for the roles a hand-tuned map may change (see "New tests per group", FE theme).

**Note for reviewers (C-2):** in A2 CLASSIC and LINKS differ mostly in framing and hero variant: centered column, centered hero, and a full-width primary share button for LINKS. Both render hero + share + footer for visitors. Task B adds term/exchange blocks and buttons without changing keys.

---

## Backend Contract

### Migration — `src/backend/alembic/versions/0052_organization_page_layout.py` (NEW)
- `revision = "0052"`, `down_revision = "0051"`.
- Docstring follows `0035_group_layout_mode.py`. It explains that the permanent `server_default` is one fixed, always-sensible value and that there is no CHECK/enum because future `custom:<uuid>` keys must not need a migration (ADR-003).
- `upgrade()`: `op.add_column("organizations", sa.Column("page_layout", sa.String(64), nullable=False, server_default="CLASSIC"))`; `op.add_column("organizations", sa.Column("palette_preset", sa.String(40), nullable=True))`.
- `downgrade()`: drop `palette_preset`, then `page_layout`.
- Covered by a round-trip test (see "New tests per group").

### Model — `src/backend/app/organizations/models.py` (MOD)
- `page_layout: Mapped[str] = mapped_column(String(64), nullable=False, server_default="CLASSIC")`: plain string, server default only, same precedent as `Group.layout_mode` (`app/groups/models.py:108`). The create path already refreshes after insert (`service.create_organization`).
- `palette_preset: Mapped[str | None] = mapped_column(String(40), nullable=True)`.
- Extend the class docstring with one sentence on the two fields and where their allowlists live.

### Allowlists (NEW, style of `app/organizations/slugs.py` `RESERVED_SLUGS`)
- `src/backend/app/organizations/page_layouts.py`:
  - `PAGE_LAYOUT_KEYS: frozenset[str] = frozenset({"CLASSIC", "LINKS"})`
  - `FALLBACK_PAGE_LAYOUT = "CLASSIC"`
  - `resolve_page_layout(stored: str | None) -> str` returns `stored` if it is in `PAGE_LAYOUT_KEYS`, otherwise `FALLBACK_PAGE_LAYOUT`.
  - Module docstring: "keep in sync with `src/frontend/src/pages/organizer/layouts/registry.ts`; parity enforced by `organizerKeyParity.test.ts`".
- `src/backend/app/organizations/palettes.py`:
  - `PALETTE_PRESET_KEYS: frozenset[str] = frozenset({"OCEAN", "LAVENDER", "RASPBERRY", "SUN", "FOREST", "TERRACOTTA", "GRAPHITE", "PLUM", "NORTH_SEA"})`.
  - Docstring: the default palette ("Mięta") is all-null and has no key; the frontend owns the visuals; sync note as above.
- Both literals stay single `frozenset({...})` expressions with double-quoted keys, because the parity test parses them with a regex.

### Schemas — `src/backend/app/organizations/schemas.py` (MOD)
- `OrganizationResponse` adds `page_layout: str` (stored value, unresolved) and `palette_preset: str | None`.
- `PublicOrganizationResponse` adds `page_layout: str` and `palette_preset: str | None`. A `field_validator("page_layout")` returns `resolve_page_layout(value)`. Because the field validator runs inside `model_validate(org)`, both construction sites (`organizations/router.py:39` and `system/router.py:124`, whose model is then passed to `public_preview.render_public_organization_meta`) produce the effective value with no call-site change.
- `UpdateOrganizationRequest` is rewritten:
  - `model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)`
  - `name: str | None = Field(default=None, min_length=1, max_length=255)`
  - `page_layout: str | None = None`
  - `palette_preset: str | None = None`
  - `primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)`
  - `accent_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)`
  - Validator: `name` and `page_layout` reject an explicit `None` with "must not be null". Pydantic validators run only on supplied values, so an omitted field is not affected.
  - Validator: `page_layout` must be in `PAGE_LAYOUT_KEYS`; `palette_preset` must be `None` or in `PALETTE_PRESET_KEYS`.
  - Rewrite the docstring to describe the omitted/null semantics. It must replace the old "no way to clear" note.
- All validation failures go through the existing global `validation_error_handler` (`app/core/errors.py:111-118`): **400** with `{status, error: "Bad Request", message: "Validation failed", fieldErrors: {...}, timestamp}`.

### Service — `src/backend/app/organizations/service.py` `update_organization` (MOD)
Order of operations:
1. Load the organization; owner check unchanged (403).
2. If `"name" in data.model_fields_set`, run `await check_text(TextField.ORGANIZATION_NAME, data.name, organization.name)`. This happens before any attribute is assigned, so no partial write is possible.
3. For each `field in data.model_fields_set`, assign `setattr(organization, field, getattr(data, field))`. Safe because `extra="forbid"` restricts names to the five declared fields, and the validators guarantee non-null `name` / `page_layout`.
4. Commit and refresh as today. `StaleDataError` → 409 via the existing handler.

**Semantics table**

| Field | Omitted | Explicit `null` | Value |
|---|---|---|---|
| `name` | unchanged | 400 (`fieldErrors.name`) | stripped. Empty after strip → 400. Moderated (400 rejected / 503 unavailable) only when present and changed |
| `page_layout` | unchanged | 400 | must be in `PAGE_LAYOUT_KEYS`, else 400 |
| `palette_preset` | unchanged | cleared (no preset) | must be in `PALETTE_PRESET_KEYS`, else 400 (`"MINT"` → 400) |
| `primary_color` | unchanged | cleared | `^#[0-9a-fA-F]{6}$`, else 400 |
| `accent_color` | unchanged | cleared ("automatyczny") | same regex |
| any other key | n/a | n/a | 400 (`extra="forbid"`) |
| `{}` body | 200, nothing changes | | |

The backend does not enforce consistency between `palette_preset` and colors. The FE always sends the preset key together with its base colors (ADR-002). A stored unknown preset key degrades on the FE to the generator from the stored hex values.

### Endpoints (request/response)

**`GET /api/organizations/public/{slug}`** (PUBLIC, matrix row 48), 200:
```json
{ "slug": "rodzinny-grajdolek", "name": "Rodzinny Grajdołek",
  "primary_color": "#0e7490", "accent_color": "#f59e0b",
  "palette_preset": "OCEAN", "page_layout": "LINKS" }
```
`page_layout` is always effective (`resolve_page_layout`). 404 when there is no organization (unchanged).

**`GET /api/organizations/mine`** (READ), 200 `OrganizationResponse`:
```json
{ "id": "uuid", "party_id": "uuid", "name": "Rodzinny Grajdołek", "slug": "rodzinny-grajdolek",
  "primary_color": null, "accent_color": null, "palette_preset": null, "page_layout": "CLASSIC",
  "created_at": "…", "updated_at": "…" }
```
`page_layout` is the **stored** key and may be unknown, e.g. `"custom:7f3c"`. 404 when the caller has no organization (unchanged).

**`PATCH /api/organizations/{id}`** (EDIT, matrix row 50, owner only)

Example requests:
```json
{ "page_layout": "LINKS" }
{ "palette_preset": "OCEAN", "primary_color": "#0e7490", "accent_color": "#f59e0b" }
{ "palette_preset": null, "primary_color": "#3498db" }
{ "palette_preset": null, "primary_color": null, "accent_color": null }
```
The last request resets to the default palette.

| Status | When | Body |
|---|---|---|
| 200 | success | `OrganizationResponse` (stored `page_layout`) |
| 400 | validation (null name/page_layout, unknown key, allowlist miss, bad hex, blank name) | `message: "Validation failed"`, `fieldErrors` (e.g. `{"page_layout": "Value error, unknown page layout"}`) |
| 400 | name rejected by moderation | `message` = Polish `MESSAGES[ORGANIZATION_NAME]`, no `fieldErrors` |
| 403 | caller is not the OWNER | `message: "Access denied"` |
| 404 | organization id does not exist | existing not-found envelope |
| 409 | optimistic-lock race (`StaleDataError`); practically unreachable because the client sends no version and load+write happen in one request (concurrent saves are last-writer-wins) | `message: "Dane zostały w międzyczasie zmienione — odśwież i spróbuj ponownie"` |
| 503 | name changed while text moderation is unavailable (fail closed) | existing envelope |

**`GET /api/groups/public/{id}`**: `organizer_theme` becomes `{ "primary_color": …, "accent_color": …, "palette_preset": "OCEAN" | null } | null`. No `page_layout` on term pages.

### ACL — `src/backend/app/groups/infrastructure/organizations_acl.py` (MOD)
- `palette_preset=organization.palette_preset`.
- Update the `OrganizerTheme` docstring in `src/backend/app/groups/schemas.py:292-299`: replace "always None until A2" with "stored preset key, or None".

### Authorization matrix — `src/backend/app/core/authorization_matrix.py:184` (MOD)
- Row 50: `_methods("POST", "PATCH", "DELETE")`, still `("EDIT", "mcp:edit")`. There is no DELETE route yet; this prepares task D (user decision P3). Row numbering is unchanged.

---

## Frontend Architecture
All paths are relative to `src/frontend/src/`.

### API types — `api/organizations.ts` (MOD)
- `OrganizationResponse` and `PublicOrganizationResponse` add `page_layout: string` and `palette_preset: string | null`.
- `UpdateOrganizationRequest` becomes `{ name?: string; page_layout?: string; palette_preset?: string | null; primary_color?: string | null; accent_color?: string | null }`. `api/client.ts` already keeps an explicit `null` and drops `undefined`. The functions are unchanged.

### Hooks
- **`hooks/usePublicOrganization.ts` (MOD)**: `export const PUBLIC_ORGANIZATION_KEY = "publicOrganization"`. Otherwise unchanged.
- **`hooks/useMyOrganization.ts` (NEW)**:
  - `export const MY_ORGANIZATION_KEY = "myOrganization"`.
  - Key `[MY_ORGANIZATION_KEY, token]`, `enabled: token !== null`, `queryFn: getMyOrganization`.
  - Returns `{ data: OrganizationResponse | null, loading: token !== null && query.isPending, error: string | null (404 → null, via hasStatus), refetch(): Promise<void> }`.
  - Doc comment keeps the existing "token in the key" rationale from `useMyOrganizationSlug`.
- **`hooks/useMyOrganizationSlug.ts` (MOD)**: `return useMyOrganization().data?.slug ?? null`. The key is shared, so the cache is shared.
- **`hooks/useUpdateOrganization.ts` (NEW)**:
  - Returns `{ update(id: string, request: UpdateOrganizationRequest): Promise<void> }`, using `useCallback` + `useQueryClient` like `useModerationPhotos.ts:46-66` / `useItemDetail.ts:130-142`.
  - On success: `await Promise.all([invalidateQueries({queryKey:[PUBLIC_ORGANIZATION_KEY]}), invalidateQueries({queryKey:[MY_ORGANIZATION_KEY]})])`.
  - On failure: first awaits the same invalidation of both prefixes (precedent `useItemDetail.ts:131-140`, which invalidates in the `catch` before rethrowing), because the server state may differ from the cached baseline (409, or a request that failed after the write). Then it throws `new Error(message)`, with `message` decided as follows:
    1. `ApiError` 409 → "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie."
    2. Otherwise `serverMessageOr(err, fallback)` (precedent `useItemDetail.ts:138`):
       - `fallback` = "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz." for an `ApiError` 400.
       - `fallback` = "Nie udało się zapisać. Spróbuj ponownie." for everything else.
    3. 403 resolves to `ACCESS_DENIED_MESSAGE`, and a 400 moderation message passes through verbatim.

    This deviates from raw `extractProblemMessage` because that function yields English text for validation and network errors.
  - The draft is never touched by the hook. Because the page keeps the draft separately from the baseline (see Page), a failed save keeps the owner's draft while the refetched baseline replaces the stale one; `dirty` and the next `diffDraft` are computed against the fresh baseline. Concurrent editing is last-writer-wins (see Known Limitations).

### Theme
- **`theme/palettePresets.ts` (NEW)**:
  - `export interface PalettePreset { key: string; label: string; vars: ThemeVars }`, plus `export const PALETTE_PRESETS: readonly PalettePreset[]` with exactly **9** entries in tile order (the default "Mięta" is not an entry: it is the keyless all-null theme rendered from `DEFAULT_THEME_VARS`):
    | Key | Label |
    |---|---|
    | OCEAN | Ocean |
    | LAVENDER | Lawenda |
    | RASPBERRY | Malina |
    | SUN | Słońce |
    | FOREST | Las |
    | TERRACOTTA | Terakota |
    | GRAPHITE | Grafit |
    | PLUM | Śliwka |
    | NORTH_SEA | Morze Północne |
  - Each `vars` is a hand-tuned 13-role literal map (ADR-002). They may be seeded from `buildOrgThemeVars` output, then frozen and tuned.
  - A preset's base colors are `vars["--color-primary"]` and `vars["--color-accent"]`. There are no separate fields.
  - Add `findPreset(key: string | null | undefined): PalettePreset | undefined`.
  - This file and `orgPalette.ts` are the only FE files allowed to contain hex literals for org theming. Swatch samples in the editor read the colors from here at runtime.
- **`theme/orgPalette.ts` (MOD)**:
  - `resolveOrgTheme(theme: { primary_color: string | null; accent_color: string | null; palette_preset?: string | null } | null | undefined)`:
    1. `findPreset(theme.palette_preset)?.vars`
    2. else the existing generator path (valid primary hex)
    3. else `DEFAULT_THEME_VARS`

    `palette_preset` is optional so existing test calls compile unchanged.
  - New `describeColorAdjustment(primary: string): { primaryDarkened: boolean; tooLight: boolean }`:
    - `tooLight` = the seed OKLCH L > 0.9, which is the same clamp `buildOrgThemeVars` applies at l.~139.
    - `primaryDarkened` = `buildOrgThemeVars(primary)["--color-primary"] !== primary.toLowerCase()`.
    - Share the threshold through one module-level constant. `buildOrgThemeVars`' signature and return type are unchanged.
- **`theme/OrganizerThemeScope.tsx` (MOD)**:
  - The prop is typed `theme: (Pick<OrganizerTheme, "primary_color" | "accent_color"> & { palette_preset?: string | null }) | null | undefined`, the same shape `resolveOrgTheme` accepts. `palette_preset` is **optional** on purpose: `OrganizerTheme.palette_preset` is required (`api/groups.ts:196-200`), and the existing literals in `test/OrganizerThemeScope.test.tsx:19,50` and `test/themeScopeNavigation.test.tsx:21` omit it. With the optional field those tests compile unchanged under `tsc -b` (they are type-checked because `tsconfig.app.json` includes `src`).
  - `OrganizerTheme` and `PublicOrganizationResponse` are both assignable to the prop. The memo depends on `primary_color`, `accent_color` and `palette_preset`. The no-transform comment stays.

### Layout registry — `pages/organizer/layouts/` (NEW)
- **`types.ts`** (trimmed contract, I-6):
  - `BlockId = "hero" | "share" | "about" | "link-stack" | "footer"`.
  - `BlockSlot { block: BlockId; variant?: string; primary?: true }`.
  - `PageLayoutDefinition { key: string; label: string; description: string; thumbnail: { src: string; alt: string }; frame: "column" | "centered"; blocks: BlockSlot[]; recommended?: true }`.
  - `OrganizerPageData { organization: PublicOrganizationResponse }`.
  - `RenderMode = "visitor" | "owner-edit"`.
  - `BlockProps { data: OrganizerPageData; variant?: string }` (render mode stays in the renderer, which decides ghosts).
  - Deliberately absent: `when`, `version`, `props`, `directory`, `directoryStatus`, `Component`/`minData`/`tier`.
- **`registry.ts`**: `LAYOUT_REGISTRY: Record<string, PageLayoutDefinition>` in order CLASSIC, LINKS; `FALLBACK_LAYOUT = "CLASSIC"`; `resolveLayout(key?: string | null): PageLayoutDefinition`, which mirrors `resolve_page_layout`.
  - **CLASSIC "Klasyczny"**: frame `column`; blocks `hero:cover` · `share` · `about` (primary) · `footer`. Description: "Profil z opisem i terminami." Not recommended.
  - **LINKS "Wizytówka"**: frame `centered`; blocks `hero:centered` · `link-stack` (primary) · `about` · `footer`. Description: "Same linki, jak w bio na Instagramie." `recommended: true` (in A2 there is no directory data, so the HLD "no directory → LINKS" rule always holds; B may reintroduce a predicate).
  - Thumbnails import `assets/layouts/classic.svg`, `links.svg` (NEW, static, neutral greys, alt "Szkic układu Klasyczny" / "Szkic układu Wizytówka").
  - `primary` is declared per C-2. In A2 its only reader is the registry invariant test; B's empty-state injection reads it.

### Renderer and blocks — `pages/organizer/` (NEW)
- **`LayoutRenderer.tsx`**:
  - Props `{ layout: PageLayoutDefinition; data: OrganizerPageData; mode: RenderMode }`.
  - Holds `BLOCKS: Record<BlockId, ComponentType<BlockProps> | null>`. `null` means "no content source yet". In A2 only `about` is `null`. Task C replaces it with a real component and adds `isEmpty`.
  - Rules:
    - A `null` component in `visitor` mode → slot skipped.
    - A `null` component in `owner-edit` mode → `GhostBlock` for that block id.
    - Ghosts never render for visitors.
  - Frame (the renderer root is `flex flex-1 flex-col`, so it fills the page wrapper's min-height; it never sets its own `min-h-screen`/`min-h-dvh`):
    - `column`: 430px column, `bg-cream`, top-aligned.
    - `centered`: column vertically centered (`justify-center` inside the `flex-1` root), `bg-cream` with a `bg-primary-soft` top fade.
    - The viewport-height rule lives in the page wrapper (see Page), so a logged-in viewer, who sees the sticky `PublicLayout` bar, gets no overflow scroll.
  - No visitor empty-state card in A2.
- **`blocks/HeroBlock.tsx`**:
  - Variant `cover`: no image in A2, so it degrades to a `bg-primary` band with an initials circle, `<h1>` name (serif) and the `domena.pl/{slug}` line in `text-on-primary`.
  - Variant `centered`: initials circle `bg-primary text-on-primary`, name and slug centered.
  - Initials come from `familyInitials` (`components/shared/Avatar.tsx:23`). `Avatar` itself is not used because it paints a family color inline.
- **`blocks/ShareButton.tsx`**:
  - Shared share action with `{ slug, name, label, className }`.
  - URL = `${window.location.origin}/${slug}`. Never `location.href`, so `?edit=1` never leaks.
  - Uses `navigator.share({ title: name, url })` when it exists, ignoring `AbortError`. Otherwise `navigator.clipboard.writeText(url)` and then toast "Skopiowano link". On clipboard failure the toast reads "Nie udało się skopiować linku".
  - Toast via `useToast` (`pages/krag/hooks/useToast.ts`) with the pill classes of `PublicTermView.tsx:180-184` (`role="status"`).
- **`blocks/ShareBlock.tsx`**: CLASSIC; `ShareButton` with label "Udostępnij", `bg-primary-soft text-primary-fg` pill.
- **`blocks/LinkStackBlock.tsx`**: LINKS; a vertical stack with one full-width button "Udostępnij stronę", `bg-primary text-on-primary`, min height 48px.
- **`blocks/FooterBlock.tsx`**: hairline plus "Strona utworzona w domena.pl" (`text-ink-soft`, mirrors the existing `domena.pl` placeholder brand).
- **`blocks/GhostBlock.tsx`**:
  - Props `{ block: BlockId }`. Copy map: `about` → title "Opis — wkrótce", body "Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.".
  - Dashed box `rounded-2xl border-[1.5px] border-dashed border-line px-4 py-5 text-ink-soft`, with `EyeIcon` (`c="currentColor"`, `aria-hidden`).
  - Plain `<div>`: no role, no tabindex, no button.
- All blocks use role tokens only: no hex, no `mint`/`lime` utilities. Icons from `pages/panel/panelIcons.tsx` always get `c="currentColor"`.

### Page — `pages/organizer/PublicOrganizationPage.tsx` (NEW location; delete `pages/PublicOrganizationPage.tsx`; update the import in `router.tsx:28`)
- Data:
  - `usePublicOrganization(slug)`; loading and not-found states unchanged ("Wczytywanie…", "Nie znaleziono strony" / "Ta organizacja nie istnieje.").
  - `useMyOrganization()`.
  - `isOwner = myOrg.data?.slug === slug`.
  - `sheetOpen = isOwner && searchParams.get("edit") === "1"`. The URL is the single source of truth. Non-owners keep the param, but it has no effect and shows no message.
- Draft state — the page is the single owner of draft, baseline and save:
  - `const [draft, setDraft] = useState<Draft | null>(null)`: `null` = the owner has not edited since the last open/reset/save. This nullable value never leaves the page.
  - `Draft = { pageLayout: string; theme: OrganizerTheme }`.
  - `baseline: Draft = toDraft(myOrg.data)`, with `pageLayout = resolveLayout(stored).key` and the three theme fields copied. Recomputed on every render, so a refetch (after save or after a failed save) refreshes it automatically.
  - `current: Draft = draft ?? baseline` — the resolved, never-null draft that drives the preview and is passed to the sheet.
  - `dirty = draft !== null && !sameDraft(draft, baseline)`.
  - `const { update } = useUpdateOrganization()`.
  - `handleSave = async () => { await update(myOrg.data.id, diffDraft(current, baseline)); setDraft(null); }`. On success the awaited invalidation has already refreshed the baseline. On failure `update` throws (after invalidating), `setDraft(null)` is not reached, so the draft is kept; the sheet catches and shows the message.
- Render:
  - `<OrganizerThemeScope theme={sheetOpen ? current.theme : organization}>`, then `<LayoutRenderer layout={resolveLayout(sheetOpen ? current.pageLayout : organization.page_layout)} data={{ organization }} mode={isOwner ? "owner-edit" : "visitor"} />`.
  - Then the owner pill (when `isOwner && !sheetOpen`) and `<EditorSheet draft={current} dirty={dirty} organization={organization} onChange={setDraft} onReset={() => setDraft(null)} onSave={handleSave} onClose={close} />` (when `sheetOpen`).
  - Both are children of the scope. No portal, and no transform/filter on the scope.
- Page wrapper height (fixes overflow under the sticky bar):
  - The outermost wrapper of every page state (loading, not-found, loaded) is `flex flex-col bg-cream`, with `min-h-dvh` for anonymous visitors and `min-h-[calc(100dvh-57px)]` when `useAuth().token` is set (that is exactly when `PublicLayout` renders its sticky bar).
  - 57px = the bar's `border-t` (1px) + `py-2` (16px) + `h-10` controls (40px) in `components/layout/PublicLayout.tsx`. Keep it in one named module constant with a comment pointing at `PublicLayout`. `PublicLayout` itself is not changed.
  - `LayoutRenderer`'s `flex-1` root fills this wrapper, so the `centered` frame is vertically centered in the visible area with no extra scroll.
- Padding-bottom:
  - `pb-24` while the pill is visible.
  - About the sheet height (`pb-[60vh]`) while the sheet is open, so the footer stays reachable.
- **Owner pill** "Edytuj wygląd":
  - `fixed bottom-6 left-1/2 -translate-x-1/2 z-[50] rounded-full bg-ink text-on-ink px-5 py-3 text-sm font-extrabold`, height at least 44px, with `PencilIcon c="currentColor"`.
  - Click: `setSearchParams({ edit: "1" }, { replace: true })`.
- Close: `setSearchParams` without `edit` (replace) and `setDraft(null)`.

### Editor — `pages/organizer/editor/` (NEW)
- **`draft.ts`** (pure helpers):
  - `Draft`, `toDraft(org)`, `sameDraft(a, b)`.
  - One private helper `sameHex(a, b)` compares colors case-insensitively by normalizing both to uppercase (A1 stores hex as sent, e.g. `#7A2A4F`; preset maps and the picker may use either case); `null` equals only `null`. Both `sameDraft` and `diffDraft` use it, so they can never disagree.
  - `diffDraft(current, baseline): UpdateOrganizationRequest` includes each of `page_layout`, `palette_preset`, `primary_color`, `accent_color` only when it differs (colors via `sameHex`, so a case-only difference sends nothing); nulls are explicit; values are sent as they are in `current`.
  - `paletteSelection(theme): "DEFAULT" | presetKey | "CUSTOM"`:
    - all three fields null → `DEFAULT`
    - known preset key → that key
    - anything else (custom colors or an unknown/retired preset) → `CUSTOM`
  - `DEFAULT_THEME = { palette_preset: null, primary_color: null, accent_color: null }`.
- **`EditorSheet.tsx`**:
  - Props (exact contract):
    - `draft: Draft` — the page's resolved `current` (never null; it equals the baseline while nothing is edited).
    - `dirty: boolean` — computed by the page.
    - `onChange(next: Draft): void`, `onReset(): void`, `onClose(): void`.
    - `onSave(): Promise<void>` — the page computes the diff against its baseline and calls `useUpdateOrganization`; it rejects with an `Error` whose `message` is the Polish copy.
    - The sheet receives no `baseline`, no `organizationId` and does not call `useUpdateOrganization` itself; it only owns UI state (saving/saved/error/confirm).
  - Chrome copies `components/krag/ModalSheet.tsx` classes without the scrim wrapper and without click-outside-to-close:
    - `fixed bottom-0 inset-x-0 z-[60] mx-auto w-full max-w-[430px] rounded-t-[24px] bg-paper p-5 shadow`
    - `min-[520px]:bottom-4 min-[520px]:rounded-[24px]`
    - content `max-h-[55vh] overflow-y-auto`
  - Accessibility:
    - `role="dialog" aria-modal="false" aria-labelledby="editor-title"`; title "Wygląd strony" (`tabIndex=-1`, focused on mount).
    - **No focus trap.** The sheet is non-modal, so Tab/Shift+Tab move in normal document order and keyboard users can still reach the page and the `PublicLayout` account bar. (This deliberately replaces the HLD's sheet trap, per audit Low-8.)
    - Close button `aria-label="Zamknij"`.
    - Esc does nothing on the sheet itself.
  - Tabs follow the `WypozyczoneView.tsx:28-50` pattern: ids `editor-tab-uklad`/`editor-panel-uklad` and `editor-tab-kolory`/`editor-panel-kolory`; Left/Right arrows move between tabs; the active tab uses `bg-ink text-on-ink` (not the literal `text-[#EAF2E9]`).
  - Footer is sticky (`border-t border-line`). Buttons:
    - "Anuluj": `border-line bg-cream`.
    - "Zapisz": `bg-primary text-on-primary`.
  - Error area `role="alert"` (`rounded-2xl bg-danger-soft text-danger`) sits just above the footer.
  - Local state: `saving`, `saved`, `error`, `confirmOpen`, `customInvalid`.
  - Unsaved guard: `useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)`. The `useBlocker` call lives here, not in the page, so only editor tests need a data router.
- **State machine (footer and guard)**

  | State | Anuluj | Zapisz | Notes |
  |---|---|---|---|
  | clean | disabled | disabled | |
  | dirty | enabled | enabled, unless the custom primary is invalid | any draft change clears `error` and `saved` |
  | saving | disabled | "Zapisywanie…", disabled | `aria-busy` on the sheet |
  | saved | per clean | per clean | "✓ Zapisano" (`role="status"`, `text-primary-fg`) until the next change |
  | error | enabled if still dirty against the refreshed baseline | enabled if still dirty | draft kept; baseline refetched; message from `useUpdateOrganization` |

  - Zapisz: the sheet sets `saving`, `await onSave()`; on resolve it sets `saved`; on reject it sets `error = err.message`. The page's `onSave` does the diff, the update and `setDraft(null)` (see Page). The sheet stays open in both cases.
  - Anuluj: `onReset()`, which calls `setDraft(null)`. The sheet stays open.
  - X while clean: `onClose()`.
  - X while dirty: `UnsavedChangesDialog`.
    - "Odrzuć" → `onClose()`.
    - "Wróć do edycji" / Esc / scrim click → close the dialog and return focus to the X.
  - Blocker `state === "blocked"` opens the same dialog.
    - "Odrzuć" → `blocker.proceed()`.
    - "Wróć do edycji" → `blocker.reset()`.
- **`LayoutTab.tsx`**:
  - `role="radiogroup" aria-label="Układ strony"`, two cards in registry order (`grid-cols-2 gap-2.5`).
  - Props: `{ value: string /* draft.pageLayout */; onSelect(key: string): void }`.
  - Each card has a thumbnail `<img>`, the label, a "Polecany" badge (`bg-accent-soft text-accent-fg`, text) when `layout.recommended`, and the description.
  - `role="radio" aria-checked`, arrow-key navigation. Selected: `border-2 border-primary bg-primary-soft` plus ✓.
  - Selecting sets only `draft.pageLayout`.
- **`ColorsTab.tsx`**:
  - Section label "Gotowe palety"; `role="radiogroup" aria-label="Paleta kolorów"`; `grid-cols-4 gap-2` tiles.
  - Tile 1 is "Mięta (domyślna)": swatch from `DEFAULT_THEME_VARS`, sets `DEFAULT_THEME`.
  - The 9 presets set `{ palette_preset: key, primary_color: vars primary, accent_color: vars accent }`.
  - The last tile is "Własny" (dashed swatch with "+"):
    - Selecting it from another tile sets `palette_preset: null` and prefills `primary_color` with the current draft primary, or `DEFAULT_THEME_VARS["--color-primary"]` when that is null.
    - It keeps the accent.
  - Selected tile: `ring-2 ring-ink` plus ✓. Swatches are the only inline `style` colors (half primary, half accent), read from `palettePresets.ts` / `orgPalette.ts`.
  - When "Własny" is selected, `CustomColorPicker` renders below the grid.
  - Then the "Podgląd" heading with `PreviewCards` (`grid-cols-2 gap-2.5`).
  - Then the "Przywróć domyślne" text link (`text-primary-fg underline`, sets `DEFAULT_THEME`), disabled when the draft theme already equals the default.
- **`CustomColorPicker.tsx`**:
  - "Kolor główny *": `<input type="color">` (44×44) plus a labelled text input.
    - Text input: valid `#RRGGBB` is uppercased (matching A1's stored form and the `#RRGGBB` hint) and written to the draft. The `<input type="color">` emits lowercase; its value is uppercased the same way before it reaches the draft (and the draft value is lowercased when fed back into the color input, which only accepts lowercase). An invalid value shows "Podaj kolor w formacie #RRGGBB" (`text-danger`, `aria-describedby`), keeps the last valid draft color, and reports `customInvalid` so Zapisz is disabled.
  - Hint (`role="status"`, `text-[12.5px] text-ink-soft`) from `describeColorAdjustment(primary)`:
    - `tooLight` → "Ten kolor jest bardzo jasny — przyciemniliśmy go wyraźnie, żeby tekst był czytelny."
    - else `primaryDarkened` → "Lekko przyciemniliśmy kolor dla czytelności."
    - else no hint.
  - "Akcent": radio pair "Automatyczny" (`accent_color: null`) / "Własny" (enables a color + hex input pair with the same validation).
- **`PreviewCards.tsx`**: `TermPreviewCard` and `ProductPreviewCard`.
  - Static sample content:
    - Term card: date tile "14 / paź" `bg-primary-soft`, "Muzyczne Maluchy", "wt · 16:30", fake CTA "Zapisz się →" `bg-primary text-on-primary`.
    - Product card: `PhotoPlaceholder`, "Kask rowerowy", pills "Dostępna" (`text-primary-fg`) and "Oddam" (`bg-primary-soft`).
  - Wrapper `role="img"` with `aria-label` "Podgląd terminu w wybranych kolorach" / "Podgląd produktu w wybranych kolorach". Non-focusable `<div>`s only.
- **`UnsavedChangesDialog.tsx`**:
  - `fixed inset-0 z-[70] bg-scrim`, centered card `max-w-[340px] rounded-[24px] bg-paper p-5`.
  - `role="alertdialog" aria-modal="true"`, labelled/described.
  - Title "Odrzucić zmiany?", body "Wybrany układ i kolory nie zostały zapisane."
  - Buttons: "Wróć do edycji" (autofocus, `bg-cream border-line`) and "Odrzuć" (`bg-danger text-paper`).
  - Tab is trapped between the two buttons. This is the only focus trap on the page (the sheet has none), so while the dialog is open it fully owns keyboard focus; on close focus returns to the X (or stays on the page for a blocked navigation that is reset). Esc closes only this dialog. Rendered inside the scope; never Chakra `ConfirmDialog` (it portals).

### Theme resolution order (all three page families)
1. `palette_preset` is a known FE preset → the preset's hand-tuned `vars`.
2. Otherwise a valid `primary_color` → `buildOrgThemeVars(primary, accent?)`. This also covers an unknown/retired preset with its stored base colors.
3. Otherwise `DEFAULT_THEME_VARS`.

### Entry points
- `components/shared/AccountMenu.tsx:63-70`: `to={organizationSlug ? `/${organizationSlug}?edit=1` : "/organization"}`. Label, icon and order unchanged.
- `pages/panel/views/HomeView.tsx:77-86`:
  - `ctaTo` uses the same rule.
  - Description becomes "Wybierz układ i kolory swojej strony — zobaczą je odwiedzający."
  - The title "Dopracuj stronę organizacji" is unchanged.
- `pages/OrganizationPage.tsx` (`/organization`) is unchanged (Q2).

---

## Visual Design
The mockups in `analysis/design-context/` (`INDEX.md`, `ascii/ui-mockups.md`) are **binding inputs**. The implementation-planner attaches `Visual References` to UI task groups. Fidelity is **layout/structure-level** (ASCII): class names noted in the mockups are guidance; spacing and exact hex values for presets are tuned during implementation, and preset contrast tests are mandatory.

| INDEX id | Spec element |
|---|---|
| `screen:org-public-classic` | CLASSIC definition, `HeroBlock:cover`, `ShareBlock`, `FooterBlock`, owner vs visitor. **Override:** the mockup's visitor empty-state card is NOT built (requirements: no visitor empty-state in A2) |
| `screen:org-public-links` | LINKS definition, `HeroBlock:centered`, `LinkStackBlock`, `centered` frame |
| `component:ghost-block` | `GhostBlock`, owner-only, non-interactive |
| `component:edit-appearance-button` | Owner pill "Edytuj wygląd" |
| `screen:org-edit-sheet-layout` | `EditorSheet` chrome, tabs, `LayoutTab`, footer state machine |
| `screen:org-edit-sheet-colors` | `ColorsTab` (11 tiles), "Przywróć domyślne" |
| `component:custom-color-picker` | `CustomColorPicker`, `describeColorAdjustment` hints |
| `component:preview-cards` | `PreviewCards` (no Strona/Termin/Produkt toggle) |
| `component:save-error` | error area + `useUpdateOrganization` message mapping |
| `component:unsaved-confirm` | `UnsavedChangesDialog`, `useBlocker` |
| `flow:editor-entry` | page owner detection, `?edit=1`, close/exit paths |
| `component:account-menu-entry` | AccountMenu link change |
| `component:home-hint` | HomeView hint copy + link |

Responsive:
- Below 520px: a full-width 430px column, the sheet docked at the bottom (about 55vh, content scrolls inside), a 4-column preset grid, and 2-column layout and preview cards.
- At 520px and above: the column is centered and the sheet stays bottom-docked (`bottom-4`, `rounded-[24px]`, `max-w-[430px]`), so the page above stays visible.
- The confirm dialog is centered at every width.

## Polish Copy (single list)

| Element | Copy |
|---|---|
| Owner pill | Edytuj wygląd |
| Sheet title | Wygląd strony |
| Tabs | Układ, Kolory |
| Layout cards | Klasyczny / "Profil z opisem i terminami."; Wizytówka / "Same linki, jak w bio na Instagramie." |
| Layout badge | Polecany |
| Colors | Gotowe palety; Mięta (domyślna), Ocean, Lawenda, Malina, Słońce, Las, Terakota, Grafit, Śliwka, Morze Północne, Własny; Podgląd; Przywróć domyślne |
| Picker | Kolor główny *; Akcent; Automatyczny; Własny |
| Hex error | Podaj kolor w formacie #RRGGBB |
| Contrast hints | "Lekko przyciemniliśmy kolor dla czytelności." / "Ten kolor jest bardzo jasny — przyciemniliśmy go wyraźnie, żeby tekst był czytelny." |
| Footer | Anuluj; Zapisz; Zapisywanie…; ✓ Zapisano |
| Save errors | 409: "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie."<br>400 (validation): "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz."<br>403: `ACCESS_DENIED_MESSAGE`<br>Network/5xx: "Nie udało się zapisać. Spróbuj ponownie." |
| Confirm | Odrzucić zmiany? / "Wybrany układ i kolory nie zostały zapisane." / Wróć do edycji / Odrzuć |
| Ghost | Opis — wkrótce / "Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty." |
| Share | "Udostępnij" (CLASSIC), "Udostępnij stronę" (LINKS)<br>Toasts: "Skopiowano link" / "Nie udało się skopiować linku" |
| Page footer | Strona utworzona w domena.pl |
| HomeView hint | "Wybierz układ i kolory swojej strony — zobaczą je odwiedzający." |

## Accessibility
- Sheet:
  - `role="dialog"`, `aria-modal="false"`, labelled by its title. Focus moves to the title on open. No focus trap: Tab follows document order, so the account bar and page stay keyboard-reachable.
  - The page above stays scrollable by pointer.
- Tabs follow the ARIA tablist pattern with arrow keys.
- Layout cards and palette tiles:
  - Radiogroups with text names; selection shown by ✓ plus border/ring, not color alone.
  - Tap targets are at least 44px.
- Every input has a `<label>`. Hex errors are linked through `aria-describedby`.
- Contrast hint and "✓ Zapisano" use `role="status"`. The save error uses `role="alert"`.
- The confirm dialog is an `alertdialog` with initial focus on "Wróć do edycji" and Tab trapped; it is the only trap and takes over keyboard focus while open.
- Ghosts and preview cards are not focusable. Preview cards are `role="img"` with an `aria-label`.
- The owner pill uses `bg-ink`, so it is legible under any palette.
- All presets pass WCAG AA (FR-10).

---

## Reusable Components

### Existing Code to Leverage

| Existing | Path | Use |
|---|---|---|
| Hex-validated colors, owner check, PATCH route | `src/backend/app/organizations/{schemas,service,router}.py` | extend in place |
| Allowlist module style | `src/backend/app/organizations/slugs.py` (`RESERVED_SLUGS`) | template for `page_layouts.py`, `palettes.py` |
| Migration templates | `alembic/versions/0035_group_layout_mode.py`, `0050_user_profile_bio.py` | 0052 |
| `extra="forbid"` precedent | `app/families/schemas.py:107` | update request |
| Global 400 validation envelope, 409 StaleDataError | `app/core/errors.py:101,111-118` | no new handlers |
| ACL seam | `app/groups/infrastructure/organizations_acl.py:30` | one-line fill |
| Matrix + `resolve_requirement` tests | `app/core/authorization_matrix.py:184`, `tests/test_authorization_matrix.py` | row 50 + test |
| Moderation guard | `app/moderation/text_guard.py` `check_text` | unchanged, called conditionally |
| Generator, defaults, roles | `src/frontend/src/theme/orgPalette.ts` | presets type, `describeColorAdjustment`, resolver |
| Theme scope | `theme/OrganizerThemeScope.tsx` | widened prop; hosts sheet and dialog |
| Public org query | `hooks/usePublicOrganization.ts` | export key; page data |
| Query-wrapping hook and mutation patterns | `hooks/useModerationPhotos.ts:46-66`, `hooks/useItemDetail.ts:130-142` | `useUpdateOrganization` |
| Polish error mapping | `api/problem.ts` `serverMessageOr`, `ACCESS_DENIED_MESSAGE` | save errors |
| 404 detection | `hooks/useTermAttendees.ts` `hasStatus` | `useMyOrganization` |
| Sheet chrome (classes only) | `components/krag/ModalSheet.tsx` | EditorSheet, confirm dialog |
| Pill tabs | `pages/panel/views/WypozyczoneView.tsx:28-50` | editor tabs |
| Toast hook and pill | `pages/krag/hooks/useToast.ts`, `PublicTermView.tsx:180-184` | share feedback |
| Clipboard "Skopiowano link" | `PanelDataContext.tsx:1217` | share fallback |
| Initials | `components/shared/Avatar.tsx:23` `familyInitials` | hero |
| Icons | `pages/panel/panelIcons.tsx` (`CloseIcon`, `PencilIcon`, `EyeIcon`, `CopyIcon`), `components/shared/Icons.tsx` (`PhotoPlaceholder`) | blocks, editor |
| HintCard | `pages/panel/panelComponents.tsx:46` | props change only |
| Test infra | `src/test/queryClient.tsx` (`createQueryWrapper`, `createTestQueryClient`), `src/test/setup.ts` | all FE tests |
| Contrast pair set | `src/test/orgPalette.test.ts` `contrastFailures` | preset sweep |

### New Components Required (and why)

| New | Why existing code can't serve |
|---|---|
| `page_layouts.py`, `palettes.py` | the allowlists don't exist; they must be importable by schemas and parseable by the parity test |
| `useMyOrganization`, `useUpdateOrganization` | no hook returns the full owner org (needed for `id` and the baseline); no mutation hook for organizations |
| `palettePresets.ts` | presets are hand-tuned maps (ADR-002) and can't be generated at runtime |
| `layouts/types.ts`, `registry.ts`, `LayoutRenderer` | the page today is a single static card; the registry is the B/E seam |
| `HeroBlock`, `ShareButton`/`ShareBlock`, `LinkStackBlock`, `FooterBlock`, `GhostBlock` | no organizer page blocks exist. `Avatar` paints family colors, so it is not reused for the hero |
| `EditorSheet`, `LayoutTab`, `ColorsTab`, `CustomColorPicker`, `PreviewCards`, `draft.ts` | no editor exists. `ModalSheet` is modal with a scrim and closes on outside click, which is wrong for a live preview |
| `UnsavedChangesDialog` | `ConfirmDialog` is a Chakra portal and would escape the theme scope |
| `assets/layouts/{classic,links}.svg` | static thumbnails (HLD: no mini-renders) |

Deliberately **not** created: `EmptyStateBlock`, `AboutBlock` (about stays `null` until C), per-layout definition files, preview toggle, `MINT` key, `isEmpty`/`variants` registry fields, and `beforeunload`.

## Technical Approach
- **Backend** is additive and contained. Effective-layout computation lives in one function and is applied in the public schema, so every construction site (router, SSR preview) agrees. PATCH semantics move from "not None" checks to `model_fields_set`, which is the only new backend pattern (a candidate for `standards/backend/api.md` after delivery).
- **Frontend data flow**:
  1. `/:slug` → `usePublicOrganization` (theme + effective layout, zero FOUC) plus `useMyOrganization` (owner check, stored baseline, `id`).
  2. → `OrganizerThemeScope(draft or server theme)` → `LayoutRenderer(resolveLayout(...))` → `EditorSheet` (owner + `?edit=1`).
  3. Save → PATCH diff → await invalidation of both prefixes → draft cleared → "✓ Zapisano".
- **Draft vs server**:
  - The draft is local React state, `null` while clean.
  - The baseline comes from the owner response normalized through `resolveLayout`, so a stored unknown key shows CLASSIC selected and is overwritten only when the owner saves a layout change.
- **Theme scope constraint**: the sheet, confirm dialog, pill and toast are all descendants of the scope with no portal. The scope element never gets `transform`/`filter`/`contain`. The pill's own `-translate-x-1/2` is on the pill.
- **Cross-page effect**: widening `OrganizerThemeScope` makes term pages (`TermPage.tsx`) and organizer product pages (`OrganizerItemLayout.tsx`) honor presets with no other change.
- **Parity test** (`src/test/organizerKeyParity.test.ts`):
  - Reads `../backend/app/organizations/page_layouts.py` and `palettes.py` via `node:fs`, resolved from `process.cwd()`, which is the `src/frontend` folder (same approach as `themeTokenUsage.test.tsx`).
  - Extracts `NAME[^=]*=\s*frozenset\(\s*\{([^}]*)\}` and then the `"…"` keys.
  - Asserts set equality with `Object.keys(LAYOUT_REGISTRY)` and `PALETTE_PRESETS.map(p => p.key)`.

## Implementation Guidance

### Testing Approach
- 2-8 focused tests per implementation step group. Test verification runs only the new and updated tests, not the entire suite. A final full-suite comparison is made against the baselines:
  - BE: 642/642 green.
  - mypy: 4 pre-existing errors.
  - FE: 17 pre-existing failures (TermPage 5, PanelPage 8, auth 1, extension-points 2, foundation 1). Compare by test name, not by count.
  - ESLint: 18-19 pre-existing problems.
  - TypeScript: `npx tsc -b` in `src/frontend` exits 0 with **0 errors** (verified 2026-10-08). This is the gate `npm run build` (`tsc -b && vite build`, run by the frontend Dockerfile) depends on. Vitest strips types, so every type-only change (new required response fields in typed fixtures, the scope prop) is caught only here.
- Backend naming: `test_action_condition_expectedResult`, per-file `_register_organizer` helpers (`backend-testing.md`). Frontend: `src/test/*.test.tsx`, `vi.mock` factories, `createQueryWrapper` (`frontend-testing.md`).
- Tests rendering `EditorSheet` (which uses `useBlocker`) must use `createMemoryRouter` + `RouterProvider`. Other page tests may keep `MemoryRouter`.

**Existing tests to update**

| File | Change |
|---|---|
| `src/backend/tests/test_public_term.py:365-460` | exact `organizer_theme` dicts stay valid (`palette_preset: None`); add one positive preset case (see below) |
| `src/backend/tests/test_text_moderation_org_group_term.py:91-121` | no change expected. It must still pass with `extra="forbid"` and strip; verify only |
| `src/frontend/src/test/PublicOrganizationPage.test.tsx` | import from `../pages/organizer/PublicOrganizationPage`; the "Organizacja" badge card assertions are replaced by renderer expectations; fixtures add `page_layout`, `palette_preset`. **Setup changes (otherwise every test crashes):** (a) the page now calls `useMyOrganization()` → `useAuth()`, which throws outside `AuthProvider` (`auth/AuthContext.tsx:182-187`), so add `let mockAuth: { token: string \| null }` + `vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }))` (precedent `PublicLayout.test.tsx:19`; set `mockAuth` in `beforeEach`, `token: null` for visitor tests); (b) extend the factory to `vi.mock("../api/organizations", () => ({ getPublicOrganization: vi.fn(), getMyOrganization: vi.fn(), updateOrganization: vi.fn() }))`, because `getMyOrganization` is read as the `queryFn` during render |
| `src/frontend/src/test/themeDefects.test.tsx:94` | `IN_SCOPE_FILES` entry `"pages/PublicOrganizationPage.tsx"` → `"pages/organizer/PublicOrganizationPage.tsx"` (it is read with `readFileSync`; the old path would fail with ENOENT in "has no literal hex colors" and "reads no unprefixed KragStage variables"). Also add the new `pages/organizer/**` `.tsx` files (blocks, renderer, editor) to the list |
| `src/frontend/src/test/OrganizerThemeScope.test.tsx:19,50`, `themeScopeNavigation.test.tsx:21` | no change: their literals omit `palette_preset`, which stays optional in the scope prop (H-2); verify with `tsc -b` |
| `src/frontend/src/test/usePublicOrganization.test.tsx:13`, `OrganizerItemRoute.test.tsx:33` | add the two fields to `PublicOrganizationResponse` literals |
| `src/frontend/src/test/PanelPage.test.tsx` (~l.134, 395, 417, 475-505, 647, 723-738) | add the fields to `OrganizationResponse` mocks; hrefs at l.502 and l.746 become `/muzyczne-skrzaty?edit=1`; `/organization` fallbacks (l.482, l.728) unchanged; HomeView hint description text if asserted |
| `src/frontend/src/test/PublicLayout.test.tsx:65-75` | slug href → `/moja-org?edit=1`; fallback `/organization` unchanged. The mock at l.70 uses an `as OrganizationResponse` cast, so the new fields are **verify only** (no fixture change needed) |
| `src/frontend/src/test/OrganizationPage.test.tsx:14` | add the fields to the typed `OrganizationResponse` mock; the `updateOrganization("7",{name})` and "no color pickers" assertions stay |
| `src/frontend/src/test/OnboardingHandoff.test.tsx`, `OnboardingWizard.test.tsx` | **verify only**: their mocks are untyped factory returns (`OnboardingHandoff.test.tsx:35-44`) or `mockRejectedValue` only, so no fixture change is needed |
| `src/frontend/src/test/themeTokenUsage.test.tsx` | add every new `pages/organizer/**` `.tsx`/`.ts` file (except the SVG assets) to `NO_HEX_FILES` and `NO_LEGACY_UTILITY_FILES`; `theme/palettePresets.ts` is not added (it is the hex home) |
| `src/frontend/src/test/TermPage.test.tsx`, `termAccess.test.ts`, `KragStage.test.tsx` | no change expected (`OrganizerTheme` already has `palette_preset`); verify compile |

**New tests per group**

| Group | Tests (2-8) |
|---|---|
| BE schema/service/migration (`tests/test_organizations.py`) | (1) a new org has `page_layout "CLASSIC"` / `palette_preset null` in both `mine` and public responses.<br>(2) owner PATCH `{page_layout:"LINKS", palette_preset:"OCEAN", primary_color, accent_color}` → 200, persisted; an omitted `name` stays unchanged.<br>(3) explicit nulls clear preset and colors.<br>(4) parametrized `name: null`, `page_layout: null`, `name: "   "` → 400 with `fieldErrors`.<br>(5) parametrized unknown body key, `page_layout: "GRID"`, `palette_preset: "MINT"` → 400.<br>(6) a stored unknown layout (set via `db_session`) → public `CLASSIC`, `mine` returns the stored key.<br>(7) migration round trip in `tests/test_organization_page_layout_migration.py` (precedent `tests/test_photo_moderation_attempts_migration.py:107`, `test_migration0049_downgradeUpgrade_roundTrip`): `downgrade 0051` → both columns absent; `upgrade head` (in `finally`) → both columns present, `page_layout` NOT NULL with default `'CLASSIC'`, `palette_preset` nullable. |
| BE ACL + matrix | (1) `test_public_term.py`: organizer with `palette_preset="OCEAN"` → `organizer_theme.palette_preset == "OCEAN"`.<br>(2) `test_authorization_matrix.py`: `resolve_requirement("DELETE", "/api/organizations/x") == EDIT`, and PATCH resolves to EDIT. |
| FE data layer (`useOrganizationHooks.test.tsx`) | (1) `useMyOrganization` returns data, `loading` false without a token, 404 → `data null`, `error null`.<br>(2) `useMyOrganizationSlug` returns the slug through the shared key.<br>(3) `update` calls `updateOrganization` and invalidates both prefixes.<br>(4) 409 → the Polish conflict message, and both prefixes are invalidated before the rejection.<br>(5) 400 with `fieldErrors` → the 400 fallback copy. |
| FE theme (`orgPalette.test.ts` + `palettePresets.test.ts`) | (1) every preset passes the `contrastFailures` pair set (refactor the helper to accept `ThemeVars`) **plus** preset-only text pairs (all ≥ 4.5) for roles a hand-tuned map may change but the generator never varies: `[INK, cream]`, `[INK, primary-soft]`, `[INK, accent-soft]`, `[accent-fg, cream]`, `[INK_SOFT, PAPER]`. `INK`/`INK_SOFT`/`PAPER` are the constants already in `orgPalette.test.ts:6-8`; also assert there are exactly 9 presets with unique keys and that none is `MINT`.<br>(2) `resolveOrgTheme` with a known preset returns the preset vars.<br>(3) an unknown preset plus hex → generator output.<br>(4) all null → `DEFAULT_THEME_VARS`.<br>(5) `describeColorAdjustment`: `#3498db` → darkened, `#ffffff` → tooLight, `#1b8168` → neither.<br>(6) parity test (layouts + presets) in `organizerKeyParity.test.ts`. |
| FE renderer/page (`LayoutRenderer.test.tsx`, `PublicOrganizationPage.test.tsx`) | (1) visitor CLASSIC renders hero `<h1>`, "Udostępnij" and the footer, with no "Opis — wkrótce".<br>(2) owner mode renders the ghost (non-focusable).<br>(3) LINKS renders "Udostępnij stronę" and the centered frame.<br>(4) unknown key → CLASSIC.<br>(5) registry invariant: each layout has exactly one `primary` slot, keys are unique.<br>(6) share without `navigator.share` copies `origin/slug` (no `?edit`) and shows "Skopiowano link".<br>(7) a non-owner with `?edit=1` sees no sheet; the owner without `edit` sees the "Edytuj wygląd" pill.<br>(8) the scope uses preset vars for `palette_preset: "OCEAN"`. |
| FE editor (`OrganizerEditor.test.tsx`, data router; same setup as `PublicOrganizationPage.test.tsx`: `AuthContext` mock with a token, and `vi.mock("../api/organizations")` exporting `getPublicOrganization`, `getMyOrganization`, `updateOrganization`) | (1) the owner with `?edit=1` sees the "Wygląd strony" dialog, focused, rendered inside `[data-organizer-theme]`.<br>(2) choosing "Wizytówka" changes the page under the sheet before saving, and Anuluj restores it while the sheet stays open.<br>(3) choosing Ocean updates the scope vars; Zapisz sends exactly the diff and shows "✓ Zapisano"; with a baseline stored as `#7A2A4F`, a draft `#7a2a4f` is not dirty and is not sent (case-insensitive `sameHex`).<br>(4) "Mięta (domyślna)" / "Przywróć domyślne" sends three explicit nulls.<br>(5) "Własny" with an invalid hex shows the error and disables Zapisz; `#3498db` shows "Lekko przyciemniliśmy…".<br>(6) X while dirty → "Odrzucić zmiany?"; "Odrzuć" closes the sheet and drops `?edit=1`.<br>(7) a dirty draft plus a navigation to another pathname → dialog; "Wróć do edycji" keeps the page.<br>(8) a rejected update (409) shows the alert, keeps the draft (page under the sheet still shows the draft) and triggers a refetch of `getMyOrganization`. |
| FE entry points | covered by the updated `PanelPage.test` / `PublicLayout.test` href and copy assertions (2 tests touched) |

### Standards Compliance
- `standards/global/minimal-implementation.md`:
  - trimmed registry types
  - no empty-state/about stubs
  - no `MINT` key
  - no preview toggle
  - DELETE row only by explicit decision
- `standards/global/error-handling.md`, `validation.md`: server-side allowlists, fail-fast validation, specific Polish user messages.
- `standards/backend/api.md`: PATCH partial update on an existing resource route; no new endpoints.
- `standards/backend/models.md`: string columns (no ordinal/native enums), `BaseEntity` with `updated_at` optimistic locking → 409.
- `standards/backend/migrations.md`: one small reversible migration, permanent constant `server_default` (0035 rationale).
- `standards/backend/security.md`: matrix row change, owner check in the service (`AccessDeniedException`).
- `standards/frontend/data-fetching.md`: hooks in `src/hooks/`, array keys with exported prefix constants, `await invalidateQueries` on prefixes, app-shaped returns. The documented deviation is Polish error mapping via `serverMessageOr` (precedent `useItemDetail`).
- `standards/frontend/css.md`, `components.md`: Tailwind role tokens only on public pages; small single-purpose components.
- `standards/frontend/accessibility.md`, `responsive.md`: see Accessibility; mobile-first 430px column, 44px targets.
- `standards/testing/backend-testing.md`, `frontend-testing.md`: integration-first BE tests against real Postgres; Vitest + Testing Library with the shared query wrapper.

## Risks
| Risk | Mitigation |
|---|---|
| A portal or transform breaks the in-scope fixed sheet (R6) | no Chakra on this page; scope element unchanged; renderer/editor tests assert the dialog is inside `[data-organizer-theme]` |
| Fixture churn in large test files (`PanelPage.test.tsx`) | the data-layer group lands first and updates all typed fixtures together |
| 17 pre-existing FE failures hide regressions | compare failing test names to the baseline list |
| FE/BE allowlist drift (R15) | parity test reads the backend files |
| Stricter PATCH breaks callers | verified callers send only known keys (`/organization` sends `{name}`, moderation tests send name and colors) |
| Owner confusion between stored unknown layout and CLASSIC | owner sees CLASSIC selected (effective); the stored key is overwritten only on an explicit layout save |

## Out of Scope
- SCHEDULE / CIRCLES / EXCHANGE layouts, the organizer directory endpoint, `upcoming-terms` and other B blocks, and the visitor `empty-state` card (B).
- Content tab, bio/tagline/links, a real about block, and ghost CTAs (C).
- Logo, cover and gallery media; hero `cover` image (D/D2).
- Paid layouts, entitlements, `tier`, `effective_layout()`, "wkrótce" cards (E). Only the string-key seam is in A2.
- `beforeunload` guard; side-panel desktop editor; Strona/Termin/Produkt preview toggle.
- Any change to `/organization` (`OrganizationPage.tsx`); `PanelDataContext` refactor.
- A DELETE endpoint (only the matrix row).
- `architecture.md` / standards updates (suggest a `model_fields_set` PATCH standard afterwards).

## Success Criteria
1. On `/:slug?edit=1`, the owner switches layout and palette and the page under the sheet changes immediately. Anuluj restores the server state while the sheet stays open.
2. After Zapisz, a reload or another browser shows the new layout and palette on `/:slug`. The term page and the organizer product page show the new palette.
3. PATCH:
   - an omitted field is unchanged and `null` clears colors and preset;
   - `name: null` / `page_layout: null` / unknown key / allowlist miss / blank name → **400**;
   - non-owner → 403.
4. A stored unknown `page_layout` renders CLASSIC publicly, and `mine` returns the stored key.
5. A non-owner, an anonymous visitor or an errored owner check with `?edit=1` sees the plain visitor page. Visitors never see ghosts.
6. Every preset passes the WCAG pair set, and the FE/BE key sets are equal (automated).
7. `resolve_requirement("DELETE", "/api/organizations/…")` requires EDIT.
8. AccountMenu "Moja organizacja" and the HomeView hint lead to `/${slug}?edit=1` (or `/organization` without an org). The hint shows the new copy.
9. The owner reaches a new look in 3 taps or fewer plus "Zapisz" (HLD success criterion 6).
10. No new failures against the baselines (BE 642 green; mypy 4; FE 17 known failures; ESLint 18-19), and `npx tsc -b` in `src/frontend` = **0 errors** (baseline 0), so `npm run build` still succeeds.

## Known Limitations
- The footer and hero use the existing `domena.pl` placeholder brand string. Real branding is a separate change.
- Renaming on `/organization` does not invalidate `publicOrganization` (pre-existing; that page is out of scope).
- `BlockSlot.primary` has no runtime reader in A2. It is kept per decision C-2 and guarded by the registry invariant test; B's empty-state injection consumes it.
- The DELETE matrix entry has no route until D (an explicit decision); with EDIT a DELETE gets 405.
- Concurrent edits are last-writer-wins: the client sends no version, so the 409 path is practically unreachable. On any failed save the hook refetches the owner/public organization and the editor keeps the owner's draft, so nothing typed is lost; the owner simply saves again.
- The 57px sticky-bar offset in the page wrapper is coupled to `PublicLayout`'s bar classes; changing the bar height requires updating the constant.

## Revision log (audit 2026-10-08)
- **H-1**: added `themeDefects.test.tsx:94` to "Existing tests to update" — repoint `IN_SCOPE_FILES` to `pages/organizer/PublicOrganizationPage.tsx` and add the new `pages/organizer/**` files.
- **H-2**: `OrganizerThemeScope` prop typed `Pick<OrganizerTheme, "primary_color" | "accent_color"> & { palette_preset?: string | null }`, same as `resolveOrgTheme`; `OrganizerThemeScope.test.tsx:19,50` and `themeScopeNavigation.test.tsx:21` compile unchanged (listed as verify-only).
- **M-1**: one design chosen: the page owns draft, baseline, diff and save. `EditorSheet` props are now `{ draft (= resolved current, never null), dirty, organization, onChange, onReset, onSave(): Promise<void>, onClose }`; `LayoutTab` receives `organization` for `recommendWhen`. Removed `organizationId`/`onSaved` from the sheet and updated the state machine.
- **M-2**: added the `npx tsc -b` = 0 errors baseline (verified 0 on 2026-10-08) to Testing Approach and Success Criterion 10.
- **M-3**: `PublicOrganizationPage.test.tsx` entry now includes the `AuthContext` mock (precedent `PublicLayout.test.tsx:19`) and `getMyOrganization`/`updateOrganization` in the `vi.mock` factory; `OrganizerEditor.test.tsx` uses the same setup.
- **L-1**: construction sites named as `organizations/router.py:39` and `system/router.py:124`; `public_preview.py` noted as a receiver only.
- **L-2**: `OnboardingHandoff`, `OnboardingWizard` and the `PublicLayout` fixture marked "verify only"; only `OrganizationPage.test.tsx:14` needs the new fields.
- **L-3**: stated explicitly: 9 keyed presets + keyless "Mięta (domyślna)" tile = the requirements' "10 presets"; 11 tiles with "Własny".
- **L-4**: `sameDraft` and `diffDraft` share `sameHex`, a case-insensitive comparison normalizing to uppercase; the custom picker writes uppercase `#RRGGBB`; a test covers the case-only difference.
- **L-5**: added the migration 0052 downgrade/upgrade round-trip test (precedent `test_photo_moderation_attempts_migration.py:107`).
- **L-6**: `useUpdateOrganization` invalidates both organization prefixes on failure too (precedent `useItemDetail.ts`); the draft is kept and the baseline refreshed; the 409 copy no longer tells the owner to reload; last-writer-wins documented in the 409 row and Known Limitations; editor test 8 asserts the refetch.
- **L-7**: preset contrast sweep extended with ink on cream/primary-soft/accent-soft, accent-fg on cream and ink-soft on paper (all ≥ 4.5), plus a 9-unique-keys/no-`MINT` assertion.
- **L-8**: the sheet has no focus trap (non-modal; account bar stays reachable); the confirm dialog is the only trap and owns focus while open. The page wrapper uses `min-h-dvh` (anonymous) or `min-h-[calc(100dvh-57px)]` (logged in, sticky bar shown) as a `flex flex-col` container, and `LayoutRenderer`'s root is `flex-1`, so the `centered` frame causes no overflow scroll.

## Revision log (verification fix loop 2026-10-08)
- W4: `recommendWhen` predicate replaced by static `recommended?: true`; `organization` prop removed from `EditorSheet` and `LayoutTab`.
- W5: `mode` removed from `BlockProps`; unread variants (`full`, `short`, `minimal`, `buttons`) removed — only HeroBlock's `cover`/`centered` remain.
- W1/W2/W3/W6 and info fixes: see verification/implementation-verification.md and implementation/work-log.md.
