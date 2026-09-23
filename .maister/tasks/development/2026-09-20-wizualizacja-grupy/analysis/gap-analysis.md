# Gap Analysis: Wizualizacja grupy — 3 tryby layoutu, ikony wymiany, rozbudowana karta rodziny

## Summary
- **Risk Level**: Medium
- **Estimated Effort**: Medium-High (wielowarstwowa zmiana: model → schema → application → router → matrix → frontend hook → nowe komponenty → testy)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (`KragGrupyPage.tsx`, `useKragGrupy.ts`, `Group` model/schema, `application/circles.py`, `router/circles.py`)
- Creates new entities: yes (`GroupLayoutMode` enum, `exchange_summary.py` module, 2 new backend endpoints, `Avatar`/`GroupVisualization`/layout components, `layoutPositions.ts`)
- Involves data operations: yes (new READ aggregation across `ItemListingPreference`/`Pledge`/`NeededItem`/`Membership`; new WRITE field `layout_mode` via existing PATCH)
- UI heavy: yes (new layout modes, new avatar icons, extended family card, new segmented control)

## Gaps Identified

### Missing Features (don't exist yet, confirmed by direct code read)
- `Group.layout_mode` field: absent from `models.py` (`Group` class, lines 61-69, only has `party_id`/`name`) and from `GroupResponse`/`UpdateGroupRequest` in `schemas.py`.
- `GroupLayoutMode` enum: does not exist anywhere in `app/groups/models.py`.
- `app/groups/application/exchange_summary.py`: does not exist. No aggregation of "shares/brings" per family exists anywhere in the backend today.
- `GET /api/groups/{group_id}/exchange-summary` and `GET /api/groups/{group_id}/families/{family_id}/exchange-offers`: neither route exists in `router/circles.py` or elsewhere.
- Frontend: `PITCH`/`TABLE` layout renderers, `layoutPositions.ts`, `Avatar.tsx`, `GroupVisualization.tsx` — none exist. All positioning logic today is inline in `KragGrupyPage.tsx` (`pos()` at 585-590 plus a duplicated inline trig formula in the SVG line mapper at 868-884).
- Layout-mode segmented control ("Koło/Boisko/Stół"): does not exist.
- Avatar status icons (udostępnia/przynosi): `.kg-mark` CSS class exists (lines 90-91) but is **currently unused** anywhere in the rendered JSX — confirmed no `kg-mark` usage in the avatar rendering block (886-910) or family card (1182-1198).
- Family card "DO WYMIANY W GRUPIE" section: `.kg-card` (1182-1198, confirmed via read) only renders avatar + name + guardians list; no exchange-offer sub-section exists.

### Incomplete Features
- `UpdateGroupRequest` (schemas.py:59-67): currently `name: str` only, explicit docstring says "the only editable Group field" — needs the agreed additive change (optional `layout_mode`), confirmed still required per Clarifications Q1.
- `browseListingsSection`/take-action flow (`KragGrupyPage.tsx`, `TAKE_ACTION_LABELS` at line 177, `takeListing`/`proposeSwap` in `useKragGrupy.ts`) exists and is reusable, but is not currently extracted into a shared function callable from both the family card and the existing browse list — feature-spec Section 6.3 correctly identifies this as needed extraction work, not something already done.

### Behavioral Changes Needed
- `PrivateKragGrupyView` avatar rendering (886-910) must add optional icon slots without changing today's visual output for `CIRCLE` mode (spec 4.1/4.3 requires 1:1 visual parity for the ported circle).
- `PATCH /groups/{id}` (router/circles.py 177-185, application/circles.py 108-116) must accept and thread through an optional `layout_mode` alongside the required `name`, preserving the existing active-organizer ownership check — additive, not a redesign.

## Critical Naming/Typing Discrepancy — Broader Than Previously Flagged

The task brief and codebase-analysis.md already flag `KragFamily.familyId: number` vs. feature-spec's assumed `string`. Direct verification shows **this is systemic across the entire feature-spec.md contract, not isolated to `familyId`**:

Confirmed by reading actual code:
- `src/backend/app/groups/schemas.py:25-26`: `GroupResponse.id: int`, `party_id: int`.
- `src/frontend/src/api/groups.ts:4-9`: `GroupResponse.id: number`, snake_case field names (`party_id`, `organizer_slug`) passed through **unconverted** from the backend — this codebase does NOT camelCase backend response fields at the API-client boundary; `GroupResponse.organizer_slug` stays snake_case all the way into components.
- `src/frontend/src/hooks/useKragGrupy.ts:41-45,58,99-103`: `KragFamily.familyId: number`, `myPartyId: number | null`, `termId: number` (method params) — every ID in the app is `number`, and hook-owned fields (not raw API passthrough) use camelCase naming, but always numeric typing.

The feature-spec.md (Sections 1, 3, and cross-references in 5/6/7) types **every new ID as `string`**: `family_id: str`/`familyId: string`, `group_id: str`/`groupId: string`, `term_id: str | None`/`termId: string | null`, `listing_id`, `item_id`, `lister_party_id` — all `str`/`string`. None of this matches the codebase's actual (and completely consistent) convention of numeric IDs throughout.

**Impact**: every new Pydantic DTO in Section 1, every new TS interface in Section 3, and the API client functions in 3.1 need `str`/`string` → `int`/`number` corrections before implementation, not just the one `familyId` instance already flagged. This is a spec-correction item for Phase 5 (specification-creator), not an open question — the direction is unambiguous (follow existing numeric-ID convention), but it's larger in scope than the codebase-analysis note suggested.

## Authorization Matrix — Spec Overspecifies

Feature-spec.md Section 2.1/2.2 calls for **new explicit rows** in `AUTHORIZATION_MATRIX` for the two new GET endpoints (`.../exchange-summary`, `.../families/.../exchange-offers`), modeled on rows 55-58.

Direct read of `authorization_matrix.py` shows rows 55-58 are for **unrelated resource paths** (`/api/term-item-listings`, `/api/item-listing-preferences`), not `/api/groups`. The file's own comment (lines 169-175) documents the established convention explicitly: `POST /api/groups/mine/attendances/{id}/withdraw` needed **no new row** because it already falls under blanket row 27 (`POST ^/api/groups(/.*)?$`). By the same logic, `GET /api/groups/{id}/exchange-summary` and `GET /api/groups/{id}/families/{id}/exchange-offers` already fall under blanket row 26 (`GET ^/api/groups(/.*)?$` → READ) and need **no new matrix row** — confirming codebase-analysis.md's suspicion as correct, not just plausible.

**What is still genuinely needed** (feature-spec is right about this part): the **membership/ownership check in `service.py`/`application/exchange_summary.py`**, since the blanket READ row alone doesn't enforce "caller must be a Membership or Leadership of this specific group" — that's new business logic, not a matrix change.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | Layout is fixed CIRCLE, no control | Organizer sees segmented control directly above visualization on the same screen (no new route/page) | Positive — no navigation change, control is co-located with what it affects |
| Discoverability | N/A (no choice exists) | Segmented control with icon+label, `isOrganizerViewer`-gated, pill-shaped visible UI element directly above the visualization | 8/10 — standard, immediately visible pattern, no hidden settings screen |
| Flow Integration | Avatars are static, clicking selects family for `.kg-card` | Same click still selects family; new icons and new card section are additive, no extra click/step required to see them | Positive — no added friction to existing "click avatar → see card" flow |
| Multi-Persona | Only organizer view distinguished today (`isOrganizerViewer`) | Non-organizer members see the same layout read-only (`group.layoutMode` from data, no control) — feature-spec 5.1 explicitly covers this | Consistent — both personas handled explicitly in spec |

No orphaning risk on the switcher itself: write path (PATCH, organizer-only) and read path (all members see current mode) both explicitly specified.

## Data Lifecycle Analysis

### Entity: Family exchange status (sharesItem/bringsItem) — READ-only aggregate, no CREATE/UPDATE/DELETE of its own

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| READ (summary, all families) | New `GET .../exchange-summary`, not yet implemented | Icons on avatars (`Avatar` component, new) | Rendered inside `GroupVisualization`, always visible when data loads | ✅ planned, fully specified |
| READ (detail, per family) | New `GET .../families/{id}/exchange-offers`, not yet implemented | New "DO WYMIANY W GRUPIE" section in `.kg-card` | Lazy-loaded on avatar click, same interaction users already use to open the card | ✅ planned, fully specified |
| ACTION ("Biorę") | Reuses existing `takeListing`/`proposeSwap` (already implemented in `useKragGrupy.ts`) | New button in family card, routed through extracted shared handler (not yet extracted) | Available directly from the new card section, no dead end | ✅ planned — this is the one true CREATE-adjacent operation involved (creates a `Reservation`/`SwapProposal`), and it is NOT orphaned: it reuses a proven, already-accessible action path |

**Completeness**: 100% as specified — no orphaned operation identified. The underlying source data (`ItemListingPreference`, `Pledge`) already has full CRUD elsewhere in the app (listing creation/pledge claiming happens via existing Term-page flows, out of scope here); this feature only adds new **read surfaces** plus a passthrough action button, which is the correct shape for a "visualization" feature.

**Missing touchpoints**: none identified beyond what feature-spec.md already scopes. Feature-spec 8.3 explicitly and correctly excludes: public view, dedicated settings screen, realtime sync, "Napisz" button, interactive table chips — all reasonable exclusions matching the Phase-1 clarifications.

## Defect Analysis
Not applicable — no reproducible defect; this is a scoped feature addition.

## Risk Assessment

- **Complexity Risk (Medium-High)**: Seven coordinated layers must change together (model → migration → schema → application → router → frontend hook → frontend components → tests). No single layer is individually hard, but the coordination surface is large, matching codebase-analysis.md's "Complex" rating.
- **Integration Risk (Medium)**: The pre-existing duplicated circle trigonometry (`pos()` at 585-590 and the inline SVG line mapper at 868-884) must be unified into `getCirclePosition` during extraction (feature-spec 4.1/4.4 requires 1:1 visual parity) — if the two aren't reconciled correctly, the ported `CircleLayout` will visually regress (avatars and connector lines could point to different angles for the same family). This is a real, non-trivial refactor risk, not just a cosmetic note.
- **Regression Risk (Medium)**: Three existing test files (`KragGrupyPage.test.tsx` 606 lines, `useKragGrupy.test.ts` 348 lines, `PublicKragGrupyPage.test.tsx` 834 lines) assert today's shape/positions and will need updates — confirmed these are large, detailed suites, so updates are non-trivial effort, not incidental. `PublicKragGrupyPage.test.tsx` should need no assertion changes since `PublicKragGrupyView` is explicitly out of scope, but should be re-run to confirm no incidental coupling (e.g., shared CSS classes, shared types like `GroupResponse.layout_mode` appearing in public payloads).

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
None. Direct code verification resolved every open question that could have been critical:
- ID typing direction is unambiguous (numeric, matching 100% of the existing codebase) — not a judgment call.
- Authorization matrix approach is unambiguous (no new rows needed, per the file's own documented precedent) — not a judgment call.
- Scope boundary (private-only, no public view changes) was already confirmed with the user in Clarifications Q2.

### Important (Should Decide / Confirm Before Spec Finalization)
1. **ID typing correction scope in feature-spec.md**: All new DTOs/interfaces (Sections 1, 3) currently type IDs as `str`/`string`; they must be corrected to `int`/`number` to match the codebase's exclusive numeric-ID convention.
   - Options: (a) Update feature-spec.md directly during Phase 5 spec creation to use `int`/`number` throughout before planning, (b) leave feature-spec.md as historical design record and apply corrections only in the Phase 5 output spec.
   - Recommendation: (b) — feature-spec.md is a source design doc from product-design phase; correct types in the Phase-5 `spec.md` that implementation actually follows, and note the discrepancy rather than editing the design doc retroactively.
   - Rationale: keeps design-history intact while ensuring the buildable spec is correct.

2. **Authorization matrix rows**: feature-spec.md 2.1/2.2 calls for new matrix rows; codebase precedent (documented in the matrix file itself) says none are needed for GET endpoints under `/api/groups/...` because blanket row 26 already covers them.
   - Options: (a) Follow codebase precedent — no new matrix rows, only add the membership/ownership check in `exchange_summary.py`/service layer, (b) Add explicit rows anyway for matrix readability per feature-spec's stated rationale ("kolejność nie zmienia efektywnego uprawnienia... zachowuje czytelność").
   - Default/Recommendation: (a), matching the established convention documented at lines 169-175 of `authorization_matrix.py` for the analogous `attendances/withdraw` case.
   - Rationale: consistency with existing, explicitly-documented precedent; avoids matrix bloat.

3. **`server_default` cleanup for `layout_mode` migration**: feature-spec.md 1 notes uncertainty ("do potwierdzenia z istniejącymi migracjami Group") about whether to drop the `server_default` after backfill, per project migration conventions.
   - Options: (a) Keep `server_default="CIRCLE"` permanently (simplest, matches `nullable=False` + application-level default already being sufficient), (b) Follow the add-nullable→backfill→not-null→drop-server-default pattern referenced from migration `0029`.
   - Default: (a) — no existing rows need backfill logic since `server_default` alone handles both new and existing rows correctly for a simple enum column with a fixed default; the `0029`-style multi-step pattern is typically needed when the default itself is computed/conditional, which isn't the case here.
   - Rationale: matches the "minimal implementation" standard and avoids unnecessary migration steps for a case that doesn't need them; should be confirmed against `standards/backend/migrations.md` during Phase 5/6.

## Recommendations
1. Carry all findings above into Phase 5 specification-creator: correct ID types (int/number) throughout, drop the two proposed matrix rows in favor of the existing blanket-row + service-layer-membership-check pattern, and resolve the `server_default` migration-shape question per `standards/backend/migrations.md`.
2. Unify the duplicated circle trigonometry (`pos()` + inline SVG mapper) as the very first frontend implementation step, before building `PitchLayout`/`TableLayout`, so the extracted `getCirclePosition` is provably identical to today's rendering (visual regression test or snapshot comparison recommended).
3. Extract the "Biorę" action handler (feature-spec 6.3) before wiring the new family-card section, so both call sites (existing browse list, new card section) share one implementation from day one rather than being reconciled after the fact.
4. Preserve all three existing test files by updating assertions in place (per project convention: pre-production, no compat shims, but tests get updated not deleted).

## Structured Output

```yaml
status: "success"
report_path: "analysis/gap-analysis.md"

risk_level: "medium"
effort_estimate: "medium-high"

task_characteristics:
  has_reproducible_defect: false
  modifies_existing_code: true
  creates_new_entities: true
  involves_data_operations: true
  ui_heavy: true

change_type: "additive"
compatibility_requirements: "flexible"

user_journey_impact:
  reachability_change: "+1"
  discoverability_before: null
  discoverability_after: 8
  flow_integration: "positive"

integration_points:
  - "PATCH /api/groups/{id} (existing, extend with optional layout_mode)"
  - "New GET /api/groups/{group_id}/exchange-summary (falls under existing blanket matrix row 26, no new row needed)"
  - "New GET /api/groups/{group_id}/families/{family_id}/exchange-offers (same blanket row)"
  - "PrivateKragGrupyView only — PublicKragGrupyView untouched (confirmed scope)"
patterns_to_follow:
  - "_enum_column + enum.StrEnum pattern (models.py 26-33) for GroupLayoutMode"
  - "application/*.py facade pattern behind service.py (DDD-lite, per project memory)"
  - "_list_eligible_lister_party_ids / _is_item_available reuse from term_item_listings.py/attendance.py"
architectural_impact: "medium"

data_lifecycle_gaps:
  orphaned_operations: []
  missing_touchpoints: []
  completeness_score: 100

decisions_needed:
  critical: []
  important:
    - id: "id-typing-correction"
      issue: "feature-spec.md types every new ID (family_id, group_id, term_id, listing_id, item_id, lister_party_id) as str/string; entire codebase (backend Pydantic schemas, frontend api/groups.ts, useKragGrupy.ts) uses int/number exclusively, with no camelCase-conversion boundary that would explain a string representation"
      options: ["Correct types to int/number in the Phase 5 spec.md (leave design-doc feature-spec.md as historical record)", "Edit feature-spec.md in place"]
      recommendation: "Correct in Phase 5 spec.md only"
      rationale: "feature-spec.md is a product-design phase artifact; the buildable spec must match the codebase's exclusive numeric-ID convention, verified by direct code read (schemas.py, groups.ts, useKragGrupy.ts)"
    - id: "authorization-matrix-rows"
      issue: "feature-spec.md 2.1/2.2 calls for 2 new AUTHORIZATION_MATRIX rows for the new GET endpoints; the matrix file's own documented precedent (lines 169-175, re: attendances/withdraw) establishes that /api/groups/... GET/POST routes needing no distinct permission level require no new row, since blanket rows 26/27 already cover them"
      options: ["No new matrix rows; add membership/ownership check only in service/application layer (matches documented precedent)", "Add explicit new rows per feature-spec.md for matrix readability"]
      recommendation: "No new matrix rows"
      rationale: "Directly confirmed against authorization_matrix.py source and its own inline documentation of the identical precedent case"
    - id: "layout-mode-migration-shape"
      issue: "feature-spec.md 1 flags uncertainty about whether to drop server_default after backfill for the new layout_mode column, per project migration conventions (0029-style pattern)"
      options: ["Keep server_default=CIRCLE permanently (simple add_column, no backfill steps)", "Follow add-nullable→backfill→not-null→drop-server-default multi-step pattern"]
      recommendation: "Keep server_default permanently"
      rationale: "The 0029-style pattern is for computed/conditional defaults; a fixed enum default needs no multi-step migration, and standards/backend/migrations.md favors small, minimal migrations"

scope_expansion_recommended: false
critical_issues: []
```
