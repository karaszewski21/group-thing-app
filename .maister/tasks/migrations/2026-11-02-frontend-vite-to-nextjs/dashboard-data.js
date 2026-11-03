window.MAISTER_DATA = {
  "generated": "2026-11-03T10:08:17Z",
  "task": {
    "title": "Migrate frontend from Vite SPA to Next.js",
    "type": "migration",
    "status": "completed",
    "description": "Vite + React Router SPA to Next.js App Router, no regressions, MVP without production.",
    "path": ".maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs",
    "current_activity": null
  },
  "characteristics": {},
  "phases": [
    {
      "id": "phase-1",
      "name": "Analyze current state",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-11-02T13:55:56Z",
      "completed": "2026-11-02T14:30:10Z",
      "skip_reason": null,
      "summary": "Large client-only SPA (~340 source files, 131 test files) with localStorage-only auth and static-index.html deploy; migration feasible client-first.",
      "decisions": [
        {
          "decision": "User: migrate the working tree as is",
          "rationale": "Phase 1 clarification"
        },
        {
          "decision": "User: backend reads the JWT from a cookie",
          "rationale": "Phase 1 clarification"
        },
        {
          "decision": "User: SSR generateMetadata + palette, client views",
          "rationale": "Phase 1 clarification"
        },
        {
          "decision": "User: scope includes deploy, backend OG/catch-all removal, plugins/port, standards docs",
          "rationale": "Phase 1 clarification"
        }
      ],
      "risks": [
        "OAuth2 /oauth2/authorize: GET must render the Next page, POST must reach the backend; security-sensitive split",
        "useBlocker in EditorSheet.tsx:66 needs a custom replacement; OrganizerEditor tests (28) flaky",
        "~13 pre-existing vitest failures; capture a fresh baseline so no-regression is measurable",
        "Cookie auth on the backend requires a CSRF strategy and Vary adjustments"
      ],
      "artifacts": [
        {
          "path": "analysis/current-state-analysis.md",
          "label": "Current state analysis",
          "html": null
        },
        {
          "path": "analysis/clarifications.md",
          "label": "Clarifications",
          "html": null
        },
        {
          "path": "analysis/user-target-structure.md",
          "label": "User target structure",
          "html": null
        }
      ],
      "gate": null,
      "progress": null
    },
    {
      "id": "phase-2",
      "name": "Plan target state and gaps",
      "icon_hint": "analysis",
      "status": "completed",
      "started": "2026-11-02T14:30:10Z",
      "completed": "2026-11-02T15:01:28Z",
      "skip_reason": null,
      "summary": "Target Next 16.4.x App Router; phased in-repo migration (A on Vite: renames, SSR fixes, navigation facade, cookie; B swap to Next; C server metadata + retire backend OG; D deploy/docs). Risk high, mitigated to medium.",
      "decisions": [
        {
          "decision": "Next 16.4.x over 15.5",
          "rationale": "16 is the active line (LTS to 2027-10), proxy.ts and async params are the future API"
        },
        {
          "decision": "git mv src/pages src/features (mechanical) and src/app -> src/app-data",
          "rationale": "Next would treat src/pages as Pages Router; src/app is needed by Next"
        },
        {
          "decision": "One persistent chrome layout app/(site)/layout.tsx above (public) and (panel)",
          "rationale": "matches today; chrome never remounts"
        },
        {
          "decision": "No / -> /home rewrite; (panel)/layout reproduces AppRoute",
          "rationale": "no backend slug change"
        },
        {
          "decision": "Navigation facade src/navigation/ first on React Router, then next/navigation",
          "rationale": "tests act as invariant across the swap"
        },
        {
          "decision": "Frontend writes readable auth_token cookie; backend accepts it on GET/HEAD only; Vary: Authorization, Cookie",
          "rationale": "CSRF-free by construction"
        }
      ],
      "risks": [
        "useBlocker has no App Router equivalent; back/forward best-effort",
        "OG parity: backend text rules must be re-implemented in TS",
        "proxy.ts must not match /api/* (10 MB body buffer)",
        "Behaviour deltas: real 404 page, /:slug/group/:groupId becomes 404, scroll-to-top on push"
      ],
      "artifacts": [
        {
          "path": "analysis/target-state-plan.md",
          "label": "Target state plan & gap analysis",
          "html": null
        }
      ],
      "gate": {
        "question": "Continue to Phase 3 (12 decisions resolved; D6 rewrite / -> /home and D7 full features/ reorg chosen against recommendation)?",
        "answer": "Tak, dalej do Fazy 3"
      },
      "progress": null
    },
    {
      "id": "phase-3",
      "name": "Gather requirements & create migration strategy",
      "icon_hint": "spec",
      "status": "completed",
      "started": "2026-11-02T15:01:28Z",
      "completed": "2026-11-02T15:41:42Z",
      "skip_reason": null,
      "summary": "Spec with 21 requirements, 61 page routes, 14 checkpoint commits (C0 user WIP to C13), exact D7 old-to-new path table, D6 rewrite design (/home 307 to /, pathname normalisation, refresh after token change).",
      "decisions": [
        {
          "decision": "Admin layout gate stays AuthGuard-only",
          "rationale": "ProductListPage checks EDIT; seeded editor creates products in admin; role gate would lock them out"
        },
        {
          "decision": "Panel layout renders AppPage itself; 26 panel page.tsx return null",
          "rationale": "keeps AppPage state alive across sections as today"
        },
        {
          "decision": "Dynamic folder named [organizationSlug]",
          "rationale": "existing code reads that param name"
        },
        {
          "decision": "Navigation facade in src/routing/ with ESLint no-restricted-imports",
          "rationale": "user's folder; keeps router imports inside it"
        },
        {
          "decision": "Commit checkpoints on main; C0 = user WIP only",
          "rationale": "user requirement; clean pre-migration point"
        }
      ],
      "risks": [
        "usePathname under the / -> /home rewrite (normalised; smoke checks hydration)",
        "Chakra/Emotion may flash unstyled on SSR public pages; fallback Emotion registry in phase C",
        "Forwarded headers on proxy rewrite of POST /oauth2/authorize only checked in smoke",
        "Private circles fall back to default OG (anonymous server fetch)",
        "A dev org with slug home would be shadowed; A5 counts it"
      ],
      "artifacts": [
        {
          "path": "implementation/spec.md",
          "label": "Migration specification",
          "html": "implementation/spec.html"
        },
        {
          "path": "analysis/rollback-plan.md",
          "label": "Rollback plan",
          "html": null
        },
        {
          "path": "analysis/requirements.md",
          "label": "Migration requirements",
          "html": null
        }
      ],
      "gate": {
        "question": "Admin gate / D7 splits / search+add folders / continue to Phase 4?",
        "answer": "AuthGuard-only; splits as follow-up; separate features/search and features/add; continue"
      },
      "progress": null
    },
    {
      "id": "phase-4",
      "name": "Plan implementation",
      "icon_hint": "plan",
      "status": "completed",
      "started": "2026-11-02T15:41:42Z",
      "completed": "2026-11-02T15:50:26Z",
      "skip_reason": null,
      "summary": "17 task groups, 124 steps, one group per checkpoint C0-C12 plus four Phase D groups sharing C13; 40-54 new tests; per-group gates and user-run rollback.",
      "decisions": [
        {
          "decision": "One group per checkpoint C0-C12; Phase D as four groups sharing commit C13",
          "rationale": "independent D work can run concurrently"
        },
        {
          "decision": "A1 fully scripted (d7-map.json + d7-move.mjs with dry-run, mock specifier rewrite)",
          "rationale": "mechanical move with identical case count"
        },
        {
          "decision": "Group 7 (backend) can run alongside groups 3-6; commit waits for C5",
          "rationale": "path-scoped staging, keep C-number order"
        },
        {
          "decision": "Smoke checklist prepared in Group 17, executed in Phase 6",
          "rationale": "plan scope"
        }
      ],
      "risks": [
        "A3 test migration must keep test names byte-identical for id-based comparison",
        "Unrewritten A1 mock specifiers fail silently; pass-set compare + grep are the net",
        "Backend gates need Docker (testcontainers); group stops if Docker is down",
        "usePathname/hydration, Emotion FOUC, OAuth2 forwarded host, 15 MB uploads only surface in Phase 6 smoke"
      ],
      "artifacts": [
        {
          "path": "implementation/implementation-plan.md",
          "label": "Implementation plan",
          "html": "implementation/implementation-plan.html"
        }
      ],
      "gate": {
        "question": "Start migration execution (Phase 5)?",
        "answer": "Tak, wykonuj migrację"
      },
      "progress": null
    },
    {
      "id": "phase-5",
      "name": "Execute migration",
      "icon_hint": "code",
      "status": "completed",
      "started": "2026-11-02T15:50:26Z",
      "completed": "2026-11-02T20:07:43Z",
      "skip_reason": null,
      "summary": "All 17 groups done; app runs on Next 16.4.4; final gate green (vitest 1469/0 regressions, pytest 1138/0). C0-C6 committed, rest uncommitted per user.",
      "decisions": [
        {
          "decision": "User: no more commits after C6; commit steps C7-C13 skipped",
          "rationale": "user instruction \"tylko nie commituj\""
        },
        {
          "decision": "62 pages instead of 61; admin/(shell) and product/[id]/(item) route groups",
          "rationale": "spec list sums to 62; server redirect() under a children-withholding layout becomes a 200"
        },
        {
          "decision": "eslint-plugin-react-refresh kept",
          "rationale": "13 feature files carry its disable directives; removing it = 20 errors or a feature-code diff"
        },
        {
          "decision": "Emotion SSR registry added in C1",
          "rationale": "hydration mismatch observed on SSR'd (site) pages in B3"
        },
        {
          "decision": "BACKEND_INTERNAL_URL is also a Docker build arg",
          "rationale": "next.config rewrites are fixed at build time"
        }
      ],
      "risks": [
        "Session crash corrupted refs/heads/main and .git/index; repaired (main -> 25c9aec), fsck clean",
        "GET /api/groups/{id}/join-code writes lazily, against the new GET-is-side-effect-free rule (cookie auth on GET)",
        "Emotion fix and /notifications + /[org] routes only checked on a production build; re-check under next dev in the smoke",
        "POST /oauth2/authorize reaches the backend with Host backend:8080; forwarded-host handling unverified end to end",
        "User action: rename VITE_GOOGLE_MAPS_API_KEY in root .env; rebuild the backend image before compose up"
      ],
      "artifacts": [
        {
          "path": "implementation/work-log.md",
          "label": "Work log",
          "html": null
        },
        {
          "path": "verification/smoke-checklist.md",
          "label": "Smoke checklist (70 rows)",
          "html": null
        },
        {
          "path": "verification/smoke-run-instructions.md",
          "label": "Smoke run instructions",
          "html": null
        }
      ],
      "gate": {
        "question": "Continue to Phase 6 verification?",
        "answer": "Tak, weryfikuj"
      },
      "progress": {
        "groups_done": 17,
        "groups_total": 17,
        "current_wave": null,
        "skipped": [],
        "reverted": []
      }
    },
    {
      "id": "phase-6",
      "name": "Verify and test compatibility",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-11-02T20:07:43Z",
      "completed": "2026-11-03T08:07:22Z",
      "skip_reason": null,
      "summary": "Failed (fixable): 1 critical (open redirect returnTo), 13 warnings, 11 info; vitest/pytest 0 regressions; dev smoke 58/63 with 2 regressions; compose deferred.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "verification/implementation-verification.md",
          "label": "Verification report",
          "html": null
        },
        {
          "path": "verification/e2e-smoke-report.md",
          "label": "Smoke report",
          "html": null
        },
        {
          "path": "verification/code-review-report.md",
          "label": "Code review",
          "html": null
        },
        {
          "path": "verification/reality-check.md",
          "label": "Reality check",
          "html": null
        },
        {
          "path": "verification/production-readiness-report.md",
          "label": "Production readiness",
          "html": null
        },
        {
          "path": "verification/pragmatic-review.md",
          "label": "Pragmatic review",
          "html": null
        },
        {
          "path": "verification/completeness-report.md",
          "label": "Completeness",
          "html": null
        }
      ],
      "gate": {
        "question": "Continue to Phase 7 (fixes)? Which scope?",
        "answer": "Must-fix + cheap: 1, 2+3, 4, 7, 5, 6, 9, 10, 12"
      },
      "progress": null
    },
    {
      "id": "phase-7",
      "name": "Resolve verification issues",
      "icon_hint": "verify",
      "status": "completed",
      "started": "2026-11-03T08:07:22Z",
      "completed": "2026-11-03T10:08:17Z",
      "skip_reason": null,
      "summary": "Fixed 1, 2+3, 4, 5, 6, 7, 9, 10, 12. Gates: pytest 1138/0, ruff/mypy at baseline, tsc 0, eslint 13 errors, vitest only the 12 A0 fails; smoke S04a/S04b/W04/S13c pass.",
      "decisions": [],
      "risks": [],
      "artifacts": [
        {
          "path": "implementation/work-log.md",
          "label": "Work log (Phase 7)",
          "html": null
        },
        {
          "path": "analysis/rollback-plan.md",
          "label": "Rollback plan (as built)",
          "html": null
        }
      ],
      "gate": {
        "question": "Close the workflow?",
        "answer": "Close the workflow; no full re-verification"
      },
      "progress": null
    },
    {
      "id": "phase-8",
      "name": "Generate documentation",
      "icon_hint": "docs",
      "status": "skipped",
      "started": null,
      "completed": null,
      "skip_reason": "docs_enabled: false",
      "summary": null,
      "decisions": [],
      "risks": [],
      "artifacts": [],
      "gate": null,
      "progress": null
    }
  ],
  "verification": {
    "status": "passed_with_issues",
    "issues": [
      {
        "severity": "critical",
        "category": "security",
        "description": "Open redirect via ?returnTo= (AuthGuard, OnboardingPage)",
        "fixable": true,
        "fixed": true
      },
      {
        "severity": "warning",
        "category": "regression",
        "description": "Stale cookie lands on /login (layout initialToken)",
        "fixable": true,
        "fixed": true
      },
      {
        "severity": "warning",
        "category": "security",
        "description": "Raw JWT in every page HTML/RSC payload",
        "fixable": true,
        "fixed": true
      },
      {
        "severity": "warning",
        "category": "regression",
        "description": "Plugin SDK blocked by CORS on 5173",
        "fixable": true,
        "fixed": true
      },
      {
        "severity": "warning",
        "category": "process",
        "description": "rollback-plan.md stale; B1-D uncommitted",
        "fixable": true,
        "fixed": true
      }
    ],
    "fixes": [
      "1 open redirect: returnTo validated via isSafeReturnPath in AuthGuard and OnboardingPage (+ tests)",
      "2+3 server passes session claims (sessionFromToken), never the raw JWT; api client ends the session on 401 only when a token was sent",
      "4 Access-Control-Allow-Origin * on /assets/:path* (next.config headers)",
      "5 serverGet AbortSignal.timeout(3000)",
      "6 root .dockerignore excludes .env* and *.local; unused src/frontend/.dockerignore removed",
      "7 rollback-plan.md rewritten for the real history (C0-C6, C12 fc71c2c, B1-D e0d5d2a, Phase 7 uncommitted)",
      "9 app/error.tsx and app/global-error.tsx",
      "10 dead helpers, stale docstring and unreferenced src/resources/static removed",
      "12 react-hooks set-state-in-effect and refs set to warn"
    ],
    "reverify_count": 0
  }
};
