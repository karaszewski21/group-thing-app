window.MAISTER_DATA = {
  generated: "2026-11-15T16:56:21Z",
  task: {
    title: "Szukam (wanted posts) mechanism",
    type: "development",
    status: "in_progress",
    description: "Implement the szukam (wanted) mechanism from the research task: a private seeker-owned want in a new module app/wants, matched to listed items at creation and by a periodic scan, with grouped in-app notifications, a 90-day lifecycle and the frontend list, form and match list replacing the mock.",
    path: ".maister/tasks/development/2026-11-15-szukam-wanted-mechanism",
    current_activity: "Planning implementation"
  },
  characteristics: { has_reproducible_defect: false, modifies_existing_code: true, creates_new_entities: true, involves_data_operations: true, ui_heavy: true },
  phases: [
    { id: "phase-1", name: "Analyze codebase & clarify requirements", icon_hint: "analysis", status: "completed", started: "2026-11-15T10:58:08Z", completed: "2026-11-15T11:21:37Z", skip_reason: null,
      summary: "The design is buildable as written; the report corrects 16 design statements. User accepted P1-P13, chose delete-and-insert for the bell row, the closing prompt after a take only, and EXPLAIN ANALYZE in scope with the labelled sample later.",
      decisions: [
        { decision: "Accept P1–P13", rationale: "the code analysis found no obstacle to any of them; thresholds 0.70 / 0.60 stay starting values." },
        { decision: "Delete the want's previous unread match row and insert a new one with the summed count", rationale: "an in-place update breaks the \"created_at is set once\" rule of BaseEntity and can collide with mark_read." },
        { decision: "Closing prompt after a personal or term/event take only", rationale: "a swap proposal is not an agreement and can be rejected." },
        { decision: "Measure the match statement with EXPLAIN ANALYZE in this task and decide on the item_listing_preferences.created_at index from it", rationale: "the labelled sample of Polish pairs is a separate task." },
        { decision: "Trigram branch = w.name_folded <% fold_pl(p.name) AND word_similarity(...) >= CASE ...", rationale: "the function form alone never uses ix_products_name_trgm." },
        { decision: "Scan entry point takes now as a parameter", rationale: "freeze_local_now patches only clock.local_now(); nothing freezes datetime.utcnow()." },
        { decision: "useWants follows hooks/useMyLocations.ts (token in the key)", rationale: "a want list is private and has mutations; useNeededItems has neither property." }
      ],
      risks: [
        "Q2 radius: decide whether \"Tylko tu\" is stored as null or 0.",
        "Q4 \"proposed by me\": with_pending_proposer exposes only the oldest pending proposer.",
        "Q7 small UI choices: not-found link target for /wanted/:id, own clear control for the category, \"Konto\" tab highlight on sub-routes.",
        "Unrun checks: generated stored tsquery on PostgreSQL 18; EXPLAIN (ANALYZE, BUFFERS) in both directions; the labelled Polish sample.",
        "Test baseline: project memory records 24 Vitest, 5 typecheck and 2 backend failures on HEAD b8c45e0; several files this task edits are among them."
      ],
      artifacts: [
        { path: "analysis/codebase-analysis.md", label: "Codebase analysis", html: null },
        { path: "analysis/clarifications.md", label: "Clarifications", html: null }
      ],
      gate: null, progress: null },
    { id: "phase-2", name: "Analyze gaps & clarify scope", icon_hint: "analysis", status: "completed", started: "2026-11-15T11:21:37Z", completed: "2026-11-15T13:15:19Z", skip_reason: null,
      summary: "The whole capability is missing today and the design plus corrections X1-X16 is a buildable target. One critical decision (the per-want notification switch has no screen) and 14 important ones, each with a default; no scope expansion recommended.",
      decisions: [
        { decision: "Notification switch as a toggle on /wanted/:id, saved at once with PATCH", rationale: "a want is muted where its alerts are seen; a switch-only PATCH does not re-run matching." },
        { decision: "\"Tylko tu\" is stored as null; the CHECK allows 1–100 and the API turns 0 into null", rationale: "one representation, as search sends it." },
        { decision: "Match cards carry reserved_by_me and proposed_by_me, the second from an own EXISTS in the same statement", rationale: "with_pending_proposer exposes only the oldest proposer." },
        { decision: "Counters count only pairs that pass the same read-time filter as the match list", rationale: "a badge must agree with the list it opens." },
        { decision: "The want's unread match row is deleted on withdraw and on an edit that resets matches; a withdrawn want is a 404", rationale: "removes the two plainly wrong cases with the delete the writer already needs." },
        { decision: "\"Dodaj\" link on /wanted and \"Edytuj\" on /wanted/:id; no inline quick add", rationale: "one form (ADR-013)." },
        { decision: "One closing prompt naming every active want matched by the taken item; sheet only on the item page", rationale: "a closed want can be reopened for 30 days; no dismissal state to keep." },
        { decision: "The \"Konto\" tab is highlighted on every deeper account sub-page, by prefix", rationale: "the user chose consistency over the narrower change." },
        { decision: "Test baseline first; no new failures", rationale: "old failures are fixed only where this task rewrites the failing test." },
        { decision: "No feature switch; do not deploy until the labelled sample is scored", rationale: "the gate is written in architecture.md." }
      ],
      risks: [
        "resolved: Per-want notification switch has no UI in the design (orphaned UPDATE) — toggle on /wanted/:id",
        "The \"Konto\" prefix match changes pages outside this task (/places/new, /places/:id/edit, …); their tests need a look.",
        "A feature that must not be deployed before a follow-up task relies on a written rule, not on code.",
        "A deleted category sets wants.category_id to null and silently moves the want to the strict threshold.",
        "wants.seeker_party_id has no ON DELETE rule; a future account-deletion feature must handle wants."
      ],
      artifacts: [{ path: "analysis/gap-analysis.md", label: "Gap analysis", html: null }, { path: "analysis/scope-clarifications.md", label: "Scope clarifications", html: null }],
      gate: { question: "Continue to Phase 4: UI Mockup Generation?", answer: "Yes, generate UI mockups" }, progress: null },
    { id: "phase-3", name: "Write failing test (TDD Red)", icon_hint: "code", status: "skipped", started: null, completed: null, skip_reason: "No reproducible defect (new feature)", summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-4", name: "Generate UI mockups", icon_hint: "spec", status: "completed", started: "2026-11-15T13:15:19Z", completed: "2026-11-15T14:14:11Z", skip_reason: null,
      summary: "Eight HTML mockups bound to the real Tailwind tokens and shared components; approved by the user, binding for the specification.",
      decisions: [], risks: [],
      artifacts: [
        { path: "analysis/design-context/INDEX.md", label: "Design index", html: null },
        { path: "analysis/design-context/design-resources.md", label: "Design resources", html: null },
        { path: "analysis/design-context/mockups/wanted-list.html", label: "Mockup: want list", html: "analysis/design-context/mockups/wanted-list.html" },
        { path: "analysis/design-context/mockups/wanted-form.html", label: "Mockup: want form", html: "analysis/design-context/mockups/wanted-form.html" },
        { path: "analysis/design-context/mockups/wanted-form-errors.html", label: "Mockup: form errors", html: "analysis/design-context/mockups/wanted-form-errors.html" },
        { path: "analysis/design-context/mockups/wanted-matches.html", label: "Mockup: match list", html: "analysis/design-context/mockups/wanted-matches.html" },
        { path: "analysis/design-context/mockups/wanted-matches-states.html", label: "Mockup: match list states", html: "analysis/design-context/mockups/wanted-matches-states.html" },
        { path: "analysis/design-context/mockups/close-want-sheet.html", label: "Mockup: close-want sheet", html: "analysis/design-context/mockups/close-want-sheet.html" },
        { path: "analysis/design-context/mockups/entry-points.html", label: "Mockup: entry points", html: "analysis/design-context/mockups/entry-points.html" },
        { path: "analysis/design-context/mockups/bell-rows.html", label: "Mockup: bell rows", html: "analysis/design-context/mockups/bell-rows.html" }
      ],
      gate: { question: "UI mockups complete. Continue to Phase 5?", answer: "Approved, go to Phase 5" }, progress: null },
    { id: "phase-5", name: "Gather requirements & create specification", icon_hint: "spec", status: "completed", started: "2026-11-15T14:14:11Z", completed: "2026-11-15T16:22:45Z", skip_reason: null,
      summary: "Spec written: 11 core and 144 detailed requirements, 37 acceptance criteria, 11 design ids mapped; corrections X1-X16 applied; six open questions carry stated defaults.",
      decisions: [
        { decision: "Trigram branch = name_folded <% fold_pl(p.name) AND word_similarity(...) >= CASE", rationale: "the operator is the only form that uses ix_products_name_trgm (X1)." },
        { decision: "Bell row = delete the unread row, insert a new one with the summed count, in one batch writer", rationale: "an in-place update breaks \"created_at set once\" and races mark_read (X2, Phase 1 answer 2)." },
        { decision: "Scan entry point takes now; the scheduler wrapper catches StaleDataError itself", rationale: "nothing freezes datetime.utcnow(), and jobs have no HTTP handler (X3)." },
        { decision: "A foreign or withdrawn want is 404 through an own Polish WantNotFound", rationale: "the want is always selected by (id, seeker_party_id) (X9, I4)." },
        { decision: "No feature switch; the release gate is a written rule in architecture.md (I13)", rationale: "merge is allowed, deployment is not, until the labelled Polish sample is scored." }
      ],
      risks: [
        "OQ1: Statement timeout on the scan job — default: none.",
        "resolved: OQ2 contact-details message — the existing constant, verbatim (user)",
        "resolved: OQ3 match-card intent pill — ItemCard labels unchanged (user)",
        "resolved: OQ4 empty-search state — only the prompt block changes (user)",
        "OQ5: UI details no mockup shows — defaults listed in the spec's Frontend section.",
        "OQ6: API details the design left open — defaults listed in the spec.",
        "Thresholds 0.70 / 0.60 are starting values, unmeasured at the end of this task (release gate)."
      ],
      artifacts: [
        { path: "implementation/spec.md", label: "Specification", html: "implementation/spec.html" },
        { path: "analysis/requirements.md", label: "Requirements", html: null }
      ],
      gate: { question: "Continue to specification audit?", answer: "Yes, run the audit; OQ2-OQ4 confirmed at their defaults" }, progress: null },
    { id: "phase-6", name: "Audit specification", icon_hint: "verify", status: "completed", started: "2026-11-15T16:22:45Z", completed: "2026-11-15T16:44:42Z", skip_reason: null,
      summary: "Verdict pass-with-concerns: 0 Critical, 3 High, 12 Medium, 17 Low. All 32 findings applied to the spec (now 151 requirements, 50 acceptance criteria).",
      decisions: [
        { decision: "Compute short_words_query in SQL from to_tsvector('simple', fold_pl(name)), not in Python (H1)", rationale: "a Python split cannot reproduce the PostgreSQL parser." },
        { decision: "State that every set-based scan/sweep UPDATE on wants also sets updated_at, or drop the 409 claim and re-read the pointer in SQL inside PATCH (H2)", rationale: "a Core UPDATE does not run the version generator." },
        { decision: "State include_defaults=False plus explicit gen_random_uuid(), created_at, updated_at for the INSERT ... SELECT into want_matches (H3)", rationale: "from_select evaluates the Python uuid default once for the whole statement." },
        { decision: "Say whether already-stored pairs are excluded before or after the top-20 ranking (M1)", rationale: "resume and the overlap behave differently in each reading." },
        { decision: "Give the notifications module an explicit delete-only path for FR-N-06 (M2)", rationale: "the writer always inserts a row per entry." }
      ],
      risks: [
        "Short words and Polish prepositions: 'dla', 'na', 'do' become mandatory exact tokens; \"kask rowerowy dla dziecka\" would not match \"Kask rowerowy dziecięcy\". The labelled sample should include such names.",
        "Reverse-scan cost: 500 listings × 10,000 wants = 5 million pairs, each folding the product name; the auditor's estimate is that the 2 s budget fails there.",
        "Unverified: whether a Computed TSQUERY column survives an ORM insert through asyncpg (L13).",
        "Stale pairs after a concurrent edit: a scan statement started before a PATCH commits can store pairs for the old name; the window is one statement long."
      ],
      artifacts: [{ path: "verification/spec-audit.md", label: "Specification audit", html: null }],
      gate: { question: "Continue to implementation planning?", answer: "Apply all audit fixes, then plan; list card shows the node name, match page the full path; form has only the locality field and radius chips" }, progress: null },
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "in_progress", started: "2026-11-15T16:44:42Z", completed: null, skip_reason: null,
      summary: "19 task groups, 139 steps, about 120-150 tests; baseline first, no commits; visual coverage 11 of 11 ids.",
      decisions: [
        { decision: "Measurement (group 7) runs right after the matcher and before the scan job", rationale: "the fold-once-per-listing lever changes matcher.py, which the scan calls." },
        { decision: "Groups 13-15 build and test the views only; group 16 alone switches routes, wires the entry points and deletes the mock", rationale: "shared test files have one editor and the three views can be built side by side." }
      ],
      risks: [
        "Generated tsquery column (O1): checked in step 4.2; fallback is an application-written name_query.",
        "Reverse-scan budget: 500 listings x 10,000 wants is expected to miss 2 s; levers in steps 7.3-7.4; a longer interval or the outbox fallback is left for the user.",
        "Unstable frontend baseline: AppPage, ItemDetailPage and routeManifest are among the files this task edits.",
        "Docker load: backend groups in the same wave each start their own testcontainers PostgreSQL."
      ],
      artifacts: [
        { path: "implementation/implementation-plan.md", label: "Implementation plan", html: "implementation/implementation-plan.html" },
        { path: "implementation/visual-coverage.md", label: "Visual coverage", html: null }
      ],
      gate: null, progress: null },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-9", name: "Verify test passes (TDD Green)", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null }
  ],
  verification: { status: null, issues: [], fixes: [], reverify_count: 0 }
};
