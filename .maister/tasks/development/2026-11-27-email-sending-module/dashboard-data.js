window.MAISTER_DATA = {
 "generated": "2026-11-28T11:33:09Z",
 "task": {
  "title": "Moduł mailingowy app/email (Mailgun EU) — wdrożenie z badania",
  "type": "development",
  "status": "completed",
  "description": "Implement app/email from research 2026-11-26-email-sending-module",
  "path": ".maister/tasks/development/2026-11-27-email-sending-module",
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
   "started": "2026-11-27T07:20:17Z",
   "completed": "2026-11-27T09:34:42Z",
   "skip_reason": null,
   "summary": "No email code exists; notifications.service is the single hook point; precedents exist for every part. Scope fixed to stages 1+2.",
   "decisions": [],
   "risks": [
    "Import cycles auth<->users; app.email must not import app.notifications",
    "Collapsed WANT_MATCH bells leave dangling notification_id",
    "tests/test_wants_notifications.py:92 pins exactly one INSERT",
    "Frontend clears session on any 401 — token endpoints must use 400/404/410"
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
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-2",
   "name": "Analyze gaps & clarify scope",
   "icon_hint": "analysis",
   "status": "completed",
   "started": "2026-11-27T09:34:42Z",
   "completed": "2026-11-27T10:13:50Z",
   "skip_reason": null,
   "summary": "Everything new; research settles most design; 2 critical + 6 important decisions surfaced.",
   "decisions": [
    {
     "decision": "C-1 issue verification inside users.service.register",
     "rationale": "atomic, no import cycle"
    },
    {
     "decision": "C-2 EMAIL_NOTIFICATIONS_ENABLED default false",
     "rationale": "warm-up + D14 gate without code change"
    },
    {
     "decision": "I-2 own email_messages queue is the outbox (not outbox_entries)",
     "rationale": "backoff, no bell duplicates"
    }
   ],
   "risks": [
    "D14 privacy policy and Mailgun DPA gate the rollout",
    "Mailgun's own bounce list can block a verification mail even after the local BOUNCE row is cleared",
    "Pre-existing outbox dispatcher partial-commit bug duplicates bells",
    "Baseline noise: 32 vitest, 2 stale backend tests, mypy 15, ruff 64"
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
    "question": "Continue to Phase 4: UI mockups?",
    "answer": "Yes"
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
   "started": "2026-11-27T10:13:50Z",
   "completed": "2026-11-27T10:23:16Z",
   "skip_reason": null,
   "summary": "9 HTML mockup screens in Polish bound to aj tokens and components; gallery at http://localhost:3848",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "analysis/design-context/INDEX.md",
     "label": "Design context index",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html",
     "label": "Mockup: /settings",
     "html": "analysis/design-context/mockups/ustawienia-powiadomienia-e-mail.html"
    }
   ],
   "gate": {
    "question": "Accept mockups and continue to Phase 5?",
    "answer": "Akceptuj, dalej"
   },
   "progress": null
  },
  {
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-11-27T10:23:16Z",
   "completed": "2026-11-27T10:42:01Z",
   "skip_reason": null,
   "summary": "Spec: 25 requirements, 11 test groups; adds lookup endpoint (row 82), expires_at, quiet-hours claim filter.",
   "decisions": [],
   "risks": [
    "Proposed copy not in mockups needs product read",
    "party_id FKs without ON DELETE",
    "Webhook replay memory per-process",
    "D14 privacy policy + Mailgun DPA outside code"
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
    "answer": "Tak, do audytu"
   },
   "progress": null
  },
  {
   "id": "phase-6",
   "name": "Audit specification",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-27T10:42:01Z",
   "completed": "2026-11-27T11:08:32Z",
   "skip_reason": null,
   "summary": "Audit pass-with-concerns (1 high, 10 medium, 15 low); all findings applied to spec.",
   "decisions": [
    {
     "decision": "M-7 neutral copy + notifications_live",
     "rationale": "no false promises during warm-up"
    },
    {
     "decision": "M-9 reset form for everyone",
     "rationale": "Google-only accounts can set a password"
    }
   ],
   "risks": [],
   "artifacts": [
    {
     "path": "verification/spec-audit.md",
     "label": "Spec audit",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to implementation planning?",
    "answer": "Popraw spec, potem plan"
   },
   "progress": null
  },
  {
   "id": "phase-7",
   "name": "Plan implementation",
   "icon_hint": "plan",
   "status": "completed",
   "started": "2026-11-27T11:08:32Z",
   "completed": "2026-11-27T11:26:26Z",
   "skip_reason": null,
   "summary": "19 groups / 117 steps / 7 waves; visual coverage 11/11.",
   "decisions": [],
   "risks": [
    "Unrelated uncommitted search changes - do not touch",
    "Bell-path hook regression risk"
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
    "answer": "Tak, równolegle"
   },
   "progress": null
  },
  {
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
   "status": "completed",
   "started": "2026-11-27T11:26:26Z",
   "completed": "2026-11-27T13:05:30Z",
   "skip_reason": null,
   "summary": "19/19 groups done in 7 waves; full suites at baseline except 20 pre-existing MyItemsViewCategory failures from HEAD.",
   "decisions": [],
   "risks": [
    "Proposed copy not in mockups needs product read",
    "AuthLayout subtitle string limits mockup fidelity",
    "ADR replacing handover ADR-009 not written"
   ],
   "artifacts": [
    {
     "path": "implementation/work-log.md",
     "label": "Work log",
     "html": null
    },
    {
     "path": "implementation/implementation-plan.md",
     "label": "Implementation plan",
     "html": "implementation/implementation-plan.html"
    }
   ],
   "gate": {
    "question": "Continue to verification?",
    "answer": "Tak, do weryfikacji"
   },
   "progress": {
    "groups_done": 19,
    "groups_total": 19,
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
   "skip_reason": "Phase 3 not executed (no reproducible defect)",
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
   "started": "2026-11-27T13:05:30Z",
   "completed": "2026-11-27T13:10:28Z",
   "skip_reason": null,
   "summary": "All 4 reviews + E2E + user docs enabled; test suite re-runs (work-log shows baseline failures, not a clean pass).",
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": {
    "question": "Which verifications to run?",
    "answer": "All 4 reviews, E2E yes, user docs yes"
   },
   "progress": null
  },
  {
   "id": "phase-11",
   "name": "Verify implementation & resolve issues",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-27T13:10:28Z",
   "completed": "2026-11-28T04:57:02Z",
   "skip_reason": null,
   "summary": "Final: Passed with Issues, ready for stage 1; W1-W9 fixed, W10-W12 deferred; 0 regressions after 2 fix rounds.",
   "decisions": [],
   "risks": [
    "W10 unverified existing accounts",
    "W11 no retention",
    "W12 no alerting",
    "Proxy real_ip check at deploy"
   ],
   "artifacts": [
    {
     "path": "verification/implementation-verification.md",
     "label": "Implementation verification (final)",
     "html": "verification/implementation-verification.html"
    },
    {
     "path": "verification/test-suite-results-reverify-2.md",
     "label": "Final test suite",
     "html": null
    },
    {
     "path": "verification/code-review-reverify.md",
     "label": "Code review re-check",
     "html": null
    },
    {
     "path": "verification/production-readiness-reverify.md",
     "label": "Production re-check",
     "html": null
    },
    {
     "path": "verification/pragmatic-review-reverify.md",
     "label": "Pragmatic re-check",
     "html": null
    },
    {
     "path": "verification/reality-check.md",
     "label": "Reality check",
     "html": null
    }
   ],
   "gate": {
    "question": "Zamknąć etap 11 i przejść do E2E?",
    "answer": "Tak, przejdź do E2E"
   },
   "progress": null
  },
  {
   "id": "phase-12",
   "name": "Run E2E tests",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-11-28T04:57:02Z",
   "completed": "2026-11-28T11:02:53Z",
   "skip_reason": null,
   "summary": "GO with caveats: 14/14 scenarios pass (1 with issue); 0 critical/major, 1 minor (List-Unsubscribe RFC2047-folded on SMTP), 2 cosmetic.",
   "decisions": [],
   "risks": [
    "resolved: D1 List-Unsubscribe header encoded-word folded by SmtpSender (default EmailMessage policy)",
    "D2 icons below description on verify-email/unsubscribe done screens",
    "D3 English login error (pre-existing)"
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
    "question": "E2E complete — fix D1/D2 or continue?",
    "answer": "Fix D1, then Phase 13"
   },
   "progress": null
  },
  {
   "id": "phase-13",
   "name": "Generate user documentation",
   "icon_hint": "docs",
   "status": "completed",
   "started": "2026-11-28T11:02:53Z",
   "completed": "2026-11-28T11:33:09Z",
   "skip_reason": null,
   "summary": "Polish user guide: verify address, password reset, e-mail settings, unsubscribe, FAQ; 26 screenshots (25 reused from E2E).",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "documentation/user-guide.md",
     "label": "User guide (PL)",
     "html": null
    }
   ],
   "gate": {
    "question": "Docs complete. Continue to Phase 14?",
    "answer": "Yes"
   },
   "progress": null
  },
  {
   "id": "phase-14",
   "name": "Finalize workflow",
   "icon_hint": "done",
   "status": "completed",
   "started": "2026-11-28T11:33:09Z",
   "completed": "2026-11-28T11:33:09Z",
   "skip_reason": null,
   "summary": "Workflow complete; ready for stage-1 deploy. Commit not made (user rule).",
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
  "status": "passed_with_issues",
  "issues": [
   {
    "severity": "warning",
    "category": "W1",
    "description": "Tokens in access logs",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W2",
    "description": "Password >72B 500; bcrypt before claim",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W3",
    "description": "Mailgun 401/403 permanent",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W4",
    "description": "No GET on List-Unsubscribe",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W5",
    "description": "No HTTP rate limit",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W6",
    "description": "Restart mid-send loses T mails",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W7",
    "description": "Normalisation duplicated",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W8",
    "description": "Labels duplicated",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W9",
    "description": "Reset does not revoke JWTs (doc)",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "W10",
    "description": "Existing password accounts unverified (product)",
    "fixable": false,
    "fixed": false
   },
   {
    "severity": "warning",
    "category": "W11",
    "description": "No retention",
    "fixable": false,
    "fixed": false
   },
   {
    "severity": "warning",
    "category": "W12",
    "description": "No alerting",
    "fixable": false,
    "fixed": false
   }
  ],
  "fixes": [
   "Round 1: W1-W9 + info items",
   "Round 2: test regression (fake pause), cooperative stop + requeue + stop_grace_period 25s, 72B on login/families, credential-status set, client.ts simplification, docs real_ip"
  ],
  "reverify_count": 2
 }
};
