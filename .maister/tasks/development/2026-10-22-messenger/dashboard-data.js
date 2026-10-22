window.MAISTER_DATA = {
 "generated": "2026-10-22T11:38:48Z",
 "task": {
  "title": "Komunikator (messenger)",
  "type": "development",
  "status": "in_progress",
  "description": "Messenger-like chat: questions from product pages; organizer messages to group and term.",
  "path": ".maister/tasks/development/2026-10-22-messenger",
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
   "started": "2026-10-22T07:47:21Z",
   "completed": "2026-10-22T08:06:20Z",
   "skip_reason": null,
   "summary": "No messaging exists; new app/messaging BC recommended. 5 clarifications resolved.",
   "decisions": [
    {
     "decision": "Group/term = group chat",
     "rationale": "user"
    },
    {
     "decision": "Group chat = members; term chat = term attendees",
     "rationale": "user"
    },
    {
     "decision": "Polling delivery",
     "rationale": "user"
    },
    {
     "decision": "Bielik moderation only",
     "rationale": "user"
    },
    {
     "decision": "Full history, dynamic participants",
     "rationale": "user"
    }
   ],
   "risks": [
    "No public groups-service functions for organizer/audience/attendees",
    "Item page has no owner identity",
    "N+1 / optimistic-lock risks"
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
   "started": "2026-10-22T08:06:20Z",
   "completed": "2026-10-22T09:17:24Z",
   "skip_reason": null,
   "summary": "Additive new BC, medium risk, ui_heavy; 3 critical + 12 important decisions.",
   "decisions": [
    {
     "decision": "Group chat for PRIVATE groups only",
     "rationale": "public groups have no Memberships"
    },
    {
     "decision": "Chat buttons on the term page for members/attendees",
     "rationale": "no member group list"
    },
    {
     "decision": "Inbox badge only, no bell rows",
     "rationale": "bell 50-cap; no fan-out"
    },
    {
     "decision": "Inbox icon beside the bell",
     "rationale": "visible everywhere"
    },
    {
     "decision": "Text only, 1000 chars",
     "rationale": "user"
    },
    {
     "decision": "30 msgs/min, 20 new item convs/h",
     "rationale": "join_code_limiter template"
    },
    {
     "decision": "Lazy create by any participant",
     "rationale": "no organizer dead end"
    },
    {
     "decision": "Polling badge 20s, thread 5s",
     "rationale": "useItemDetail pattern"
    }
   ],
   "risks": [
    "PUBLIC groups have no Memberships → group chat audience organizer-only",
    "No member-facing navigation to group features",
    "Dynamic audiences make inbox/unread queries heavier"
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
   "started": "2026-10-22T09:17:24Z",
   "completed": "2026-10-22T09:21:00Z",
   "skip_reason": null,
   "summary": "7 HTML mockups (gallery http://localhost:3847).",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "analysis/design-context/INDEX.md",
     "label": "Design index",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/rozmowa-o-rzeczy.html",
     "label": "Mockup: item thread",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/skrzynka-wiadomo-ci.html",
     "label": "Mockup: inbox",
     "html": null
    }
   ],
   "gate": {
    "question": "Mockups complete. Continue to Phase 5?",
    "answer": "Continue to Phase 5"
   },
   "progress": null
  },
  {
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-10-22T09:21:00Z",
   "completed": "2026-10-22T10:38:03Z",
   "skip_reason": null,
   "summary": "Spec: 38 requirements; new messaging BC with 9 endpoints, inbox/thread/4 entry points.",
   "decisions": [
    {
     "decision": "No participant table; access computed per request",
     "rationale": "decision (e)"
    },
    {
     "decision": "Inbox shows only conversations with ≥1 message (newest 100)",
     "rationale": "empty threads hidden"
    },
    {
     "decision": "Mark-read by message_id with GREATEST",
     "rationale": "no swallowed messages"
    },
    {
     "decision": "Initials avatars only",
     "rationale": "no other users' photos exposed"
    }
   ],
   "risks": [
    "Late joiners start with full history unread",
    "Organizer change transfers history",
    "Per-worker limiter; moderation latency"
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
   "started": "2026-10-22T10:38:03Z",
   "completed": "2026-10-22T11:00:14Z",
   "skip_reason": null,
   "summary": "Audit pass-with-concerns; all 23 findings resolved in spec rev 2 (42 requirements).",
   "decisions": [
    {
     "decision": "ITEM thread unique per (item, asker, owner): new owner → new thread",
     "rationale": "user decision"
    },
    {
     "decision": "PRIVATE→PUBLIC: group chat read-only (read_only_reason GROUP_PUBLIC)",
     "rationale": "user decision"
    },
    {
     "decision": "Per-conversation FOR UPDATE lock on send → commit order = cursor order",
     "rationale": "M8: no missed messages"
    },
    {
     "decision": "Timestamps parsed dayjs.utc().local(); formats pinned",
     "rationale": "H2"
    },
    {
     "decision": "Member/audience checks include soft-deleted groups",
     "rationale": "H1"
    }
   ],
   "risks": [
    "H1 soft-deleted group members get 403",
    "H2 timestamps not parsed as UTC",
    "M8 after= polling can miss out-of-order commits",
    "Owner change routes re-ask to old owner",
    "PRIVATE→PUBLIC toggle hides group chat"
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
   "started": "2026-10-22T11:00:14Z",
   "completed": "2026-10-22T11:38:48Z",
   "skip_reason": null,
   "summary": "10 groups, 73 steps; waves [1,2,6] → [3,7,9] → [4,8] → [5] → [10]; all 10 design IDs covered.",
   "decisions": [
    {
     "decision": "Backend API split into groups 4 and 5",
     "rationale": "2-8 tests per group"
    },
    {
     "decision": "Frontend builds against spec contract with mocked API",
     "rationale": "parallel waves"
    }
   ],
   "risks": [
    "~50-74 tests above guideline",
    "FE/BE contract drift",
    "mypy around on_conflict_do_update/func.greatest"
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
    "answer": "Current branch, parallel"
   },
   "progress": null
  },
  {
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
   "status": "in_progress",
   "started": "2026-10-22T11:38:48Z",
   "completed": null,
   "skip_reason": null,
   "summary": null,
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": null,
   "progress": {
    "groups_done": 0,
    "groups_total": 10,
    "current_wave": 1,
    "skipped": [],
    "reverted": []
   }
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
