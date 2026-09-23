# Synthesis: Business Model Fit — Recurring Groups from Ad-Hoc Sessions

## Research Question

Does the current group-thing-app data model and UX cover four target use cases —
(1) ad-hoc music-class sessions that an organizer later promotes into a standing,
ongoing, repeatable group; (2) family gatherings with fixed members; (3) a
teacher's fixed-member class; (4) a football coach's team (players + parents,
fixed members) — and what gaps exist / what new approach should be taken
(PoC stage, free to redesign)?

---

## Executive Summary

The codebase cleanly separates two membership concepts at the data-model
level: `TermAttendance` (ad-hoc, per-session RSVP, no link to `Group`/
`Membership`) and `Membership` (standing, circle-wide, per-individual,
`GroupRole`-based). This separation is deliberate and documented in the
model source itself (`models.py:240-248`, referencing "scope-clarifications.md
Decision #1"). Use cases 2-4 — family gatherings, a teacher's class, a
coach's team — are all "fixed, known members" scenarios and map directly
onto the existing `Membership` + `join_private_group` mechanism for a
`PRIVATE` group. This part of the model is **already a good fit**, evidenced
by a full, passing test suite (`test_group_privacy.py`) covering anonymous
join, organizer-only actions, and standing-roster listing.

Use case 1 (ad-hoc sessions promoted into a standing, ongoing, addable
group) is the one use case the brief specifically flags as uncertain, and
the research confirms why: a mechanism named `formalize_group_from_term`
already exists end-to-end (backend service, HTTP endpoint, frontend API
client, and a Panel UI component), and it does exactly what its name says —
it turns a `PUBLIC` group's term-attendee list into `Membership` rows. But
it does not implement the actual business requirement in use case 1, which
has three parts: (a) create standing members from ad-hoc attendees — **this
part is solved**; (b) do it as an ongoing, repeatable operation across many
future sessions — **not solved, this is one-shot only**; (c) let the
organizer later add more people to that same standing group — **not
directly blocked, but not what this flow is built for, and the flow's
side effect (flipping the group to PRIVATE) actively removes the "anyone
signs up per session" capability the organizer may still want to keep
running in parallel for new prospects.**

In short: use case 1 is **partially solved at the mechanics level, but not
solved at the business-model level.** The gap is not "no code exists to
create a Membership from an attendee" — that code exists and is tested. The
gap is that the existing mechanism is bundled with an irreversible
visibility flip and is exposed only to internal admins via `/panel`, not to
the organizer from their own group page, and has no concept of doing this
more than once or of an ongoing ad-hoc funnel feeding a standing roster over
time.

A secondary, documentation-debt finding: `.maister/docs/project/architecture.md`
and `tech-stack.md` describe a stale, unrelated "aj" plugin/microkernel
platform domain (category/product/plugin/footprint verticals) that has
nothing to do with the actual groups/circles/families domain implemented in
`app/groups`, `app/families`, etc. This doesn't affect the business-fit
conclusions above, but it should be flagged and likely fixed via
`/maister:standards-update` or a docs refresh, since anyone reading INDEX.md
today would build an incorrect mental model of the app.

---

## Cross-Source Analysis

### Validated findings (confirmed by multiple sources / high confidence)

1. **Two structurally distinct membership concepts exist.** `Membership`
   (standing, `models.py:149-170`) vs `TermAttendance` (ad-hoc per-term,
   `models.py:239-264`). Confirmed independently by:
   - Backend model docstrings (explicit design-decision citation).
   - Backend flow trace (`public_view.py` `create_rsvp` vs `join_private_group`)
     showing each writes to only one of the two tables, never both.
   - Frontend `useKragGrupy.ts` maintaining `families` (from `Membership`)
     and `attendances` (from `TermAttendance`) as two independent,
     never-merged state slices.
   - Confidence: **High**.

2. **`formalize_group_from_term` exists, is wired end-to-end, and is tested.**
   Backend: `application/memberships.py:125-163`, router endpoint
   `POST /api/groups/{group_id}/terms/{term_id}/formalize`
   (`router/circles.py:184-205`), asserted by
   `test_formalizeGroupFromTerm_organizer_createsMembershipAndSetsPrivate`
   (`test_group_privacy.py:116-138`). Frontend: `api/groups.ts:308-321`
   (`getTermAttendeesForFormalization` + `formalizeGroupFromTerm`), UI in
   `components/panel/EditTermDialog.tsx:139-182,427-486`, reached from
   `pages/panel/views/SpotkaniaView.tsx`'s `organizerTermCard`. Confirmed by
   two independent gatherers (backend + frontend) reading different halves
   of the same feature and reaching the same conclusion.
   Confidence: **High**.

3. **The mechanism is one-shot, not repeatable, and bundled with a
   visibility flip.** Backend: `memberships.py:139-140` requires
   `group.visibility == PUBLIC` to run at all, then flips it to `PRIVATE`
   at `memberships.py:160`; the `GroupVisibility` docstring
   (`models.py:78-81`) explicitly calls the `PUBLIC -> PRIVATE` transition
   "irreversible in that direction from this flow." Frontend:
   `EditTermDialog.tsx:427` gates the entire "Formalizuj stałych członków"
   UI block on `group.visibility === "PUBLIC"`, and its own copy
   (line 443-445) warns the organizer that RSVP on new terms becomes
   members-only after this action. Once `PRIVATE`, `create_rsvp`
   (`public_view.py:310-321`) rejects anonymous/non-member RSVPs outright,
   which structurally forecloses any further ad-hoc-attendee accumulation
   for that same group. Confidence: **High**.

4. **The action is not reachable from the organizer's own group page.**
   Exhaustive grep of `KragGrupyPage.tsx` (the page at
   `/:organizationSlug/grupa/:groupId/term/:termId`, the sole public/private
   group screen per `router.tsx:111-124`) found no `formaliz`/`Formaliz`
   symbol at all. The only UI entry point is the internal `/panel` route's
   `EditTermDialog`, reached via `SpotkaniaView.tsx`. Confidence: **High**
   (based on grep across the full file plus router confirmation).

5. **Use cases 2-4 map cleanly onto existing `PRIVATE`-group +
   `Membership` + `join_private_group` mechanics.** `join_private_group`
   (`public_view.py:384-467`) creates a `Membership` directly for any
   member of a family joining via a group's join-link, entirely decoupled
   from any Term — this is exactly the shape family/teacher/coach groups
   need (a durable, addable-to roster with no per-session dependency).
   Asserted by `test_joinPrivateGroup_anonymous_createsStandingMembership`
   (`test_group_privacy.py:167-190`). Confidence: **High**.

### Contradictions and resolutions

- **Apparent contradiction**: the research brief frames use case 1 as
  possibly unsolved ("organizer needs a path... to promote"), while the
  gatherers found a fully-built, tested `formalize_group_from_term`
  feature. **Resolution**: both are true simultaneously — the *mechanics*
  (attendee -> Membership conversion) exist and work, but the *business
  requirement* (ongoing, repeatable, non-destructive, organizer-self-service)
  is not met by this mechanism as built. This is not a contradiction in the
  evidence, but a mismatch between what the feature was built for
  (a one-time "formalize this specific term's list, and lock the group down
  from now on" moderation-style action) and what use case 1 actually needs
  (a standing group that keeps absorbing new ad-hoc signups over time).

- **Stale docs vs. actual test infrastructure**: `architecture.md`/
  `tech-stack.md` both claim no automated pytest suite exists, but git
  status and the backend gatherer both confirm multiple test files exist
  and pass assertions (`test_group_privacy.py`, `test_circles_router.py`,
  etc.). Resolution: these two docs are simply out of date/wrong domain,
  not a live description of the current codebase. Treat as documentation
  debt, not evidence about test coverage.

### Confidence assessment

| Area | Confidence | Basis |
|---|---|---|
| Membership vs. TermAttendance separation | High | Direct model + flow + frontend reads, 3 independent angles |
| `formalize_group_from_term` exists, tested, one-shot | High | Backend code + test + frontend API + frontend UI, cross-confirmed |
| Not reachable from organizer's own page | High | Full-file grep + router confirmation |
| Use cases 2-4 fully covered | High | Direct code + passing test evidence |
| Docs staleness ("aj" platform) | High | Direct text comparison, unambiguous |
| Exact test assertions in `test_public_term.py`, `test_circles_router.py`, `PanelPage.test.tsx` formalize section | Low-Medium | Not read in full — see Gaps section |

---

## Per-Use-Case Support Matrix

| # | Use case | Support level | Evidence | Notes |
|---|---|---|---|---|
| 1 | Ad-hoc music classes → promote to standing, ongoing, addable group | **Partial** | `application/memberships.py:125-163`, `router/circles.py:184-205`, `api/groups.ts:308-321`, `EditTermDialog.tsx:139-182,427-486`, `test_group_privacy.py:116-138` | The *promote attendees → Membership* mechanic is Full; the *ongoing/repeatable + still-open-to-new-ad-hoc-signups + organizer-self-service* requirement is **not met**. See detailed breakdown below. |
| 2 | Family gatherings (fixed, known members) | **Full** | `public_view.py:384-467` (`join_private_group`), `models.py:149-170` (`Membership`), `test_group_privacy.py:167-190` | Standard `PRIVATE` group + join-link + `Membership` covers this directly; no ad-hoc/term dependency needed at all. |
| 3 | Teacher's class (fixed members = students) | **Full** | Same mechanism as #2 — `Membership` is per-individual, `GroupRole(MEMBER)`, works for any fixed roster regardless of domain (family, class, team). | No teacher-specific modeling gap found; `Term` already models individual class sessions (`models.py:173-186`) if attendance-per-session tracking is also wanted alongside the fixed roster. |
| 4 | Football coach's team (fixed: players + parents) | **Full**, with a minor **fit caveat** | Same `Membership` mechanism as #2/#3. | The "family" framing baked into the frontend (`KragFamily`, `useKragGrupy.ts:46-58`) and the formalize flow's requirement of a "resolvable Family" (`memberships.py:147-149`) assumes members cluster into family units (guardian+children). A coach's roster of "player + parent" pairs fits this shape reasonably well (parent as guardian, player as child), but a team with unrelated adult players (no family unit) would not fit the `Family`-centric UI grouping as naturally — worth flagging as a modeling assumption baked deep into the UI layer, not just a promotion-flow gap. |

### Use case 1 — detailed breakdown of "already solved" vs. "gap"

**Already solved (mechanics level):**
- An organizer can select a subset of a specific term's ad-hoc attendees and
  turn them into standing `Membership` rows in one transaction
  (`memberships.py:125-163`).
- This is authorization-gated to the active organizer only
  (`_require_active_organizer`, `memberships.py:137`), tested
  (`test_formalizeGroupFromTerm_nonOrganizer_returns403`).
- The resulting roster is then a normal `PRIVATE`-group `Membership` list,
  addable-to going forward via the group's own join-link
  (`join_private_group`) — so *after* the one-time conversion, more people
  genuinely can be added later. This part of use case 1's "ability to add
  more people later" requirement is **actually met**, just not via more
  ad-hoc sessions — via the standing group's own join-link.

**Not solved (business-model level):**
- **Not ongoing/repeatable across sessions.** There is no notion of a
  recurring `Term` series in the model (`Term` rows are independent,
  `models.py:173-186`); nothing lets an organizer run session after session
  and periodically top up the standing group with newly-appeared regulars.
  The mechanism is scoped to exactly one term's attendee snapshot.
- **Destroys the ad-hoc funnel it was fed by.** Flipping `visibility` to
  `PRIVATE` makes `create_rsvp` reject new anonymous signups
  (`public_view.py:310-321`), so the organizer cannot keep running "anyone
  signs up per single session" alongside a growing standing roster — the
  two are mutually exclusive under the current model, even though use case
  1 explicitly wants both to coexist (new ad-hoc sessions continuing to run
  while a standing group also exists and grows).
- **Not organizer-self-service.** Only reachable via the internal `/panel`
  route's `EditTermDialog`, not from the organizer's own group page
  (`KragGrupyPage.tsx`, confirmed empty of any formalize UI). If `/panel`
  is an admin-only or internal tool (per project context, this needs
  confirming with the user, but the code shows no gating difference beyond
  normal organizer authorization), this may just be a UI-completeness gap
  rather than a deliberate restriction — but as shipped today, a regular
  organizer using only their own group page cannot do this.
- **Requires a resolvable Family.** Attendees without a `Family` record are
  silently unselectable (`memberships.py:147-149`, `EditTermDialog.tsx:456`
  disables the checkbox). For a music-class scenario where sign-ups might be
  individual adults with no family concept at all, this could silently
  exclude legitimate attendees from promotion — worth checking against
  real usage patterns.

**Conclusion for use case 1**: this is **not** "already solved," despite a
same-named, well-tested mechanism existing. It solves the narrower problem
"convert a completed session's list into permanent private membership,
lock down further public access" (a moderation/graduation action), not the
broader business requirement "let an ongoing ad-hoc funnel and a standing,
growing group coexist and be topped up over time by the organizer, from
their own page."

---

## Patterns and Themes

### Pattern: Deliberate two-table membership split
- **Description**: `Membership` (standing) and `TermAttendance` (ad-hoc)
  are separate tables with no FK between them, joined only by shared
  `party_id`/`Group` context and only at read time (frontend
  `resolveFamiliesForMemberships`, `useKragGrupy.ts:155-173).
- **Evidence**: `models.py:240-248` explicit docstring citing a design
  decision doc ("scope-clarifications.md Decision #1").
- **Prevalence**: Core to the whole groups bounded context — every flow
  (public RSVP, join, formalize, panel views) respects this split.
- **Quality assessment**: Well-documented, intentional, consistently
  applied. This is a mature pattern, not ad-hoc.

### Pattern: One-way visibility state machine (PUBLIC → PRIVATE)
- **Description**: `GroupVisibility` models group access as a two-state
  enum with one primary irreversible transition (`formalize_group_from_term`)
  and one manual escape hatch (`PATCH /groups/{id}` can flip back,
  per `models.py:78-81`).
- **Evidence**: `memberships.py:139-140,160`; `EditTermDialog.tsx:427`
  gate; `public_view.py:310-321` post-flip RSVP rejection.
- **Prevalence**: Single mechanism, but it's the *only* bridge between the
  two membership concepts in the entire codebase (confirmed by grep finding
  no "promote"/"convert"/"recurring" terminology anywhere else).
- **Quality assessment**: Clean and well-tested for what it does, but its
  scope (a full visibility state change) is a much bigger and more
  consequential action than the underlying user need (add these people to
  my standing roster) requires — a sign of the feature being modeled as a
  moderation/admin action rather than a routine organizer workflow.

### Pattern: Family as the UI-level participant unit
- **Description**: Both the read model (`KragFamily` in `useKragGrupy.ts`)
  and the formalize eligibility rule (`memberships.py:147-149`) treat
  "Family" as the natural clustering unit for a group's participants, even
  though the underlying `Membership` row is per-individual.
- **Evidence**: `useKragGrupy.ts:46-58,151-173`; `EditTermDialog.tsx:456,463-464`.
  Also product-design docs (`product-brief.md:50`) reference
  family-scoped exchange-offer endpoints.
- **Prevalence**: Present across group visualization, exchange/pledge
  features, and the formalize flow — a consistent theme, not a one-off.
- **Quality assessment**: Works well for family/school-parent-style
  contexts (use cases 1-3), and reasonably for use case 4 (player+parent as
  a family-like unit), but is a real modeling assumption that a purely
  adult-only or family-less roster (e.g., adult hobbyist class, or a
  coach's team with unrelated adult players) would strain against.

---

## Key Insights

1. **The gap is UX/workflow-shaped, not primarily data-model-shaped.**
   The `Membership` vs `TermAttendance` split already gives the right
   underlying primitives for use case 1; nothing about the *data model*
   forces the one-shot/visibility-coupled behavior — that's a choice made
   in the `formalize_group_from_term` *application logic and UI*, not a
   structural limitation of the tables themselves. This significantly
   changes the shape of the fix: it likely doesn't need new tables, it
   needs a new/adjusted application-layer operation and its own UI surface.
   Confidence: **High**, based on model-layer inspection (no FK/constraint
   ties formalize to visibility) vs. application-layer inspection (the
   coupling is explicit application code, not a DB constraint).

2. **Use cases 2-4 are not "future work" — they are effectively done.**
   The research should not spend further design effort making family/
   teacher/coach fixed-roster groups work; the existing `PRIVATE` +
   `join_private_group` + `Membership` path already serves them, evidenced
   by a passing test suite. Confidence: **High**.

3. **The "resolvable Family" requirement is a hidden constraint that may
   not generalize to use case 1's actual population** (adult music-class
   attendees, possibly no family concept at all). This is worth explicit
   validation with the user/product owner before assuming the existing
   formalize eligibility rule is even the right filter for use case 1.
   Confidence: **Medium** — the constraint is clearly present in code, but
   whether it is a real-world problem depends on assumptions about who
   signs up for music classes (parents-with-children vs. solo adults),
   which the codebase alone cannot answer.

4. **`/panel` being the only entry point may be either a deliberate admin
   boundary or simply an oversight/incompleteness** — the code shows no
   difference in *authorization* between what `/panel`'s organizer view and
   `KragGrupyPage`'s organizer view are allowed to do; it's purely a matter
   of which UI happens to expose which action. This suggests it's a low-
   effort fix in principle (expose the same capability on the organizer's
   own group page) rather than a deep architectural blocker — but the
   product intent behind having a separate `/panel` at all needs to be
   understood before assuming it should be duplicated there. Confidence:
   **Medium**.

---

## Relationships and Dependencies

- `Group.visibility` (PUBLIC/PRIVATE) gates both `create_rsvp` (ad-hoc) and
  `formalize_group_from_term` (promotion) — it is the single pivot point
  around which use case 1's conflict (ongoing ad-hoc vs. standing roster)
  turns.
- `TermAttendance` → `formalize_group_from_term` → `Membership`: a
  one-directional, one-time data flow; no relationship or FK links a
  `Membership` back to the `TermAttendance`/`Term` it may have originated
  from, so there is no audit trail of "this member joined via formalization
  from term X" once created — same shape as an anonymous `join_private_group`
  member.
- `Family` sits underneath both the display layer (`KragFamily`) and the
  formalize eligibility filter — a dependency that touches use cases 1 and
  4 differently (natural fit for 4, uncertain fit for 1).
- `EditTermDialog.tsx` (Panel) and `KragGrupyPage.tsx` (organizer's own
  page) are structurally independent UI surfaces that both read/write
  overlapping backend state (`Group`, `Term`, `Membership`) but do not
  share the formalize capability — a UI/routing gap, not a data
  dependency issue.

---

## Gaps and Uncertainties

1. **`test_public_term.py` and `test_circles_router.py` were not read in
   full** by the backend gatherer (only grepped for keywords). It's
   possible these contain additional assertions about public-term-page
   behavior or router-level authorization edge cases relevant to use case
   1 (e.g., whether a PUBLIC group's public page changes behavior at all
   pre/post formalization) that were missed. **Open question** — recommend
   a follow-up full read if the brainstorming phase needs finer edge-case
   detail on the public view's behavior around the PUBLIC/PRIVATE boundary.

2. **`PanelPage.test.tsx`'s formalize-success-path assertions were not
   fully captured** — the frontend gatherer confirmed the test file mocks
   `getTermAttendeesForFormalization`/`formalizeGroupFromTerm` and is aware
   of the feature, but did not verify the exact assertions made on a
   successful formalize call (e.g., does the UI verify the group's
   visibility badge updates, does it verify the term list changes, etc.).
   **Open question** — a follow-up full read of this file would firm up
   confidence on exactly what UI behavior is guaranteed vs. merely
   plausible.

3. **Whether `/panel` is meant to be an internal/admin-only surface or
   merely an organizer console that happens to not yet have parity with
   `KragGrupyPage.tsx`** is not resolvable from the code alone — this is a
   product-intent question for the user, not a code-evidence question.

4. **Whether real-world use case 1 attendees have a `Family` concept at
   all** (parents signing up children vs. solo adults) is a business
   assumption, not something the codebase can confirm or deny.

---

## Synthesis by Framework (Mixed: Technical + Requirements)

### Component Analysis
- What exists: `Group`, `GroupRole`, `Membership`, `Leadership`, `Term`,
  `TermAttendance` (backend); `KragFamily`, attendance/membership dual
  hooks, `EditTermDialog` formalize UI (frontend).
- How it's structured: DDD-lite layered backend (`application/*` behind
  `service.py` facade); frontend splits public/private/panel concerns
  across route (`KragGrupyPage`) and internal tool (`/panel`).
- How it works: two independent write paths (`create_rsvp` vs
  `join_private_group`), one narrow bridge (`formalize_group_from_term`).
- How it integrates: visibility flag is the sole coupling point between
  the ad-hoc and standing worlds.

### Need Analysis (per use case, see matrix above)
- Use case 1's stated need ("ongoing, repeatable, add more people later")
  is more specific than what `formalize_group_from_term` was built to
  satisfy ("one-time graduation of a public group to private").
- Use cases 2-4's need ("fixed, known members") is already fully satisfied
  by `PRIVATE` + `Membership`.

### Gap Analysis
- **Primary gap**: no ongoing/repeatable "add these newly-appeared regulars
  to my standing roster, without shutting off ad-hoc signup for new
  prospects" operation exists.
- **Secondary gap**: no organizer-facing (non-panel) UI entry point for
  even the existing one-shot mechanism.
- **Tertiary/assumption gap**: Family-centric eligibility filter may not
  fit use case 1's population.

### Constraint Analysis
- Technical: PoC stage, free to redesign (per brief) — no backward-
  compatibility constraint on any new model.
- Standards: any new entity/field must follow `BaseEntity`, `StrEnum`,
  `lazy="raise"`, FK-id cross-module references
  (`.maister/docs/standards/backend/models.md`).
- No existing soft-delete/reversible-state convention in the codebase —
  relevant if any redesign wants a reversible "un-promote" action.

---

## Conclusions

### Primary conclusions
1. Use cases 2-4 (family, teacher, coach) are **already well-supported**
   by the current `PRIVATE`-group + `Membership` + join-link mechanism.
   No redesign is needed for these. (Confidence: High)
2. Use case 1 is **partially supported at the mechanical level** (an
   attendee → standing-member conversion path exists and is tested) but
   **not supported at the business-model level** — it cannot run
   repeatedly, it forecloses continued ad-hoc signup once triggered, and
   it is not reachable from the organizer's own page. (Confidence: High)
3. The gap is primarily one of **application-layer workflow design and UI
   placement**, not underlying data-model structure — the `Membership`/
   `TermAttendance` split already provides suitable primitives.
   (Confidence: High)

### Secondary conclusions
- The Family-centric eligibility/display model is a hidden assumption
  that may need validation for use case 1's actual user population.
  (Confidence: Medium)
- Project documentation (`architecture.md`, `tech-stack.md`) is stale and
  describes an unrelated domain — a documentation-debt issue independent
  of this research question, worth raising via `/maister:standards-update`
  or a dedicated docs-refresh task. (Confidence: High)

### Recommendation
Treat use case 1 as the sole open design problem for this research
thread. Do not attempt to "fix" `formalize_group_from_term` in place for
use cases 2-4 — they don't need it. Feed the alternative approaches below
into a brainstorming/design phase focused narrowly on: (a) decoupling
"add standing members" from the visibility flip, (b) making it a
repeatable, organizer-self-service action, (c) deciding whether ad-hoc
signup and a standing roster should be able to coexist on the same group
going forward.

---

## Alternative Approaches for Closing the Use-Case-1 Gap

### Approach A — Decouple "add to standing roster" from the visibility flip
Keep `Membership`/`TermAttendance` as-is. Introduce a new, narrower
application-layer operation (e.g. `add_term_attendees_as_members(group_id,
term_id, party_ids)`) that only creates `Membership` rows — no visibility
change. `formalize_group_from_term` becomes a thin composition of this new
primitive plus an *explicit, separate* "make this group private now"
action (which may already substantially exist via `PATCH /groups/{id}`
with `visibility`). Expose the new primitive on `KragGrupyPage.tsx`'s
organizer view directly, callable per term, repeatedly, over time.
- **Trade-offs**: Minimal data-model change (no migration needed); reuses
  existing `Membership`/`TermAttendance` tables and standards-compliant
  patterns. Risk: `create_rsvp`'s current PRIVATE-group gate
  (`public_view.py:310-321`) still forecloses new ad-hoc signups once/if
  the group is ever made private — so this approach only fully satisfies
  use case 1 if the group is deliberately *kept* `PUBLIC` while
  periodically topping up its `Membership` roster (which the current model
  actually already permits, since nothing stops a `PUBLIC` group from also
  having `Membership` rows — this was previously an implicit assumption of
  "formalize == go private" that isn't structurally required).

### Approach B — Make ad-hoc signup and standing membership fully independent, always-coexisting
Stop treating `PUBLIC`/`PRIVATE` as the toggle that also controls whether
standing membership exists at all. Redefine: `PUBLIC` = "anyone may still
RSVP per-term" (independent of whether the group has any `Membership`
rows), `PRIVATE` = "only members/organizer may RSVP." An organizer of a
`PUBLIC` group could add standing members at any time without changing
visibility, and could later flip to `PRIVATE` once they no longer want new
ad-hoc prospects. This requires re-examining `create_rsvp`'s access check
(`public_view.py:310-321`) to confirm it doesn't need further change (it
already only branches on `visibility`, not on "has members" — so this
approach is close to Approach A but reframes the mental model rather than
adding a new operation), and possibly renaming/reframing
`formalize_group_from_term` in docs/UI to avoid implying visibility is
required.
- **Trade-offs**: Very close to Approach A in implementation; the real
  change here is conceptual/naming, reducing the risk that "formalize"'s
  current framing (a "PUBLIC → PRIVATE... a group's transition point")
  keeps being interpreted as necessary. Low migration risk. Requires
  careful review of any other code that currently assumes "PUBLIC group
  has no members" (none found by the gatherers, but this should be
  double-checked given the PoC's freedom to redesign).

### Approach C — Add a lightweight "recurring series" concept linking Terms
Introduce a new entity (e.g. `TermSeries` or a nullable `series_id` FK on
`Term`) so that "this group runs weekly sessions" is a first-class concept,
and let the "add standing members" action operate at the series level
(across all past/future terms in the series) rather than per single term.
This would also enable future features like recurring scheduling, not just
the promotion gap.
- **Trade-offs**: Bigger change — a new entity/migration, following
  `BaseEntity`/`StrEnum` conventions per `models.md`. More explicitly
  models the "ongoing" nature of use case 1's business reality (a music
  teacher's classes really are a series), which Approaches A/B don't
  capture (they solve the membership-promotion gap but leave "recurring
  session series" itself unmodeled). Higher implementation cost/risk for
  a PoC; likely overkill unless recurring scheduling is independently on
  the roadmap.

**Recommendation for next phase**: start brainstorming from Approach A/B
(they are nearly the same fix, differing mainly in framing/naming) as the
minimal, low-risk change that directly closes the identified gap; treat
Approach C as a larger, separate consideration only if recurring
scheduling itself (not just membership promotion) becomes an explicit
requirement.
