window.MAISTER_DATA = {
 "generated": "2026-11-18T17:23:01Z",
 "task": {
  "title": "Semantic SIMILAR tier for Szukam (embeddings + pgvector)",
  "type": "development",
  "status": "completed",
  "description": "Implement the research outcome: bell-less SIMILAR tier via mmlw-roberta-base int8 + pgvector halfvec.",
  "path": ".maister/tasks/development/2026-11-18-wants-semantic-similar-tier",
  "current_activity": null
 },
 "characteristics": {
  "has_reproducible_defect": false,
  "modifies_existing_code": true,
  "creates_new_entities": true,
  "involves_data_operations": true,
  "ui_heavy": true
 },
 "phases": [
  {
   "id": "phase-1",
   "name": "Analyze codebase & clarify requirements",
   "icon_hint": "analysis",
   "status": "completed",
   "started": "2026-11-18T10:03:47Z",
   "completed": "2026-11-18T10:13:32Z",
   "skip_reason": null,
   "summary": "All integration anchors exist; SUGGESTION tier is the template; matcher _statement, window counts and the view need refactoring.",
   "decisions": [],
   "risks": [
    "list_wants(matched_item_id) is tier-agnostic",
    "reconcile job breaks test_wants_scan_removed jobs list"
   ],
   "artifacts": [
    {
     "path": "analysis/codebase-analysis.md",
     "label": "Codebase analysis",
     "html": null
    },
    {
     "path": "analysis/clarifications.md",
     "label": "Clarifications",
     "html": null
    }
   ],
   "gate": {
    "question": "Scope / threshold / model build / DB image",
    "answer": "Everything; 0.86 provisional; Dockerfile build; swap image everywhere"
   },
   "progress": null
  },
  {
   "id": "phase-2",
   "name": "Analyze gaps & clarify scope",
   "icon_hint": "analysis",
   "status": "completed",
   "started": "2026-11-18T10:13:32Z",
   "completed": "2026-11-18T10:25:26Z",
   "skip_reason": null,
   "summary": "Additive high-risk change; 1 critical + 6 important decisions.",
   "decisions": [
    {
     "decision": "list_wants(matched_item_id) counts MATCH+SUGGESTION only",
     "rationale": "Shadow stays invisible"
    },
    {
     "decision": "Reconcile sweep as APScheduler 1-min job",
     "rationale": "Matches existing jobs"
    },
    {
     "decision": "EMBEDDING_MODEL_ID constant + drift test",
     "rationale": "Pinned tuple testable"
    },
    {
     "decision": "Drain backfill before matcher deploy",
     "rationale": "Clean shadow metrics"
    }
   ],
   "risks": [
    "list_wants(matched_item_id) is tier-blind: SIMILAR would be visible to users during shadow mode unless filtered"
   ],
   "artifacts": [
    {
     "path": "analysis/gap-analysis.md",
     "label": "Gap analysis",
     "html": null
    },
    {
     "path": "analysis/scope-clarifications.md",
     "label": "Scope clarifications",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to Phase 4: UI Mockup Generation?",
    "answer": "Continue to Phase 4"
   },
   "progress": null
  },
  {
   "id": "phase-3",
   "name": "Write failing test (TDD Red)",
   "icon_hint": "code",
   "status": "skipped",
   "started": null,
   "completed": null,
   "skip_reason": "No reproducible defect",
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-4",
   "name": "Generate UI mockups",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-11-18T10:25:26Z",
   "completed": "2026-11-18T10:31:58Z",
   "skip_reason": null,
   "summary": "3 HTML screens showing „Powiązane rzeczy” in active, empty and matching states.",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "analysis/design-context/INDEX.md",
     "label": "Design index",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html",
     "label": "Mockup: active",
     "html": "analysis/design-context/mockups/want-detail-active-with-matches-suggestions-and-related.html"
    },
    {
     "path": "analysis/design-context/mockups/want-detail-no-matches-only-related-items.html",
     "label": "Mockup: empty",
     "html": "analysis/design-context/mockups/want-detail-no-matches-only-related-items.html"
    },
    {
     "path": "analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html",
     "label": "Mockup: matching",
     "html": "analysis/design-context/mockups/want-detail-matching-in-progress-with-related-items.html"
    }
   ],
   "gate": {
    "question": "Continue to Phase 5?",
    "answer": "Approve, continue to Phase 5"
   },
   "progress": null
  },
  {
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-11-18T10:31:58Z",
   "completed": "2026-11-18T10:54:40Z",
   "skip_reason": null,
   "summary": "Spec: 25 requirements, 7 test groups, full runbook; no new auth row.",
   "decisions": [
    {
     "decision": "Settings EMBEDDINGS_ENABLED + EMBEDDINGS_MODEL_DIR",
     "rationale": "Independent of moderation"
    },
    {
     "decision": "EMBEDDING_MODEL_ID pinned in 3 places + drift test",
     "rationale": "Threshold valid only for one tuple"
    },
    {
     "decision": "Name change without fresh vector deletes the vector",
     "rationale": "No stale meaning"
    }
   ],
   "risks": [
    "0.86 provisional; release gate needed",
    "Old backend image cannot start at >=0100",
    "<HF_COMMIT_SHA> to resolve"
   ],
   "artifacts": [
    {
     "path": "analysis/requirements.md",
     "label": "Requirements",
     "html": null
    },
    {
     "path": "implementation/spec.md",
     "label": "Specification",
     "html": "implementation/spec.html"
    }
   ],
   "gate": {
    "question": "Continue to specification audit?",
    "answer": "Continue to audit"
   },
   "progress": null
  },
  {
   "id": "phase-6",
   "name": "Audit specification",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-18T10:54:40Z",
   "completed": "2026-11-18T11:30:40Z",
   "skip_reason": null,
   "summary": "Audit pass-with-concerns (1 high, 6 medium, 11 low); spec revised with all fixes and 4 user decisions.",
   "decisions": [
    {
     "decision": "SIMILAR-only background re-trigger (wants.similar_requested_at)",
     "rationale": "No lost bells"
    },
    {
     "decision": "Handlers wait, sweep skips",
     "rationale": "Retry never lost"
    },
    {
     "decision": "Stop matcher before alembic",
     "rationale": "Lock timeout"
    },
    {
     "decision": "Side-table carve-outs approved",
     "rationale": "Precedent want_scan_markers"
    }
   ],
   "risks": [
    "At matcher deploy every ACTIVE want carries a SIMILAR flag to drain"
   ],
   "artifacts": [
    {
     "path": "verification/spec-audit.md",
     "label": "Spec audit",
     "html": null
    },
    {
     "path": "implementation/spec.md",
     "label": "Specification (revised)",
     "html": "implementation/spec.html"
    }
   ],
   "gate": {
    "question": "Continue to implementation planning?",
    "answer": "Continue to planning"
   },
   "progress": null
  },
  {
   "id": "phase-7",
   "name": "Plan implementation",
   "icon_hint": "plan",
   "status": "completed",
   "started": "2026-11-18T11:30:40Z",
   "completed": "2026-11-18T11:51:37Z",
   "skip_reason": null,
   "summary": "13 groups, 89 steps, ~64-74 tests; visual coverage 5/5.",
   "decisions": [
    {
     "decision": "13 groups mapped to spec test groups + lifespan/infra/docs/review",
     "rationale": "Parallel waves"
    },
    {
     "decision": "HF_COMMIT_SHA resolved once",
     "rationale": "Same value in 3 places"
    }
   ],
   "risks": [
    "HF API unreachable blocks real SHA",
    "Docker + pgvector image must be pullable"
   ],
   "artifacts": [
    {
     "path": "implementation/implementation-plan.md",
     "label": "Implementation plan",
     "html": "implementation/implementation-plan.html"
    },
    {
     "path": "implementation/visual-coverage.md",
     "label": "Visual coverage",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to implementation?",
    "answer": "Continue to implementation"
   },
   "progress": null
  },
  {
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
   "status": "completed",
   "started": "2026-11-18T11:51:37Z",
   "completed": "2026-11-18T13:34:20Z",
   "skip_reason": null,
   "summary": "13 groups / 89 steps done; full suites at baseline; 1 cross-group defect fixed.",
   "decisions": [],
   "risks": [
    "Parity margin thin (0.9904)",
    "Full-image build with hf_token not run",
    "Untracked 0102 chains after 0101"
   ],
   "artifacts": [
    {
     "path": "implementation/work-log.md",
     "label": "Work log",
     "html": null
    },
    {
     "path": "implementation/full-suite-results.md",
     "label": "Full suite results",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to verification?",
    "answer": "Continue to verification"
   },
   "progress": {
    "groups_done": 13,
    "groups_total": 13,
    "current_wave": null,
    "skipped": [],
    "reverted": []
   }
  },
  {
   "id": "phase-9",
   "name": "Verify test passes (TDD Green)",
   "icon_hint": "verify",
   "status": "skipped",
   "started": null,
   "completed": null,
   "skip_reason": "Phase 3 not run",
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-10",
   "name": "Prompt verification options",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-18T13:34:20Z",
   "completed": "2026-11-18T13:35:04Z",
   "skip_reason": null,
   "summary": "All four reviews, E2E and user docs enabled; test suite skipped (passed at baseline in implementation).",
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": {
    "question": "Which verifications?",
    "answer": "Code, pragmatic, reality, production; E2E yes; user docs yes"
   },
   "progress": null
  },
  {
   "id": "phase-11",
   "name": "Verify implementation & resolve issues",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-18T13:35:04Z",
   "completed": "2026-11-18T16:20:31Z",
   "skip_reason": null,
   "summary": "Re-verified twice: code clean, suites at baseline; failed only on operational gates (C1 gate before step 8, C2 full image build); shadow deploy GO with mitigations.",
   "decisions": [
    {
     "decision": "Fix all fixable issues (cycles 1 and 2)",
     "rationale": "User choice"
    },
    {
     "decision": "W1: SIMILAR upgraded in place",
     "rationale": "Restores bells unchanged"
    },
    {
     "decision": "Release gate before step 8 (web), shadow first",
     "rationale": "Shadow rows are invisible; owner signs off"
    }
   ],
   "risks": [
    "C1 labelled-sample gate before step 8",
    "C2 full image build with hf_token",
    "Base 0099 release status unconfirmed",
    "Runtime-ORT parity unchecked"
   ],
   "artifacts": [
    {
     "path": "verification/implementation-verification.md",
     "label": "Implementation verification",
     "html": "verification/implementation-verification.html"
    },
    {
     "path": "verification/test-suite-results.md",
     "label": "Test suite (re-run)",
     "html": null
    },
    {
     "path": "verification/code-review-reverify.md",
     "label": "Code review (re-check)",
     "html": null
    },
    {
     "path": "verification/production-readiness-reverify.md",
     "label": "Production (re-check)",
     "html": null
    },
    {
     "path": "verification/reality-reverify.md",
     "label": "Reality (re-check)",
     "html": null
    },
    {
     "path": "verification/pragmatic-reverify.md",
     "label": "Pragmatic (re-check)",
     "html": null
    },
    {
     "path": "verification/completeness-reverify.md",
     "label": "Completeness (re-check)",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to E2E with C1/C2 as operator steps?",
    "answer": "Proceed, keep C1/C2 as operator steps"
   },
   "progress": null
  },
  {
   "id": "phase-12",
   "name": "Run E2E tests",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-18T16:20:31Z",
   "completed": "2026-11-18T17:21:25Z",
   "skip_reason": null,
   "summary": "GO: 9/9 scenarios passed; visual fidelity 5 match / 0 minor / 0 drift.",
   "decisions": [],
   "risks": [
    "Reserved captions not exercised live",
    "Next 16.4.4 security advisory (out of scope)"
   ],
   "artifacts": [
    {
     "path": "verification/e2e-verification-report.md",
     "label": "E2E report",
     "html": "verification/e2e-verification-report.html"
    },
    {
     "path": "verification/visual-fidelity.md",
     "label": "Visual fidelity",
     "html": "verification/visual-fidelity.html"
    }
   ],
   "gate": {
    "question": "Continue to Phase 13?",
    "answer": "Continue to Phase 13"
   },
   "progress": null
  },
  {
   "id": "phase-13",
   "name": "Generate user documentation",
   "icon_hint": "docs",
   "status": "completed",
   "started": "2026-11-18T17:21:25Z",
   "completed": "2026-11-18T17:23:01Z",
   "skip_reason": null,
   "summary": "Polish one-page guide, 5 reused screenshots.",
   "decisions": [],
   "risks": [
    "Screenshots contain a dev overlay badge"
   ],
   "artifacts": [
    {
     "path": "documentation/user-guide.md",
     "label": "User guide",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to Phase 14?",
    "answer": "Continue to Phase 14"
   },
   "progress": null
  },
  {
   "id": "phase-14",
   "name": "Finalize workflow",
   "icon_hint": "done",
   "status": "completed",
   "started": "2026-11-18T17:23:01Z",
   "completed": "2026-11-18T17:23:01Z",
   "skip_reason": null,
   "summary": "Workflow summary written; all declared artifacts present; nothing committed.",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "workflow-summary.md",
     "label": "Workflow summary",
     "html": null
    }
   ],
   "gate": null,
   "progress": null
  }
 ],
 "verification": {
  "status": "failed",
  "issues": [
   {
    "severity": "critical",
    "category": "production",
    "description": "C1 Labelled-sample release gate not run; 0.86 provisional",
    "fixable": false,
    "fixed": false
   },
   {
    "severity": "critical",
    "category": "production",
    "description": "C2 Production image never built with hf_token",
    "fixable": false,
    "fixed": false
   },
   {
    "severity": "warning",
    "category": "reality",
    "description": "W1 SIMILAR row blocks later lexical MATCH after product re-point (lost bell)",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W2 /similar failure breaks the whole want page",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W3 models stage unpinned quantizer, no weight hash; parity margin +0.0004",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W4 handlers/reconcile embed while holding row lock",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W5 single embed worker: writes queue behind reconcile batches",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W6 one try around both reconcile sides",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W7 matcher param layout differs per tier",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W8 product vs want embedding modules drift",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "reality",
    "description": "W9 runbook: re-flag ACTIVE wants after matcher deploy",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "reality",
    "description": "W10 runbook: model-change re-flag",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "completeness",
    "description": "W11 dangling 0102 references in architecture.md",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "completeness",
    "description": "W12 suites ran on tree with withdrawn 0102 - re-run",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "completeness",
    "description": "W13 standards stale postgres:18 + carve-out unrecorded",
    "fixable": true,
    "fixed": false
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W14 model load failure stops API; runbook flip flag after verify",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W15 VPS A unmeasured; step 0b ordering",
    "fixable": true,
    "fixed": false
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W16 no collation pre-check / fix path",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W17 web must not run ahead of backend / no UI switch",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "N1 update_product vector before flush: lock-order deadlock risk",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "R-N1 threshold change after shadow: no score filter, runbook delete+reflag",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "R-N2 old images not kept; never compose up between steps 1 and 4.2",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "reality",
    "description": "RR-1 rollback step 3: re-flag on matcher redeploy",
    "fixable": true,
    "fixed": true
   }
  ],
  "fixes": [
   "W1 SIMILAR upgraded in place by later lexical hit",
   "W2 /similar failure falls back to empty",
   "W3 models stage pinned + model.sha256",
   "W4 embed without row lock",
   "W5 reconcile batch 8",
   "W6 per-side reconcile try",
   "W7 fixed param layout",
   "W8 modules aligned",
   "W9/W10 runbook re-flag steps",
   "W11 0102 refs removed",
   "W14 flag flip after health check",
   "W15 VPS A step 1b",
   "W16 OS/collation checks",
   "W17 web freeze",
   "I1 now after embed",
   "I3 docstrings",
   "I4 non-finite miss",
   "I5 always-on 0101 check",
   "P-L1..L4 cleanups",
   "S1 spec/.env.example",
   "N1 flush before vector write",
   "R-N1 runbook 7b/7c threshold change",
   "R-N2 pre-semantic tags + never-up",
   "RR-1 rollback re-flag",
   "CR-N3/N4/N5/N7 tests, 2 s timeout, keep previous similar, expiry re-check",
   "P-R1/N1/L5 Statement, shared ReconcileResult, dedup",
   "Spec/ADR drift amended",
   "--no-build on shadow up steps",
   "Release gate rescoped to before step 8"
  ],
  "reverify_count": 2
 }
};
