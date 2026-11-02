window.MAISTER_DATA = {
  generated: "2026-11-02T15:52:25Z",
  task: {
    title: "Migrate frontend from Vite SPA to Next.js",
    type: "migration",
    status: "in_progress",
    description: "Vite + React Router SPA to Next.js App Router, no regressions, MVP without production.",
    path: ".maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs",
    current_activity: "Executing migration"
  },
  characteristics: {},
  phases: [
    { id: "phase-1", name: "Analyze current state", icon_hint: "analysis", status: "completed", started: "2026-11-02T13:55:56Z", completed: "2026-11-02T14:30:10Z", skip_reason: null,
      summary: "Large client-only SPA (~340 source files, 131 test files) with localStorage-only auth and static-index.html deploy; migration feasible client-first.",
      decisions: [
        { decision: "User: migrate the working tree as is", rationale: "Phase 1 clarification" },
        { decision: "User: backend reads the JWT from a cookie", rationale: "Phase 1 clarification" },
        { decision: "User: SSR generateMetadata + palette, client views", rationale: "Phase 1 clarification" },
        { decision: "User: scope includes deploy, backend OG/catch-all removal, plugins/port, standards docs", rationale: "Phase 1 clarification" }
      ],
      risks: [
        "OAuth2 /oauth2/authorize: GET must render the Next page, POST must reach the backend; security-sensitive split",
        "useBlocker in EditorSheet.tsx:66 needs a custom replacement; OrganizerEditor tests (28) flaky",
        "~13 pre-existing vitest failures; capture a fresh baseline so no-regression is measurable",
        "Cookie auth on the backend requires a CSRF strategy and Vary adjustments"
      ],
      artifacts: [
        { path: "analysis/current-state-analysis.md", label: "Current state analysis", html: null },
        { path: "analysis/clarifications.md", label: "Clarifications", html: null },
        { path: "analysis/user-target-structure.md", label: "User target structure", html: null }
      ], gate: null, progress: null },
    { id: "phase-2", name: "Plan target state and gaps", icon_hint: "analysis", status: "completed", started: "2026-11-02T14:30:10Z", completed: "2026-11-02T15:01:28Z", skip_reason: null,
      summary: "Target Next 16.4.x App Router; phased in-repo migration (A on Vite: renames, SSR fixes, navigation facade, cookie; B swap to Next; C server metadata + retire backend OG; D deploy/docs). Risk high, mitigated to medium.",
      decisions: [
        { decision: "Next 16.4.x over 15.5", rationale: "16 is the active line (LTS to 2027-10), proxy.ts and async params are the future API" },
        { decision: "git mv src/pages src/features (mechanical) and src/app -> src/app-data", rationale: "Next would treat src/pages as Pages Router; src/app is needed by Next" },
        { decision: "One persistent chrome layout app/(site)/layout.tsx above (public) and (panel)", rationale: "matches today; chrome never remounts" },
        { decision: "No / -> /home rewrite; (panel)/layout reproduces AppRoute", rationale: "no backend slug change" },
        { decision: "Navigation facade src/navigation/ first on React Router, then next/navigation", rationale: "tests act as invariant across the swap" },
        { decision: "Frontend writes readable auth_token cookie; backend accepts it on GET/HEAD only; Vary: Authorization, Cookie", rationale: "CSRF-free by construction" }
      ],
      risks: [
        "useBlocker has no App Router equivalent; back/forward best-effort",
        "OG parity: backend text rules must be re-implemented in TS",
        "proxy.ts must not match /api/* (10 MB body buffer)",
        "Behaviour deltas: real 404 page, /:slug/group/:groupId becomes 404, scroll-to-top on push"
      ],
      artifacts: [ { path: "analysis/target-state-plan.md", label: "Target state plan & gap analysis", html: null } ], gate: { question: "Continue to Phase 3 (12 decisions resolved; D6 rewrite / -> /home and D7 full features/ reorg chosen against recommendation)?", answer: "Tak, dalej do Fazy 3" }, progress: null },
    { id: "phase-3", name: "Gather requirements & create migration strategy", icon_hint: "spec", status: "completed", started: "2026-11-02T15:01:28Z", completed: "2026-11-02T15:41:42Z", skip_reason: null,
      summary: "Spec with 21 requirements, 61 page routes, 14 checkpoint commits (C0 user WIP to C13), exact D7 old-to-new path table, D6 rewrite design (/home 307 to /, pathname normalisation, refresh after token change).",
      decisions: [
        { decision: "Admin layout gate stays AuthGuard-only", rationale: "ProductListPage checks EDIT; seeded editor creates products in admin; role gate would lock them out" },
        { decision: "Panel layout renders AppPage itself; 26 panel page.tsx return null", rationale: "keeps AppPage state alive across sections as today" },
        { decision: "Dynamic folder named [organizationSlug]", rationale: "existing code reads that param name" },
        { decision: "Navigation facade in src/routing/ with ESLint no-restricted-imports", rationale: "user's folder; keeps router imports inside it" },
        { decision: "Commit checkpoints on main; C0 = user WIP only", rationale: "user requirement; clean pre-migration point" }
      ],
      risks: [
        "usePathname under the / -> /home rewrite (normalised; smoke checks hydration)",
        "Chakra/Emotion may flash unstyled on SSR public pages; fallback Emotion registry in phase C",
        "Forwarded headers on proxy rewrite of POST /oauth2/authorize only checked in smoke",
        "Private circles fall back to default OG (anonymous server fetch)",
        "A dev org with slug home would be shadowed; A5 counts it"
      ],
      artifacts: [
        { path: "implementation/spec.md", label: "Migration specification", html: "implementation/spec.html" },
        { path: "analysis/rollback-plan.md", label: "Rollback plan", html: null },
        { path: "analysis/requirements.md", label: "Migration requirements", html: null }
      ], gate: { question: "Admin gate / D7 splits / search+add folders / continue to Phase 4?", answer: "AuthGuard-only; splits as follow-up; separate features/search and features/add; continue" }, progress: null },
    { id: "phase-4", name: "Plan implementation", icon_hint: "plan", status: "completed", started: "2026-11-02T15:41:42Z", completed: "2026-11-02T15:50:26Z", skip_reason: null, summary: "17 task groups, 124 steps, one group per checkpoint C0-C12 plus four Phase D groups sharing C13; 40-54 new tests; per-group gates and user-run rollback.",
      decisions: [
        { decision: "One group per checkpoint C0-C12; Phase D as four groups sharing commit C13", rationale: "independent D work can run concurrently" },
        { decision: "A1 fully scripted (d7-map.json + d7-move.mjs with dry-run, mock specifier rewrite)", rationale: "mechanical move with identical case count" },
        { decision: "Group 7 (backend) can run alongside groups 3-6; commit waits for C5", rationale: "path-scoped staging, keep C-number order" },
        { decision: "Smoke checklist prepared in Group 17, executed in Phase 6", rationale: "plan scope" }
      ],
      risks: [
        "A3 test migration must keep test names byte-identical for id-based comparison",
        "Unrewritten A1 mock specifiers fail silently; pass-set compare + grep are the net",
        "Backend gates need Docker (testcontainers); group stops if Docker is down",
        "usePathname/hydration, Emotion FOUC, OAuth2 forwarded host, 15 MB uploads only surface in Phase 6 smoke"
      ],
      artifacts: [ { path: "implementation/implementation-plan.md", label: "Implementation plan", html: "implementation/implementation-plan.html" } ], gate: { question: "Start migration execution (Phase 5)?", answer: "Tak, wykonuj migrację" }, progress: null },
    { id: "phase-5", name: "Execute migration", icon_hint: "code", status: "in_progress", started: "2026-11-02T15:50:26Z", completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: { groups_done: 1, groups_total: 17, current_wave: 2, skipped: [], reverted: [] } },
    { id: "phase-6", name: "Verify and test compatibility", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-7", name: "Resolve verification issues", icon_hint: "verify", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null },
    { id: "phase-8", name: "Generate documentation", icon_hint: "docs", status: "pending", started: null, completed: null, skip_reason: null, summary: null, decisions: [], risks: [], artifacts: [], gate: null, progress: null }
  ],
  verification: null
};
