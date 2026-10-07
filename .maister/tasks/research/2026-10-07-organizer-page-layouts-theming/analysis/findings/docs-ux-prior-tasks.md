# docs-ux — Prior task decisions relevant to organizer page layouts + theming

## P1. Group visualization (`layout_mode`) — the closest precedent for "selectable layouts"
**Sources**: `.maister/tasks/product-design/2026-09-20-wizualizacja-grupy/outputs/product-brief.md:10-45, 68-90`; `analysis/design-decisions.md:16-41`; `analysis/personas.md:5-19`; `analysis/alternatives.md:150-200`.
- Scope: **per-group** visualization mode of participants on the group/term screen: `Group.layout_mode` StrEnum `CIRCLE`/`PITCH`/`TABLE`, default `CIRCLE`, saved via existing `PATCH /groups/{id}`, organizer-only (design-decisions.md:30-32).
- Motivation quote: "Grupy różnią się charakterem (sportowe, przy stole/rzemiosło, ogólne) i chcą mieć wizualną tożsamość dopasowaną do siebie" (product-brief.md:12). Persona goal: "nadać grupie własną tożsamość wizualną dopasowaną do charakteru zajęć" (personas.md:6).
- Component architecture: `GroupVisualization` takes `families, layoutMode, activeFamilyId, onSelectFamily` and renders Circle/Pitch/Table internally; pure geometry in `utils/layoutPositions.ts`; shared `components/shared/Avatar.tsx` (design-decisions.md:18-24). → Pattern for an organizer-layout switch: one data hook, N presentational layout components selected by a key.
- **Editor UX decision**: inline organizer-only segmented control on the very screen being styled (Alt 3A), because "Change and preview are the same view… arguably the strongest UX for a 'purely aesthetic/identity' choice, since seeing is deciding"; the blind settings-form alternative (3B) was rejected for "No preview — the organizer picks a mode blind" (alternatives.md:150-185). Alt 3C: keep the API field screen-agnostic so a settings screen can be added later.
- Constraints adopted: no new frontend deps; "Nowy kod stylowany Tailwindem" (product-brief.md:35-38).
**Implications**:
1. Must clearly distinguish **group `layout_mode`** (participant visualization inside a term page — stays per group, is part of the term page's fixed structure) from the new **organizer page layout** (whole-page section arrangement on `/:slug`). Naming suggestion: `page_layout` / `profile_layout` on Organization.
2. The term page "fixed layout" still contains `GroupVisualization` whose PITCH mode draws a green pitch (`#4E7D55`, `#7E9A34` in `mockups/wizualizacja-grupy-boisko.html`) and avatars use a fixed 8-green `PALETTE` — these must be either token-driven or deliberately exempt from the organizer palette.
3. Strong precedent for editor = live, in-place preview + server-persisted enum.
**Confidence**: High.

## P2. Per-term public pages — URL scheme, organizer slug propagation, organization optional
**Sources**: `.maister/tasks/development/2026-09-08-per-term-public-pages/analysis/requirements.md:11-94`; `analysis/design-context/ascii/ui-mockups.md:20-80`.
- Canonical public term URL `/:organizationSlug/grupa/:groupId/term/:termId`; **"slug cosmetic"** (requirements.md:15) — the term is resolved by ids, not by slug.
- `organizer_slug: string | null` added to `GroupResponse` and `PublicCircleResponse` (FR-4, requirements.md:23, 71). → The term page's public payload already carries organizer identity; adding the organizer's theme (colors) to `PublicCircleResponse` follows the same pattern and avoids a second fetch / flash of unthemed content.
- **An organizer may have no Organization**: copy-link disabled, nudge "Utwórz profil organizacji, aby udostępnić link" → `/organization` (requirements.md:34-35, 47-50). → Theme must have a default (current mint palette) when no Organization or no colors.
- Old route `/krag/:groupId/publiczny` removed (FR-5); only `/:slug/grupa/...` public form.
- Public page states: populated / post-RSVP / no-terms / not-found / loading "Wczytywanie..." (requirements.md:38-45, 76) — all must be themed consistently.
- Phone-frame shell: `.kg-stage` backdrop `#EDF1EA`, `.kg-app` max-width 430px with `--cream` background, floating device frame ≥520px (ui-mockups.md:46-52). Backdrop color `#EDF1EA` is hard-coded outside the token set.
**Confidence**: High (requirements); Medium that the `.kg-*` specifics still hold (later refactors into `TermPage`/`PublicTermView`/`KragStage` — see item-detail mockups referencing `pages/krag/PublicTermView.tsx` and `KragStage.tsx`).

## P3. Item/product detail page — no organizer context; auth-only; Tailwind PhoneFrame
**Sources**: `.maister/tasks/development/2026-10-01-item-detail-page/analysis/requirements.md:3-32`; `analysis/scope-clarifications.md:61-66`; `analysis/design-context/ascii/ui-mockups.md:12-80`.
- `/product/:id` keyed by **`InventoryItem.id`** (UUID), AuthGuard, any logged-in user; `"product"` added to `RESERVED_SLUGS`; edit at `/product/:id/edit` (separate `ItemEditPage`).
- Content: back link, gallery (≤10 photos, fallback `Product.photo_url`, placeholder), name, category, condition, description (`plugin_data["ai-description"]["description"]`), "Aktualny status", "Historia" timeline, "Edytuj" (owner).
- Entry points: term page listing title link (`PublicTermView` → `AttendeeList`), Moje rzeczy, Wypożyczone, notification bell (`/product/{item_id}` links). Back = `navigate(-1)` fallback `/panel/rzeczy`.
- Styling: standalone Tailwind page inside `PublicLayout` + `PhoneFrame` (`bg-cream`, cards `bg-paper border-line`, mint primary buttons, hard-coded `text-[#12604D]` on mint pills).
**Implication (critical for SQ2)**: An item belongs to a **family/owner**, not an organizer, and the URL carries no slug. "Which organizer's palette applies on the product page" is undefined by data: options are (a) carry theme context from the referring term page (router state / query param `?org=<slug>`), (b) derive from the item's active listing/term → group → organizer (may be several or none), (c) default palette when opened from panel/notifications. This is an open product question.
**Confidence**: High (facts); the options are analysis.

## P4. Panel split — where an editor would live
**Source**: `.maister/tasks/development/2026-09-10-panelpage-split/work-log.md:22-60`.
- Panel = `PanelPage` (85 lines) → `PanelDataProvider` + 7 views `views/{HomeView,SpotkaniaView,RzeczyView,PodarkiView,ProfilView,UstawieniaView,RodzinaView}.tsx`, `PanelHeader`, `PanelNav` (bottom tab bar + `NAV_ITEMS`), `PanelModals` (6 modal blocks). Constraint recorded: "zero behaviour change (memory `feedback_prototype_port_fidelity` — keep exact UX)".
- Per-term-pages codebase analysis: Panel line ~932 "Widoczny profil publiczny" is a settings label; line ~747 links to `/${organizationSlug}` (org public page) — `.../2026-09-08-per-term-public-pages/analysis/codebase-analysis.md:65`. Separate `/organization` page exists for creating/editing the org profile (requirements.md:35).
**Implication**: Candidate editor placements: `UstawieniaView` (settings tab), the `/organization` page (`OrganizationPage.tsx`), or — following P1's precedent — an organizer-only "Edytuj wygląd" mode directly on the public `/:slug` page with live preview. Editor UI should be Tailwind (panel convention), not Chakra.
**Confidence**: Medium (line numbers predate the split; frontend gatherer confirms current locations).

## P5. Business-model research — no monetization decisions recorded
**Sources**: `.maister/tasks/research/2026-09-22-business-model-fit-recurring-groups/planning/research-brief.md:36-40` ("Excluded: Payments/billing"); `outputs/research-report.md:22-61`. Grep over all `.maister/tasks/**/*.md` for `monetiz|monetyz|płatn|paid|premium|subscription|abonament|freemium` found no product-monetization decisions (only HF/DO hosting pricing in the moderation research and "Peerby later added paid rental" in lend research — `research/2026-09-25-lend-lifecycle-virtual-inventory/analysis/findings/external-lend-lifecycle.md:102`).
- Report confirms app is **PoC stage, no backward-compatibility requirement** (research-report.md:92-94) and no production deployment (`standards/backend/migrations.md:148`).
**Implication**: The paid-custom-layout intent in the current brief is the **first** recorded monetization signal. No entitlement, plan, subscription, or billing concept exists in docs — the extension path must introduce it from scratch (and billing is out of scope here). PoC status permits additive schema changes without migration-compat concerns.
**Confidence**: High (absence verified by grep).

## P6. Party archetype — Organization as Party
**Sources**: `.maister/tasks/research/2026-09-02-party-archetype-organizer-group/outputs/decision-log.md:19-62`; onboarding task `development/2026-09-09-guest-onboarding-family-panel/analysis/requirements.md:41-50`.
- Original decision: organizer = `Party(Person)`, no separate `Organization` until evidence of need (decision-log.md:30-62). Later implemented: `create_own_organization` creates `Party(ORGANIZATION)`, idempotent; `PATCH /api/organizations/{id}` with owner check (onboarding requirements.md:41-50).
**Implication**: Theme/layout belong to the Organization (brand identity), one per organizer party via `get_own_organization(party_id)`; editing is owner-checked like the existing PATCH. Multiple groups of one organizer share one palette.
**Confidence**: High.

## P7. Category colors precedent — rejected frontend-only palettes
**Source**: `.maister/tasks/development/2026-09-12-admin-panel-plugins-categories/implementation/spec.md:176`.
> "Category colors were dropped for v1; if reintroduced later, it requires a new `color` column and a follow-up task, not a frontend-only fallback palette"
**Implication**: Team preference — persisted, server-side color data rather than client-only derivations. Supports storing the chosen preset/colors on the server (derived shades may still be computed client-side from stored seeds).
**Confidence**: Medium (single precedent).
