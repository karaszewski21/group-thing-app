window.MAISTER_DATA = {
 "generated": "2026-10-21T11:42:31Z",
 "task": {
  "title": "Dołączanie do grupy prywatnej przez kod (zastąpienie 'poproś o dostęp')",
  "type": "development",
  "status": "in_progress",
  "description": "Join PRIVATE groups with a 6-digit organizer code; remove GroupJoinRequest entirely.",
  "path": ".maister/tasks/development/2026-10-21-private-group-join-by-code",
  "current_activity": "Gathering requirements & creating specification"
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
   "status": "in_progress",
   "started": "2026-10-21T11:42:31Z",
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
   "id": "phase-6",
   "name": "Audit specification",
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
   "id": "phase-7",
   "name": "Plan implementation",
   "icon_hint": "plan",
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
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
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
