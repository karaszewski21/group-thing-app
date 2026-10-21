window.MAISTER_DATA = {
 "generated": "2026-10-21T10:31:31Z",
 "task": {
  "title": "Dołączanie do grupy prywatnej przez kod (zastąpienie 'poproś o dostęp')",
  "type": "development",
  "status": "in_progress",
  "description": "Join PRIVATE groups with a 6-digit organizer code; remove GroupJoinRequest entirely.",
  "path": ".maister/tasks/development/2026-10-21-private-group-join-by-code",
  "current_activity": "Analyzing gaps & clarifying scope"
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
   "status": "in_progress",
   "started": "2026-10-21T10:27:22Z",
   "completed": null,
   "skip_reason": null,
   "summary": "Modificative, medium risk, ui_heavy; 1 critical decision (members who joined by code are invisible to the organizer and cannot be removed) + 9 important decisions with defaults.",
   "decisions": [],
   "risks": [
    "Membership CREATE via code has no organizer READ/DELETE touchpoint (completeness 50%)"
   ],
   "artifacts": [
    {
     "path": "analysis/gap-analysis.md",
     "label": "Gap analysis",
     "html": null
    }
   ],
   "gate": null,
   "progress": null
  },
  {
   "id": "phase-3",
   "name": "Write failing test (TDD Red)",
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
   "id": "phase-4",
   "name": "Generate UI mockups",
   "icon_hint": "spec",
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
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
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
