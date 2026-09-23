# Design Alternatives: Wizualizacja grupy zajęciowej

Source context: `analysis/design-context.md`, `analysis/problem-statement.md`, `analysis/personas.md`, mockups (`context/default.png`, `context/boisko.png`, `context/table.png`), and direct reads of `src/frontend/src/pages/krag/KragGrupyPage.tsx`, `src/frontend/src/hooks/useKragGrupy.ts`, `src/backend/app/groups/models.py`.

Each decision area below has 2-3 genuine alternatives with pros/cons and a recommendation. These are meant to be walked through one-by-one with the user for convergence, then handed to the solution-designer.

---

## Decision Area 1: Data aggregation architecture (udostępnia/przynosi flags + family exchange list)

Two distinct data needs exist, and they don't have to use the same architecture:
- **A.** A boolean-per-family "udostępnia" / "przynosi" flag, rendered on *every* avatar, for *every* viewer, on every page load.
- **B.** The full list of a family's active exchange offers, fetched lazily only when that one family's card is opened.

### Alternative 1A: Fully client-side derivation in `useKragGrupy`

**Description**: Reuse data `useKragGrupy` already fetches this session (`getMyItemListingPreferences`-equivalent for *all* families, or a new bulk `GET` per family) and derive both the per-avatar flags and the full exchange list in the hook via `.filter()`/`.map()`, the same way `pledgeFamilyName` and `mySwapAvailableItems` are already derived today.

**Pros**:
- Zero backend changes — matches "no DB schema change beyond one Group field" instinct even more conservatively.
- Fast to implement; pattern already proven in this exact file (see `mySwapAvailableItems` derivation, lines 190-196 of `useKragGrupy.ts`).
- No new `AUTHORIZATION_MATRIX` row to design/review.

**Cons**:
- There is no existing endpoint that returns `ItemListingPreference`/`Pledge` data for *all* families in a Circle at once — today's endpoints (`getMyItemListingPreferences`, `getPledges(neededItemId)`) are scoped to "my own" or "per needed-item". Getting per-family flags would require either N+1 client-side calls (one per family, per guardian `party_id`) or a brand-new bulk-shaped response, which is really "a new backend contract" wearing a client-side hat.
- The "do wymiany" list needs the same cross-guardian join (a family's offers = union of all its guardians' `ItemListingPreference`s) — this join does not exist client-side today either.
- Every avatar-icon computation re-runs this join client-side on every render/family-list-change; with N families x M guardians x K items this is the "N+1-shaped client filtering" the codebase-analyzer already flagged as a concern.
- Business rule (what counts as "active", term-scoping) lives in the frontend instead of one authoritative backend location — future consumers (e.g. a future "public circle view") would have to re-implement it.

**Best when**: Family counts stay small (typical group size, ~8-15 families) and there's appetite to accept some duplicated filtering logic for speed of delivery.

**Evidence links**: `useKragGrupy.ts` already does this exact kind of derivation for `mySwapAvailableItems`; design-context.md flags the N+1-shaped risk explicitly.

---

### Alternative 1B: New backend aggregation endpoint(s) for both needs

**Description**: Add one new backend endpoint that returns, per family in a Circle, the aggregated flags (`sharesItem: bool`, `bringsItem: bool`) in a single response keyed by `familyId` — e.g. extending the existing `get_public_circle_view`-style aggregation or a new private `GET /groups/{id}/families/exchange-summary`. Separately, add `GET /groups/{id}/families/{familyId}/exchanges` for the full offer list, fetched lazily on card-open.

**Pros**:
- Single source of truth for "what counts as active/current" — one service function, testable with the project's integration-first backend testing standard.
- Avoids N+1-shaped client-side joins entirely; the per-avatar flags come back in one round trip regardless of family count.
- Matches the codebase's DDD-flavored pattern (`service.py` facade) and its existing `AUTHORIZATION_MATRIX` gate style — no architectural precedent needs to be invented, just one more row + one more service function, consistent with how `groups`/`circulation` already expose aggregation-shaped reads.
- Scales cleanly if flags are later needed elsewhere (e.g., a future public/print view).

**Cons**:
- More surface area to build and review: new route(s), new `AUTHORIZATION_MATRIX` entries, new service functions, new integration tests (backend testing standard requires TestContainers-based tests, not unit stubs).
- Slightly slower to ship than pure client derivation.
- Introduces a second aggregation surface alongside the existing `get_public_circle_view` unless it's cleanly extended rather than duplicated — needs a decision on whether it's an extension or a sibling.

**Best when**: The per-avatar flags need to be correct and performant regardless of group size, and the team wants one authoritative business-rule location (consistent with "the codebase-analyzer recommends backend aggregation for the icons").

**Evidence links**: design-context.md explicitly: "Codebase-analyzer recommends backend aggregation for the icons... can allow lazy client-side fetch for the 'do wymiany' list detail on card-open." `AUTHORIZATION_MATRIX` pattern documented in `standards/backend/security.md`.

---

### Alternative 1C: Hybrid — backend aggregation for flags (bulk), client-side/lazy fetch for the family-card list

**Description**: Split by usage pattern, exactly as the codebase-analyzer already suggested: a new backend bulk endpoint computes and returns the per-family `sharesItem`/`bringsItem` booleans for the whole Circle in one call (used by every avatar, every load — needs to be cheap and correct). The "do wymiany w grupie" list, which is only needed for *one* family at a time on card-open, is fetched via a smaller, per-family endpoint (still backend, but lazily called) — not derived client-side, since the cross-guardian join doesn't exist anywhere yet and shouldn't be invented twice (once in a bulk aggregation, once ad hoc in the frontend).

**Pros**:
- Matches actual usage shape: bulk-and-always for icons, single-and-on-demand for the card list — avoids over-fetching the full exchange list for every family up front.
- Both need the same underlying cross-guardian join logic; keeping both server-side means that join is written once and reused (bulk endpoint can even internally call the same per-family aggregation helper function, just batched).
- Keeps the client as thin as the existing pattern (`useKragGrupy` already lazily triggers additional fetches, e.g. `getMyItemListingPreferences`, only under certain conditions).

**Cons**:
- Two endpoints instead of one — marginally more to design/review than Alternative 1B's two-endpoint-anyway shape, but conceptually the same cost since 1B already proposed two endpoints.
- Requires care that the "active offer" business rule (what counts as active/current) is implemented identically in both the bulk aggregation and the per-family detail fetch, ideally via one shared service-layer helper to avoid drift.

**Best when**: This is functionally identical to 1B's two-endpoint shape — the distinction from 1B is purely about explicitly designing the bulk-vs-per-family split as a first-class product of a single shared join helper, rather than leaving that reuse implicit.

**Evidence links**: Same as 1B — this is really 1B made explicit, not a separate architecture.

### Recommendation

**Alternative 1B (equivalently 1C)** — new backend aggregation, split into a bulk per-Circle summary endpoint (flags) and a per-family detail endpoint (exchange list), sharing one service-layer join helper. Rationale: this is what the codebase-analyzer already flagged as the right shape, it avoids inventing a cross-guardian join client-side that the codebase doesn't have anywhere today, and it keeps the "what counts as active" business rule in one place (relevant given the problem statement's explicitly-deferred open question about exact time-scoping — a backend rule is far easier to adjust later than logic scattered across `useKragGrupy` derivations). Pure client-side derivation (1A) is rejected mainly because the *join*, not just the filter, doesn't exist yet — this isn't "reuse what's fetched," it's "fetch and join data that has no client-visible shape today."

---

## Decision Area 2: Component/code structure for the 3 layout modes

`KragGrupyPage.tsx` is already a 1733-line untested monolith with inline CSS-in-JS. This decision is about whether/how to extract, given the explicit encouragement to extract `layoutPositions.ts` and a shared `Avatar` component, but the explicit *non*-goal of a full CSS-in-JS→Tailwind rewrite.

### Alternative 2A: Inline branching within `KragGrupyPage.tsx`

**Description**: Add a `layoutMode` prop/state and `if`/switch branches directly inside the existing render function — new pitch/table JSX blocks alongside the existing circle JSX block, still using the existing `pos(i)`-style inline functions (now three of them, e.g. `posCircle(i)`, `posPitch(i)`, `posTable(i)`), all still living in the same file.

**Pros**:
- Fastest to ship — no new files, no new import surface, minimal risk of breaking the existing (currently-working) circle mode.
- Keeps everything one developer needs to see in one place while iterating on the mockup-to-code match.

**Cons**:
- Directly contradicts the explicit guidance ("extraction encouraged... `layoutPositions.ts`, `GroupVisualization` component") and makes the monolith worse, not better — three JSX render branches plus three position functions plus the new icon/card logic pushes this file well past 2000 lines.
- Makes future testing harder: this file has zero test coverage today, and inline branching in a 2000-line function is close to untestable in isolation.
- New Tailwind-styled UI (icons, expanded card) mixed into a CSS-in-JS file makes the two styling systems visually intermix in one diff, which is exactly what the constraint says to avoid ("Tailwind, not another inline CSS-in-JS-in-`KragGrupyPage.tsx`").

**Best when**: Genuinely never recommended here — this is the strawman that shows why extraction matters, included for completeness/comparison rather than as a real contender.

---

### Alternative 2B: Extract `layoutPositions.ts` (pure functions) + shared `Avatar` component, keep layout JSX branches inside `KragGrupyPage.tsx`

**Description**: Pull the trigonometric/geometric position math into a standalone, pure, testable module — `layoutPositions.ts` exporting `getCirclePosition(i, n)`, `getPitchPosition(i, n)`, `getTablePosition(i, n)` (each returning `{ top, left }`-style style objects or `{x, y}` SVG coordinates). Extract a shared `Avatar` component (Tailwind-styled, replacing the 2-3 duplicate avatar-initials implementations). The three layout *renders* (which JSX/graphic to show — pitch background image, table oval, circle SVG lines) stay as three branches inside `KragGrupyPage.tsx`, each consuming the new position functions and the new `Avatar`.

**Pros**:
- Directly satisfies the explicit extraction guidance without over-engineering: the *math* (easily unit-testable, pure, no React) is separated from the *rendering* (still coupled to this screen's specific markup/styling, which doesn't obviously deserve full separation yet).
- `layoutPositions.ts` becomes a natural first Vitest target for a currently-untested file — each `getXPosition` function is a pure function of `(index, total)` → coordinates, trivially testable for "no two families overlap" success-criterion.
- Avatar consolidation directly kills the named "2-3 duplicate implementations" tech debt in the same change.
- Moderate risk/effort — doesn't require re-architecting how `KragGrupyPage.tsx` composes its sections.

**Cons**:
- The render branches (pitch graphic, table graphic, circle SVG) still live inside the big file, so the file keeps growing in JSX size even if its logic is thinner — mitigates but doesn't fully solve the monolith problem.
- Three fairly different visual layouts (pitch has a background graphic + fixed zones, table has an oval + floating item chips, circle has SVG connector lines) as three inline conditional blocks is still a lot of new JSX mixed into one render function.

**Best when**: The priority is "meaningfully improve testability and kill flagged duplication without a large structural risk to a screen users depend on today."

**Evidence links**: design-context.md: "extraction is encouraged... `layoutPositions.ts`, `GroupVisualization` component"; "avoid a third duplicate of avatar-initials logic — extract a shared Avatar component" (explicit constraint).

---

### Alternative 2C: Extract `layoutPositions.ts` + shared `Avatar` + a dedicated `GroupVisualization` component (with pluggable layout renderers), leaving only wiring in `KragGrupyPage.tsx`

**Description**: Go one step further than 2B — in addition to the pure position functions and `Avatar`, extract a `GroupVisualization` component that owns the "given families + layoutMode + activeFamilyId, render the visualization area" responsibility entirely (SVG/background graphic, avatar placement, click handling, the "+" invite slot). Internally, `GroupVisualization` dispatches to one small per-mode renderer (`CircleLayout`, `PitchLayout`, `TableLayout`) that each consume `layoutPositions.ts` and `Avatar`. `KragGrupyPage.tsx` shrinks to: fetch data via `useKragGrupy`, manage `activeFamilyId`/`layoutMode` state, render `<GroupVisualization .../>` plus the (also extracted, ideally, though out of this task's explicit scope) family card and "kto co przynosi"/exchange sections.

**Pros**:
- Cleanest separation: `GroupVisualization` becomes independently testable (Testing Library, mock family list, assert 3 avatars render in `layoutMode="pitch"` without overlap) without touching any of the fetch/mutation logic in the parent.
- Makes the new "3 layout modes" concept literally visible as one importable component with a `layoutMode` prop — closest structural match to "this is a layout-mode extension feature," making the code map directly onto the feature description.
- Directly chips away at the 1733-line monolith (moves ~300-500 lines of JSX out), the single most-flagged piece of tech debt in this codebase's context for this screen.
- Sets up a clean seam for the organizer-facing layout-mode switcher control (Decision Area 3) to sit next to `GroupVisualization` rather than buried in page-level JSX.

**Cons**:
- More new files/exports to review in one PR; higher short-term effort than 2B.
- Slight risk of scope creep beyond "extend the screen" into "refactor the screen" if not scoped carefully — the task explicitly says a full CSS-in-JS→Tailwind rewrite is out of scope, and this alternative needs discipline to keep `GroupVisualization`'s internals still using the existing inline-style/CSS-var approach (or Tailwind only for genuinely new elements: icons, layout switcher) rather than triggering an incidental full rewrite of the circle mode's existing styling.
- Needs a prop-drilling or small-context decision for what `GroupVisualization` needs from the parent (families, organizer, activeFamilyId, onSelectFamily, layoutMode) — trivial, but is a real interface to design.

**Best when**: The team wants the extraction to earn its keep by making three fundamentally different visual metaphors (pitch/table/circle) live as clearly separated, comparably-testable units — appropriate given this task doubles the number of layout modes and is explicitly flagged as `is_complex=true`.

**Evidence links**: design-context.md: "extraction is encouraged (`layoutPositions.ts`, `GroupVisualization` component) rather than inlining further"; "1733-line monolith... zero test coverage."

### Recommendation

**Alternative 2C** — extract `layoutPositions.ts`, a shared `Avatar`, and a `GroupVisualization` component with three internal per-mode renderers. Rationale: this task literally doubles the number of layout metaphors on this screen (1 → 3) and adds a switcher control; that's exactly the shape of change the codebase-analyzer's extraction recommendation was aimed at, and doing it now (while building the pitch/table modes fresh, with no existing code to preserve) is much cheaper than doing it later once three inline branches exist in the monolith. The risk of scope creep (Cons) is real but manageable by explicitly scoping `GroupVisualization` to *only* the visualization area, not the family card or "kto co przynosi" sections (those stay out of scope per the task). 2B is a reasonable fallback if the user wants to minimize this task's blast radius further.

---

## Decision Area 3: Layout-mode setting UX (where/how the organizer changes it)

### Alternative 3A: Inline control directly on the `/krag/:groupId` visualization screen

**Description**: A small, organizer-only control (e.g. a segmented button group or icon-toggle row: "Koło / Boisko / Stół") rendered directly above or beside the visualization area on the same screen everyone already views, visible only when `isOrganizerViewer` is true (the same gate pattern already used elsewhere in this file, per personas.md's note on conditional rendering).

**Pros**:
- Zero navigation — organizer sees the effect of their change immediately, in place, without leaving the screen; matches persona journey described in personas.md almost verbatim ("wchodzi na `/krag/:groupId` → ... → wybiera tryb layoutu z 3 opcji").
- Reuses the existing `PATCH /groups/{id}`-style flow (per personas.md) with a minimal new field — no new screen, no new route.
- Change and preview are the same view, minimizing risk that the organizer picks a mode without understanding what it looks like — arguably the strongest UX for a "purely aesthetic/identity" choice, since seeing is deciding.

**Cons**:
- Adds another organizer-only conditional UI element to an already-dense header/visualization area — needs careful placement so it doesn't compete visually with the "Wróć"/"Mój panel" header controls already there.
- Slight risk of accidental mode changes if the control is too prominent/easy to trigger (mitigated with a confirm-on-change or simply accepting instant, freely-reversible changes per the stated "not a one-time/locked setting" success criterion — arguably not even a real con given that explicit constraint).

**Best when**: The setting is expected to be changed occasionally/experimentally (which the problem statement explicitly supports — "organizator może zmienić w dowolnym momencie, nie jest to ustawienie jednorazowe") and the org values seeing the effect immediately.

**Evidence links**: personas.md's organizer journey; problem-statement.md's success criterion ("odwracalna w dowolnym momencie").

---

### Alternative 3B: Fold into an existing group-settings flow/screen (if one exists) rather than the visualization screen

**Description**: If the codebase already has a dedicated group-settings surface (e.g. a "group edit" form reached from group management/admin panel, separate from `/krag/:groupId`), add the layout-mode selector there as one more form field, submitted via the existing `PATCH /groups/{id}`.

**Pros**:
- Consistent with "settings live in settings" mental model — if organizers already go to a settings screen to rename the group, change other group-level properties, etc., this keeps all group-level config in one discoverable place.
- Avoids adding any new UI chrome to the already-complex visualization screen.

**Cons**:
- No preview — the organizer picks a mode blind (or has to save, then navigate back to `/krag/:groupId` to see the result, then possibly go back to change again) — meaningfully worse UX than 3A for what is fundamentally a visual/aesthetic choice best judged by seeing it.
- Adds a navigation round-trip to the specific "try boisko, see if I like it, maybe switch to stół" workflow the problem statement anticipates.
- Requires locating/confirming such a settings screen exists and has room for a new field — not confirmed in the artifacts read so far; if no such screen exists, this alternative requires building one, which is disproportionate scope for a single-field toggle.

**Best when**: A group-settings screen already exists, is actively used by organizers for other config, and the team wants to avoid growing the visualization screen at all costs.

**Evidence links**: personas.md mentions "istniejący `PATCH /groups/{id}` flow" without confirming a dedicated settings *screen* exists — this alternative's feasibility should be checked against the actual codebase before being seriously pursued.

---

### Alternative 3C: Both — inline quick-switch on the visualization screen, backed by the same `PATCH /groups/{id}` used by (or added to) group settings

**Description**: Build the inline control from 3A as the primary/only UI for this task, but design the underlying `PATCH` field so that if a group-settings screen exists or is added later, it can read/write the same field without any backend change — i.e., don't couple the *data* layer to "lives only on the visualization screen." This isn't really a separate UX from the organizer's perspective right now (there's still exactly one place to change it: the visualization screen); it's a note that the API contract should stay screen-agnostic.

**Pros**:
- Gets 3A's immediate-preview UX benefit now, while not foreclosing 3B later if a settings screen is added.
- The `PATCH /groups/{id}` field-level design work is the same regardless of which UI ends up calling it, so this isn't extra work — just extra care in the schema (`layout_mode` as its own field/enum, not something baked awkwardly into the visualization component's local state).

**Cons**:
- If read as "build both UIs," this doubles UI surface for no immediate user benefit — must be scoped explicitly as "build 3A's UI now; just don't paint the API into a corner."

**Best when**: This is really a refinement of 3A, not a distinct third path — worth naming so the API/schema decision (Decision Area — new `Group.layout_mode` field) isn't accidentally coupled to "this control only ever lives on this one screen."

### Recommendation

**Alternative 3A** (with 3C's framing note baked in): build the inline organizer-only control on `/krag/:groupId` itself, backed by a plain `layout_mode` field on `Group` via the existing `PATCH /groups/{id}` pattern. Rationale: this is a visual/aesthetic choice best judged by immediate visual feedback, it matches the persona journey already documented, and it requires no new screen. Keep the backend field generic enough (a string-backed enum per the project's SQLAlchemy modeling standard — `CIRCLE` / `PITCH` / `TABLE`, defaulting to `CIRCLE`) that a future dedicated settings screen (3B) could read/write it too without a schema change.

---

## Decision Area 4: Positioning algorithm for pitch/table modes

The existing circle mode uses `pos(i)` — an evenly-spaced trigonometric ring around a center point, parameterized by index `i` and total slot count. Pitch and table need analogous pure functions with no tactical/seating meaning, per the explicit constraint.

### Alternative 4A: Fixed slot table, sized to the mockup, with graceful overflow handling

**Description**: Hard-code a fixed number of named slots per mode based on the mockups (pitch: GK/2×DEF/2×MID/1×FWD = 6 outfield slots + bench, as shown in `boisko.png`'s WI/NO/LE/KO/ZI/MA/KA layout; table: perimeter slots as shown in `table.png`'s 6-around-oval layout), and assign families to slots in order. When family count exceeds the fixed slot count, either add an overflow "+N more" indicator or start doubling up positions.

**Pros**:
- Visually matches the mockups exactly for the common case (mockups show ~6-7 families) — lowest risk of "doesn't look like the design."
- Simple, deterministic, easy to unit-test (`getPitchPosition(i, n)` for `n <= slotCount` is a lookup table).

**Cons**:
- Directly conflicts with the explicit success criterion: "Tryby boisko/stół poprawnie rozkładają **dowolną liczbę rodzin** ... bez nakładania się avatarów." A fixed slot table by construction breaks for group sizes larger (or much smaller, looking sparse/awkward) than the mockup's ~6-7.
- Overflow handling (queue past slot 7? double up in the same slot?) becomes an ad hoc special case rather than a general algorithm — the kind of "future stub" the project's minimal-implementation standard would flag as premature/incomplete rather than actually minimal.

**Best when**: Genuinely never fully sufficient alone given the explicit "any N" success criterion — but its per-mockup slot *shape* (rows/zones for pitch, perimeter for table) is valuable as the visual target that a generalized algorithm (4B) should degrade gracefully towards for typical N.

---

### Alternative 4B: Generalized row/zone distribution (pitch) and generalized perimeter distribution (table), parameterized by N — extending, not replacing, the circle mode's approach

**Description**: Write `getPitchPosition(i, n)` and `getTablePosition(i, n)` as pure functions of `(index, total)`, mirroring how `pos(i)` already works for the circle (which is itself already generalized — it divides `2π` by `slots`, so it already handles arbitrary N gracefully). For pitch: divide N families across a fixed number of horizontal "zones" (e.g. `Math.ceil(N / rowSize)` rows, evenly spaced vertically within the pitch graphic, each row evenly spacing its members horizontally) — same visual flavor as the mockup (rows resembling defense/midfield/attack) without hard-coding to exactly 4 rows or exact counts per row. For table: distribute N points evenly around the oval's perimeter using the same trigonometric approach as the circle (an ellipse parametrization: `x = cx + a*cos(θ)`, `y = cy + b*sin(θ)`, `θ = (i/N)*2π`), which is a near-drop-in reuse of the existing `pos(i)` math with different radii for x/y.

**Pros**:
- Satisfies the "any N" success criterion by construction — same guarantee the existing circle mode already has.
- Table mode is almost pure reuse of `pos(i)`'s existing trigonometry (ellipse instead of circle) — very low implementation risk, directly reuses a proven pattern instead of inventing a new one.
- Pitch mode's row-based approach still visually reads as "positions on a pitch" (rows suggest goalkeeper/defense/midfield/attack without claiming to *be* real positions) — matches the "no tactical meaning, algorithmic/random" constraint while still looking intentional, matching the mockup's overall visual rhythm for typical N.
- Both functions are pure `(i, n) → {x, y}` and trivially unit-testable for "no overlap for N in [1..30]" the same way 4A's lookup table would be, but without the overflow special-case problem.

**Cons**:
- For very large N, a fixed-height pitch graphic with many rows could produce visually cramped or tiny avatars — needs a sensible cap on row density (e.g. min spacing) accepted as a known, documented visual degradation rather than a hard failure; same is true of the circle mode today (many families → a very dense ring) and isn't treated as a blocker there, so this isn't a new problem being introduced.
- Slightly more design/math work upfront than a hard-coded lookup table for the mockup's specific N.

**Best when**: This is the only alternative that actually satisfies the stated success criteria — it should be the default choice unless there's a strong reason to special-case the mockup's exact family count.

**Evidence links**: problem-statement.md's explicit success criterion; `pos(i)`'s existing trigonometric generalization in `KragGrupyPage.tsx` (proven pattern to extend, not replace).

---

### Alternative 4C: Randomized/shuffled slot assignment on top of 4B's generalized geometry

**Description**: Same generalized position functions as 4B, but additionally shuffle *which* family index maps to which position slot (e.g. a stable-per-load-but-not-meaningful ordering, or truly random on each mount) rather than assigning families to positions in their natural list order. This directly answers "the pitch distribution is algorithmic/random" as literally as possible — not just "no tactical meaning in the geometry" but "no meaningful mapping from family identity to specific slot" either.

**Pros**:
- Most literal interpretation of the "boisko formation is algorithmic/random" constraint — actively avoids any organizer/family inferring meaning from *which* position they always land in (e.g. always being "goalkeeper").
- Trivial to layer on top of 4B (`shuffle(families)` before calling the same position functions) — no extra geometric complexity.

**Cons**:
- If re-shuffled on every page load/mount, avatars visually "jump around" between visits for the same family, which could read as a bug rather than a feature, and makes screenshots/conversations about "who's where" unstable in a way the circle mode isn't (circle mode's order is presumably stable, e.g. join order).
- If instead stabilized (e.g. shuffled once and persisted, or seeded by group id + a fixed salt so it's stable-but-arbitrary), this adds a small but real bit of state/logic (where is the shuffle computed and persisted — client-only re-shuffle-per-session vs. something derived deterministically from `familyId` so it's stable across sessions) that 4B alone doesn't need if it simply keeps the families' existing natural order (already arbitrary/non-tactical — arrival order isn't a tactical assignment either).

**Best when**: There's a specific worry that consistent list-order-based placement (e.g. always alphabetically first family = goalkeeper slot) would itself start to feel like an assigned "role" over repeated views — a legitimate but secondary concern relative to just generalizing the geometry.

### Recommendation

**Alternative 4B**, with a note to keep family-to-slot assignment in the families list's existing natural order (deterministic, stable across views) rather than adding 4C's shuffle — a stable order is not the same as a "tactical meaning," and the constraint explicitly says the *formation/distribution* has no tactical significance, not that the assignment must be actively randomized every render. Recommend deferring 4C's shuffle as a cheap future enhancement only if user testing reveals people start reading meaning into their fixed slot. Rationale: 4B is the only alternative that satisfies the explicit "any N without overlap" success criterion, and it does so by directly extending the already-proven `pos(i)` trigonometric technique rather than inventing a new one — lowest risk, most consistent with the existing codebase pattern, and keeps the position functions pure and unit-testable in `layoutPositions.ts` (Decision Area 2's recommended extraction target).

---

## Deferred Ideas (out of scope for this task)

- **Public/unauthenticated circle view** (`PublicKragGrupyView` in `KragGrupyPage.tsx`) does not currently render family avatars at all (organizer-only center, no family orbit, per its own code comment). Whether the new pitch/table modes and udostępnia/przynosi icons should ever appear in the public view is a real future question but is explicitly out of scope here — the problem statement and personas only describe the authenticated organizer/parent views.
- **A dedicated group-settings screen** (Decision Area 3B) — if the user wants richer group configuration (renaming, other properties) consolidated in one place beyond just layout mode, that's a separate, larger feature, not something to build as a side effect of this task.
- **Shuffle/randomized slot assignment** (Decision Area 4C) — noted as a plausible future refinement, deferred unless evidence emerges that stable ordering reads as unintended "roles."
- **Extracting the family card and "kto co przynosi"/exchange sections into their own components** — valuable for the same monolith-reduction reasons as `GroupVisualization`, but not required by this task's explicit scope (which only expands the *content* of the family card, not its code location) and risks scope creep if bundled in.

## Confidence

**Medium-high.** Recommendations are grounded in direct reads of the actual `KragGrupyPage.tsx`/`useKragGrupy.ts` code, the `Group` model, and all three mockups, plus explicit constraints and success criteria from `problem-statement.md`. The main open uncertainty is Decision Area 3B's premise (whether a dedicated group-settings screen already exists) — this should be confirmed against the codebase before ruling it out, though the recommendation (3A) does not depend on that answer.
