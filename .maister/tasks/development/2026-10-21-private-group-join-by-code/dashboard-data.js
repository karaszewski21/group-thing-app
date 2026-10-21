window.MAISTER_DATA = {
 "generated": "2026-10-21T12:53:48Z",
 "task": {
  "title": "Dołączanie do grupy prywatnej przez kod (zastąpienie 'poproś o dostęp')",
  "type": "development",
  "status": "in_progress",
  "description": "Join PRIVATE groups with a 6-digit organizer code; remove GroupJoinRequest entirely.",
  "path": ".maister/tasks/development/2026-10-21-private-group-join-by-code",
  "current_activity": "Executing implementation"
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
   "started": "2026-10-21T09:24:47Z",
   "completed": "2026-10-21T10:27:22Z",
   "skip_reason": null,
   "summary": "Removal broad but mechanical; join code reuses join-request helpers; needs 429 plumbing, limiter, optimistic-lock-safe lazy write.",
   "decisions": [
    {
     "decision": "Kopiuj link z kodem → nearest upcoming term via getTerms",
     "rationale": "user clarification"
    },
    {
     "decision": "Lazy GET: catch StaleDataError, rollback, re-read",
     "rationale": "user clarification"
    },
    {
     "decision": "Drop all join-request data",
     "rationale": "no production data"
    }
   ],
   "risks": [
    "Lazy GET can 409 under concurrency (updated_at optimistic lock)",
    "add_active_membership has no uniqueness guard (double submit)",
    "ApiError exposes no headers; 429 minutes must come in the server message"
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
   "started": "2026-10-21T10:27:22Z",
   "completed": "2026-10-21T11:39:16Z",
   "skip_reason": null,
   "summary": "Modificative, medium risk, ui_heavy; 1 critical decision (members who joined by code are invisible to the organizer and cannot be removed) + 9 important decisions with defaults.",
   "decisions": [
    {
     "decision": "Accept invisible/unremovable code-joined members; follow-up",
     "rationale": "design defers removal; no prod data"
    },
    {
     "decision": "ConfirmDeleteDialog + busyLabel/tone props for regenerate",
     "rationale": "additive, keeps z-70 trap"
    },
    {
     "decision": "Panel ModalSheet unchanged",
     "rationale": "pre-existing gap"
    },
    {
     "decision": "Toast owned by JoinCodeCard",
     "rationale": "works on both surfaces"
    },
    {
     "decision": "useCallback + invalidateQueries, no useMutation",
     "rationale": "data-fetching.md"
    },
    {
     "decision": "Double submit: membership re-check + UI busy + one-shot ref",
     "rationale": "matches design"
    },
    {
     "decision": "Organizer redeem → 200 created:false",
     "rationale": "consistent with /access"
    },
    {
     "decision": "useGroupTerms; upcoming = from start of today",
     "rationale": "HomeView convention"
    },
    {
     "decision": "Limiter in app/groups/application/join_code_limiter.py",
     "rationale": "single consumer"
    },
    {
     "decision": "Panel term copy-link unchanged",
     "rationale": "ADR-008 scope"
    }
   ],
   "risks": [
    "Membership CREATE via code has no organizer READ/DELETE touchpoint (completeness 50%)"
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
    "question": "Continue to Phase 4: UI mockup generation?",
    "answer": "Continue to Phase 4"
   },
   "progress": null
  },
  {
   "id": "phase-3",
   "name": "Write failing test (TDD Red)",
   "icon_hint": "verify",
   "status": "skipped",
   "started": null,
   "completed": null,
   "skip_reason": "No reproducible defect (feature work)",
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
   "started": "2026-10-21T11:39:16Z",
   "completed": "2026-10-21T11:42:31Z",
   "skip_reason": null,
   "summary": "6 HTML mockups (gallery http://localhost:3847) bound to the app tokens and krag/panel components.",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "analysis/design-context/INDEX.md",
     "label": "Design index",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/szczeg-y-grupy-z-kart-kodu-organizator.html",
     "label": "Mockup: GroupDetails + JoinCodeCard",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/wpisz-kod-dost-pu-joinbycodesheet.html",
     "label": "Mockup: JoinByCodeSheet",
     "html": null
    }
   ],
   "gate": {
    "question": "UI mockups complete. Continue to Phase 5?",
    "answer": "Continue to Phase 5"
   },
   "progress": null
  },
  {
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-10-21T11:42:31Z",
   "completed": "2026-10-21T11:55:54Z",
   "skip_reason": null,
   "summary": "Spec with 31 requirements; 22 reusable components, 9 new; architecture from research ADRs.",
   "decisions": [
    {
     "decision": "TermPage owns the 'Dołączono do grupy' success toast",
     "rationale": "gate/sheet unmount when membership appears (spec assumption)"
    },
    {
     "decision": "Mockup copy wins over HLD table (card subtitle, confirm title, busyLabel 'Generowanie…')",
     "rationale": "mockups binding"
    }
   ],
   "risks": [
    "ACCEPTED: code-joined members invisible to organizer until RSVP and not removable",
    "Residual brute force ~26%/year; regenerate does not reset it",
    "Accepted DoS of a group's 30/h budget",
    "Single-process limiter",
    "Duplicate memberships mitigated, not prevented"
   ],
   "artifacts": [
    {
     "path": "implementation/spec.md",
     "label": "Specification",
     "html": "implementation/spec.html"
    },
    {
     "path": "analysis/requirements.md",
     "label": "Requirements",
     "html": null
    }
   ],
   "gate": {
    "question": "Continue to specification audit?",
    "answer": "Continue"
   },
   "progress": null
  },
  {
   "id": "phase-6",
   "name": "Audit specification",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-10-21T11:55:54Z",
   "completed": "2026-10-21T12:45:00Z",
   "skip_reason": null,
   "summary": "Audit pass-with-concerns; 21/21 findings resolved in spec rev 2 (R1-R32) with the 6 user decisions.",
   "decisions": [
    {
     "decision": "M1: lazy GET re-reads, retries generation once, else global 409",
     "rationale": "user decision"
    },
    {
     "decision": "M2: TermPage owns ?code= and the sheet",
     "rationale": "user decision"
    },
    {
     "decision": "M3: Kopiuj kod copies raw digits; form noValidate",
     "rationale": "user decision"
    },
    {
     "decision": "M4: host owns useJoinCode/useGroupTerms; JoinCodeCard presentational",
     "rationale": "user decision"
    },
    {
     "decision": "created:false also clears the user limiter key",
     "rationale": "user decision"
    },
    {
     "decision": "AuthGateLinks copy 'Zarejestruj się' wins over mockup",
     "rationale": "user decision"
    }
   ],
   "risks": [
    "M1 lazy GET re-read may see null code / PUBLIC group after concurrent write",
    "M2 ?code= sheet ownership split TermPage vs PrivateGroupGate",
    "M6 theme test lists wrong file",
    "M9 ConfirmDeleteDialog shows raw err.message"
   ],
   "artifacts": [
    {
     "path": "verification/spec-audit.md",
     "label": "Spec audit",
     "html": null
    },
    {
     "path": "implementation/spec.md",
     "label": "Specification (rev 2)",
     "html": "implementation/spec.html"
    }
   ],
   "gate": {
    "question": "Continue to implementation planning?",
    "answer": "Continue"
   },
   "progress": null
  },
  {
   "id": "phase-7",
   "name": "Plan implementation",
   "icon_hint": "plan",
   "status": "completed",
   "started": "2026-10-21T12:45:00Z",
   "completed": "2026-10-21T12:53:48Z",
   "skip_reason": null,
   "summary": "9 groups, 62 steps, ~48-58 tests; waves [1,2,5] → [3,6,7] → [4,8] → [9]; all 8 design IDs covered.",
   "decisions": [
    {
     "decision": "Migration 0060 ships in group 4, not group 1",
     "rationale": "/access and the Notification model read the old schema until group 4"
    },
    {
     "decision": "Group 3 adds join code alongside old code; group 4 removes old code",
     "rationale": "keeps shared backend files sequential"
    },
    {
     "decision": "Frontend groups do not wait for backend",
     "rationale": "API mocked; spec is the contract"
    }
   ],
   "risks": [
    "Test count (~48-58) above the generic guide; set by the spec"
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
    "answer": "Continue (parallel waves)"
   },
   "progress": null
  },
  {
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
   "status": "in_progress",
   "started": "2026-10-21T12:53:48Z",
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-9",
   "name": "Verify test passes (TDD Green)",
   "icon_hint": "verify",
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
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
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-11",
   "name": "Verify implementation & resolve issues",
   "icon_hint": "verify",
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-12",
   "name": "Run E2E tests",
   "icon_hint": "verify",
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-13",
   "name": "Generate user documentation",
   "icon_hint": "docs",
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-14",
   "name": "Finalize workflow",
   "icon_hint": "done",
   "status": "pending",
   "started": null,
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": null
  }
 ],
 "verification": {
  "status": null,
  "issues": [],
  "fixes": [],
  "reverify_count": 0
 }
};
