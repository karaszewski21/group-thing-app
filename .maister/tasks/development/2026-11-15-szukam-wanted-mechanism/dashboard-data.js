window.MAISTER_DATA = {
  generated: "2026-11-16T17:31:07Z",
  task: {
    title: "Szukam (wanted posts) mechanism",
    type: "development",
    status: "completed",
    description: "Implement the szukam (wanted) mechanism from the research task: a private seeker-owned want in a new module app/wants, matched to listed items at creation and by a periodic scan, with grouped in-app notifications, a 90-day lifecycle and the frontend list, form and match list replacing the mock.",
    path: ".maister/tasks/development/2026-11-15-szukam-wanted-mechanism",
    current_activity: null
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
    { id: "phase-7", name: "Plan implementation", icon_hint: "plan", status: "completed", started: "2026-11-15T16:44:42Z", completed: "2026-11-15T16:59:20Z", skip_reason: null,
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
      gate: { question: "Continue to implementation?", answer: "Yes, parallel waves" }, progress: null },
    { id: "phase-8", name: "Execute implementation", icon_hint: "code", status: "completed", started: "2026-11-15T16:59:20Z", completed: "2026-11-16T09:24:36Z", skip_reason: null, summary: "All 19 groups (139 steps) done in 9 waves; full checks match the baseline failing set in all six checks, no new failure.", decisions: [{ decision: "Reverse-scan budget miss at 500 x 10,000 (5.7 s against 2 s) accepted", rationale: "user decision 2026-11-16; 15-minute job unchanged, risk recorded in architecture.md." }, { decision: "No item_listing_preferences.created_at index, no revision 0100", rationale: "the window scan costs about 1 ms; a trial index changed nothing measurable." }], risks: ["Cap-link on the want form is keyed on the cap message text.", "Bell rows take created_at from the writer clock, not the run now.", "Thresholds 0.70 / 0.60 unmeasured (release gate)."], artifacts: [{ path: "implementation/work-log.md", label: "Work log", html: null }, { path: "implementation/measurement/results.md", label: "Match measurement", html: null }, { path: "implementation/baseline/final-comparison.md", label: "Baseline comparison", html: null }], gate: { question: "Continue to verification?", answer: "Yes, to verification" }, progress: { groups_done: 19, groups_total: 19, current_wave: null, skipped: [], reverted: [] } },
    { id: "phase-9", name: "Verify test passes (TDD Green)", icon_hint: "verify", status: "skipped", started: null, completed: null, skip_reason: "Phase 3 not run (no reproducible defect)", summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-10", name: "Prompt verification options", icon_hint: "verify", status: "completed", started: "2026-11-16T09:24:36Z", completed: "2026-11-16T09:25:21Z", skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: { question: "Which verifications to run?", answer: "Code review, pragmatic, reality check, production readiness; E2E yes; user docs yes" }, progress: null },
    { id: "phase-11", name: "Verify implementation & resolve issues", icon_hint: "verify", status: "completed", started: "2026-11-16T09:25:21Z", completed: "2026-11-16T12:55:38Z", skip_reason: null, summary: "After fix cycles 1 and 2: passed with issues; plan 100%, no new test failures, 0 critical, 0 open code warnings; production NO-GO only on the release gate.", decisions: [], risks: ["Release gate open until the labelled Polish sample is scored.", "No live run of the whole stack yet (Phase 12)."], artifacts: [{ path: "verification/implementation-verification.md", label: "Verification report", html: "verification/implementation-verification.html" }, { path: "verification/test-suite-results.md", label: "Test suite", html: null }, { path: "verification/completeness-report.md", label: "Completeness", html: null }, { path: "verification/code-review-report.md", label: "Code review", html: null }, { path: "verification/pragmatic-review.md", label: "Pragmatic review", html: null }, { path: "verification/production-readiness-report.md", label: "Production readiness", html: null }, { path: "verification/reality-check.md", label: "Reality check", html: null }, { path: "verification/completeness-report-reverify.md", label: "Completeness (re-check)", html: null }, { path: "verification/code-review-reverify.md", label: "Code review (re-check)", html: null }, { path: "verification/pragmatic-review-reverify.md", label: "Pragmatic (re-check)", html: null }, { path: "verification/production-readiness-reverify.md", label: "Production (re-check)", html: null }, { path: "verification/reality-check-reverify.md", label: "Reality (re-check)", html: null }], gate: { question: "Continue to Phase 12 (E2E)?", answer: "Yes, to E2E" }, progress: null },
    { id: "phase-12", name: "Run E2E tests", icon_hint: "verify", status: "completed", started: "2026-11-16T12:55:38Z", completed: "2026-11-16T14:45:21Z", skip_reason: null, summary: "13 of 14 journeys pass in the live app; 0 critical, 1 major (guest stuck on /login after logging in from the empty-search prompt), 1 minor, 3 cosmetic; visual fidelity 8 match, 3 minor, 0 drift.", decisions: [], risks: ["resolved: Major-1 guest stuck on /login?returnTo — full page load after login", "resolved: Minor-1 SAWarning cartesian product — join_from in the recursive CTE"], artifacts: [{ path: "verification/e2e-verification-report.md", label: "E2E report", html: "verification/e2e-verification-report.html" }, { path: "verification/visual-fidelity.md", label: "Visual fidelity", html: "verification/visual-fidelity.html" }], gate: { question: "What to do with the E2E defects?", answer: "Fix all (done: major, minor, 3 cosmetic)" }, progress: null },
    { id: "phase-13", name: "Generate user documentation", icon_hint: "docs", status: "completed", started: "2026-11-16T14:45:21Z", completed: "2026-11-16T16:58:44Z", skip_reason: null, summary: "Polish user guide with 12 sections and 25 screenshots (21 reused from E2E, 4 new); old search-guide mock screenshot replaced.", decisions: [], risks: ["The no-match state and the extend button labels differ from the spec; the guide follows the UI."], artifacts: [{ path: "documentation/user-guide.md", label: "User guide (PL)", html: null }], gate: { question: "Continue to Phase 14?", answer: "Yes, finalize" }, progress: null },
    { id: "phase-14", name: "Finalize workflow", icon_hint: "done", status: "completed", started: "2026-11-16T16:58:44Z", completed: "2026-11-16T17:31:07Z", skip_reason: null, summary: "Workflow complete; nothing committed; final checks match the baseline failing set; four standards added; release gate remains before deploy.", decisions: [], risks: [], artifacts: [], gate: null, progress: null }
  ],
  verification: { status: "passed_with_issues", issues: [{ severity: "critical", category: "production", description: "Release gate open: labelled Polish sample not scored, thresholds unmeasured", fixable: false, fixed: false }, { severity: "warning", category: "code_review", description: "W1 scan writes a bell row for a want withdrawn mid-run (no status check)", fixable: true, fixed: true }, { severity: "warning", category: "code_review", description: "W2 cap link keyed on the server message text", fixable: true, fixed: true }, { severity: "warning", category: "completeness", description: "W3 item page fetches wants with useEffect; findMatching dead", fixable: true, fixed: true }, { severity: "warning", category: "pragmatic", description: "W4 notification replace path has no production caller", fixable: true, fixed: true }, { severity: "warning", category: "production", description: "W5 runbook verify step relies on a DEBUG log line", fixable: true, fixed: true }, { severity: "warning", category: "production", description: "W6 image-only rollback order: stop backend before deleting WANT_* rows", fixable: true, fixed: true }, { severity: "warning", category: "production", description: "W7 0099 downgrade leaves WANT_* notification rows", fixable: true, fixed: true }, { severity: "warning", category: "production", description: "W8 no alert / logger.exception on repeated scan failures (logging fixed; alerting open)", fixable: true, fixed: false }, { severity: "warning", category: "completeness", description: "W9 standards/backend/time.md omits app/search and app/wants", fixable: true, fixed: true }, { severity: "warning", category: "code_review", description: "W10 sweep locks wants through the whole match; unbounded window after downtime", fixable: false, fixed: false }, { severity: "warning", category: "code_review", description: "W11 no per-user rate limit on create / resume / matching PATCH", fixable: false, fixed: false }, { severity: "warning", category: "completeness", description: "R-W1 architecture.md Wants section describes four pre-fix details", fixable: true, fixed: true }, { severity: "info", category: "code_review", description: "Deadlock 40P01 between scan and a matching PATCH gives the seeker a 500", fixable: true, fixed: true }], fixes: ["W1 scan reads, locks and points only ACTIVE wants (match_notifications.py); test added", "W2 cap link shown on a create 409 via WantWriteError.status; LIMIT_MESSAGE removed; 3 tests", "W3 useWantsMatchingItem query hook on the item page; findMatching removed; ItemDetailPage call-count assertion changed to the exact two calls", "W4 notification writer simplified to create_notifications; replace path and WrittenNotification removed", "W5 runbook verify step checks want_scan_markers.scanned_through", "W6 runbook rollback order: stop backend, DELETE WANT_* rows, start old image", "W7 0099 downgrade deletes WANT_* notification rows; round-trip test asserts it", "W8 _run_want_scan logs other failures with logger.exception; test extended", "W9 standards/backend/time.md and INDEX.md list six clock-guarded packages", "cleanups: WantMatchNotFound in errors.py, CLOSE_OUTCOMES and subtitle removed, resume_want uses _start_new_period, 'dzisiaj' wording shared, FOCUS_CLASS reused", "cycle 2: architecture.md Wants section aligned with the code; runbook downgrade from the new image; TERYT note for wants.locality_id", "cycle 2: 40P01 / 40001 mapped to the shared 409 in want writes and to a lost race in the scan wrapper; one log line per scan failure", "cycle 2: Polish network error, CloseWantSheet comment, second-take prompt test, AccountView no meta on error, prefilled locality fallback, category prefill UUID check, middle-click opened mark"], reverify_count: 2 }
};
