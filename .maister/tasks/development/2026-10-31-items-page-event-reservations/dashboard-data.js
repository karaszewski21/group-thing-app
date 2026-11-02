window.MAISTER_DATA = {
 "generated": "2026-10-31T17:15:43Z",
 "task": {
  "title": "Owner items page, attendee items on event/term pages, event item reservations",
  "type": "development",
  "status": "completed",
  "description": "1) New items list page for reviewing a user's/organizer's items: user at /<user-id>/items, organizer at /<organization-slug>/items. The items page also shows the owner's nearest upcoming term where one can come to pick up/swap; if the owner has no future terms, only chat is possible. 2) Event and term pages - \"Signed up and their items\" - show 3 most recently added items with \"Show more\" and a link to the item page. The item page accepts ?term=<term-id> and ?event=<event-id> params and shows take / swap buttons to reserve the item, plus \"write\" (chat). 3) Implement item reservation on an event.",
  "path": ".maister/tasks/development/2026-10-31-items-page-event-reservations",
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
   "started": "2026-10-31T08:36:57Z",
   "completed": "2026-10-31T09:01:37Z",
   "skip_reason": null,
   "summary": "Part 2 half built (3-item toggles exist on event+term pages; missing recency order, show-more link, ?term/?event links). Part 1 needs a new public owner-items endpoint (party-id lookup; k- slugs are one-way). Part 3 is the main risk: Reservation.term_id NOT NULL needs migration 0073 (term_id nullable + event_id + CHECK) and ~11 term_id readers need an event branch.",
   "decisions": [
    {
     "decision": "Reservation context is Term XOR Event at the DB level (nullable term_id + event_id + CHECK)",
     "rationale": "smallest schema change keeping term reservations intact"
    },
    {
     "decision": "Add a reservation-context abstraction (Term | Event) in groups rather than duplicating take/swap in app/events",
     "rationale": "SwapProposal, accept/reject, confirm/cancel all live in groups"
    },
    {
     "decision": "Event eligibility = author or active attendee with an account",
     "rationale": "guests have no account_user_id; reserved_by_user_id NOT NULL"
    },
    {
     "decision": "Use party id for /<user-id>/items",
     "rationale": "k- slugs are irreversible; party_id already public on event participants"
    },
    {
     "decision": "Newest-first via ItemListingPreference.created_at DESC with row_number() cap",
     "rationale": "keeps event page query count constant"
    },
    {
     "decision": "Extract one shared 3-items + show-more component",
     "rationale": "AttendeeList and EventAttendeeList are near-duplicates"
    }
   ],
   "risks": [
    "Item page access: /details requires READ and item routes are behind AuthGuard; anonymous access to listed items is not implemented",
    "Owner chat without an item: no DIRECT/PARTY conversation kind exists",
    "Nearest term for a regular user has no owned terms (attendances? events?)",
    "Event swap timing: starts_at vs ends_at gates confirm/cancel",
    "Withdrawal/event deletion do not cancel reservations",
    "Reverses the 2026-10-29 event-page decision 'Items: read-only; no take/swap'"
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
    "question": "Clarifications (4)",
    "answer": "Public item page for ACTIVE; per-item chat; terms+events for nearest date; event reservations gated on starts_at"
   },
   "progress": null
  },
  {
   "id": "phase-2",
   "name": "Analyze gaps & clarify scope",
   "icon_hint": "analysis",
   "status": "completed",
   "started": "2026-10-31T09:01:37Z",
   "completed": "2026-10-31T09:59:55Z",
   "skip_reason": null,
   "summary": "Parts 1-2 are additive/small; Part 3 is the main risk — event reservations would be orphaned (no confirm/cancel, no hand-over prompt, wrong item status) unless every term_id reader gets an event branch. Lifecycle completeness for event reservations is 25%.",
   "decisions": [
    {
     "decision": "Event delete cancels open reservations and notifies both sides",
     "rationale": "user choice over blocking delete"
    },
    {
     "decision": "Extend term_end_scan to events past starts_at, reusing TERM_CONFIRMATION_NEEDED",
     "rationale": "avoid orphaned open reservations"
    },
    {
     "decision": "Nearest date only from PUBLIC circles + events",
     "rationale": "do not leak private meetings"
    },
    {
     "decision": "Items-page cards carry owner's nearest ?term/?event (option A)",
     "rationale": "single URL-driven context logic on item page"
    },
    {
     "decision": "Ineligible viewer sees Zapisz się CTA + Napisz",
     "rationale": "no doomed 409 clicks"
    },
    {
     "decision": "Pokaż więcej links to /<owner>/items with context; shared preview component",
     "rationale": "removes duplicated toggles"
    },
    {
     "decision": "Keep inline term take buttons; item names link with ?term=",
     "rationale": "no regression on term page"
    },
    {
     "decision": "Allow editing event starts_at with open reservations",
     "rationale": "gates read starts_at live like terms"
    },
    {
     "decision": "Party id in /<user-id>/items; org owner's party-id URL redirects to slug",
     "rationale": "party id already public; one canonical org URL"
    },
    {
     "decision": "Reuse existing notification kinds with event wording/link",
     "rationale": "no enum churn"
    }
   ],
   "risks": [
    "Migration 0073: Reservation.term_id NOT NULL -> nullable + event_id + CHECK exactly one; ~11 readers need an event branch",
    "Previous event-page task declared event items read-only; docs and tests must be reversed"
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
   "started": "2026-10-31T09:59:55Z",
   "completed": "2026-10-31T10:08:22Z",
   "skip_reason": null,
   "summary": "11 HTML mockups (format html, live gallery http://localhost:3847) bound to index.css tokens: owner items page (nearest date / chat-only), participants preview, 7 item-page action states, event-delete confirmation.",
   "decisions": [],
   "risks": [],
   "artifacts": [
    {
     "path": "analysis/design-context/INDEX.md",
     "label": "Design index",
     "html": null
    },
    {
     "path": "analysis/design-context/mockups/owner-items-page-nearest-term.html",
     "label": "Mockup: owner items page",
     "html": null
    }
   ],
   "gate": {
    "question": "Mockups approved? Continue to Phase 5",
    "answer": "Approved"
   },
   "progress": null
  },
  {
   "id": "phase-5",
   "name": "Gather requirements & create specification",
   "icon_hint": "spec",
   "status": "completed",
   "started": "2026-10-31T10:08:22Z",
   "completed": "2026-10-31T13:29:29Z",
   "skip_reason": null,
   "summary": "31 requirements: owner items page (slug/party-id), shared 3-newest preview, public item page with context actions, event reservations end-to-end (migration 0073, ReservationContext, event scan, cancel-on-delete), EXCHANGE recent-items block.",
   "decisions": [
    {
     "decision": "0073: at most one of term_id/event_id; open reservations need exactly one; event_id ON DELETE SET NULL",
     "rationale": "keep cancelled/fulfilled rows linked from circulation_entries after event hard-delete"
    },
    {
     "decision": "0073 downgrade refuses while reservations with term_id IS NULL exist",
     "rationale": "deleting ledger-linked rows unsafe"
    },
    {
     "decision": "New notification kind RESERVATION_CANCELLED for event-deletion cancellations",
     "rationale": "user choice at Phase 5 gate; take/swap/confirm keep existing kinds"
    },
    {
     "decision": "End-of-event prompt at starts_at + 2h",
     "rationale": "same grace as terms"
    },
    {
     "decision": "recent-items block after exchange-board in EXCHANGE layout",
     "rationale": "user: EXCHANGE only for now"
    }
   ],
   "risks": [
    "groups<->events ACL import cycle; keep imports inside ACL functions",
    "Each of ~11 term_id readers needs an event test; a missed one gives 500 or wrong status",
    "Several strict key-set tests change on purpose"
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
    },
    {
     "path": "analysis/technical-clarifications.md",
     "label": "Technical clarifications",
     "html": null
    }
   ],
   "gate": {
    "question": "Spec ready; 0073 SET NULL ok?; notification kind?; continue to audit?",
    "answer": "SET NULL accepted; add RESERVATION_CANCELLED; continue"
   },
   "progress": null
  },
  {
   "id": "phase-6",
   "name": "Audit specification",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-10-31T13:29:29Z",
   "completed": "2026-10-31T14:02:09Z",
   "skip_reason": null,
   "summary": "Verdict FAIL (spec-fixable): 1 critical, 3 high, 7 medium, 8 low. C1 SwapAcceptSuccessSheet/TakeSuccessSheet term readers; H1 ACL import cycles; H2 no non-committing bulk cancel; H3 contextless reservations break confirm/cancel.",
   "decisions": [],
   "risks": [
    "resolved: C1: SwapAcceptSuccessSheet/TakeSuccessSheet need termId/groupId — missed readers",
    "resolved: H1: groups/circulation→events ACL import cycles",
    "resolved: H2: no non-committing circulation cancel for delete_event transaction",
    "resolved: H3: SET NULL reservations make confirm/cancel 404/500 instead of 409"
   ],
   "artifacts": [
    {
     "path": "verification/spec-audit.md",
     "label": "Spec audit",
     "html": null
    }
   ],
   "gate": {
    "question": "Audit FAIL — how to proceed? (+ delete after start, signed-up block)",
    "answer": "Fix spec and continue; block delete after start; keep signed-up block"
   },
   "progress": null
  },
  {
   "id": "phase-7",
   "name": "Plan implementation",
   "icon_hint": "plan",
   "status": "completed",
   "started": "2026-10-31T14:02:09Z",
   "completed": "2026-10-31T14:13:17Z",
   "skip_reason": null,
   "summary": "18 task groups / 105 steps in 5 waves (1:{1,2,4} 2:{3,5,6,10} 3:{7,8,9,11,13} 4:{12,14,15,16} 5:{17,18}); critical path 1→5→7→14→17; visual coverage 13/13.",
   "decisions": [
    {
     "decision": "events_acl written in full in group 1",
     "rationale": "consumers 3/5/7/8 do not serialize on it"
    },
    {
     "decision": "All authorization-matrix rows in standalone group 2",
     "rationale": "one file, one owner"
    },
    {
     "decision": "Delete tests in tests/test_event_reservation_delete.py",
     "rationale": "groups 5 and 9 work independently"
    },
    {
     "decision": "Both ?term and ?event present → no-context view",
     "rationale": "avoid endpoint 400"
    }
   ],
   "risks": [
    "~13 context readers must each get event coverage",
    "term regression gate after refactoring term_item_listings.py (951 lines)",
    "import-cycle discipline (subprocess import guard in group 1)",
    "atomic single commit in delete_event",
    "shared files force serialization within waves (groups/schemas.py, router.tsx, api/events.ts...)"
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
    "answer": "Yes, parallel waves"
   },
   "progress": null
  },
  {
   "id": "phase-8",
   "name": "Execute implementation",
   "icon_hint": "code",
   "status": "completed",
   "started": "2026-10-31T14:13:17Z",
   "completed": "2026-10-31T15:35:07Z",
   "skip_reason": null,
   "summary": "18/18 groups, 105 steps. Backend 1027 passed (+1 budget regression fixed); frontend 1295 passed, 13 failing all pre-existing on HEAD (1 flaky); tsc clean.",
   "decisions": [
    {
     "decision": "owner display_name = Organization name when owner has one",
     "rationale": "user confirmed at Phase 8 gate"
    },
    {
     "decision": "RESERVATION_CANCELLED wording kept as implemented",
     "rationale": "user confirmed at Phase 8 gate"
    },
    {
     "decision": "Organizer page statement budget raised 10→11",
     "rationale": "one added recent-items select; count stays constant"
    }
   ],
   "risks": [
    "Pre-existing frontend failures (12) on HEAD: auth, extension-points, foundation, PublicLayout, AppPage add-term, PendingActionsHost GIFT, TermPage sign-up",
    "Product choices to confirm: owner display_name = Organization name; RESERVATION_CANCELLED wording; copy deviations on item page"
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
    "question": "display_name? notification wording? continue to verification?",
    "answer": "Organization name; keep wording; continue"
   },
   "progress": {
    "groups_done": 18,
    "groups_total": 18,
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
   "skip_reason": "Phase 3 not run (no reproducible defect)",
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
   "started": "2026-10-31T15:35:07Z",
   "completed": "2026-10-31T15:36:36Z",
   "skip_reason": null,
   "summary": "All 4 standard reviews + E2E + user docs enabled; full test suite will run.",
   "decisions": [],
   "risks": [],
   "artifacts": [],
   "gate": {
    "question": "Which verifications?",
    "answer": "Code, pragmatic, reality, production; E2E yes; docs yes"
   },
   "progress": null
  },
  {
   "id": "phase-11",
   "name": "Verify implementation & resolve issues",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-10-31T15:36:36Z",
   "completed": "2026-10-31T16:16:08Z",
   "skip_reason": null,
   "summary": "Passed with issues (post-fix): 0 critical; W1–W9 fixed; W10 rate limiting open (out of scope); 13 pre-existing frontend failures; re-verification skipped by user.",
   "decisions": [],
   "risks": [
    "W10: no rate limit on new anonymous endpoints (platform follow-up)",
    "Full re-verification skipped after fixes (targeted tests only)",
    "13 pre-existing frontend failures on HEAD"
   ],
   "artifacts": [
    {
     "path": "verification/implementation-verification.md",
     "label": "Verification report",
     "html": "verification/implementation-verification.html"
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
    }
   ],
   "gate": {
    "question": "Continue to Phase 12 E2E?",
    "answer": "Yes"
   },
   "progress": null
  },
  {
   "id": "phase-12",
   "name": "Run E2E tests",
   "icon_hint": "verify",
   "status": "completed",
   "started": "2026-10-31T16:16:08Z",
   "completed": "2026-10-31T16:56:00Z",
   "skip_reason": null,
   "summary": "GO with caveats: 6/6 journeys PASS, 13/13 scenarios passed; 0 critical/major, 2 minor, 4 cosmetic; visual fidelity 3 match / 10 minor / 0 drift.",
   "decisions": [],
   "risks": [
    "Minor: owner items chips drop date when page context ≠ owner's nearest",
    "Minor: /parties/{id}/items 404 for party with no AVAILABLE listed items (intended per W2 decision)",
    "Cosmetic: item page lacks Oddam/Zamienię mode chip; delete dialog centred not bottom sheet; two pickup dates on EXCHANGE page"
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
    "question": "Fix E2E minor issues?",
    "answer": "No, continue"
   },
   "progress": null
  },
  {
   "id": "phase-13",
   "name": "Generate user documentation",
   "icon_hint": "docs",
   "status": "completed",
   "started": "2026-10-31T16:56:00Z",
   "completed": "2026-10-31T17:15:43Z",
   "skip_reason": null,
   "summary": "Polish user guide covering all 5 topics, 17 reused E2E screenshots; confirmation reminder and disabled delete described in text only.",
   "decisions": [],
   "risks": [
    "Hand-over confirmation location described generically (bell) — verify against UI"
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
    "answer": "Yes"
   },
   "progress": null
  },
  {
   "id": "phase-14",
   "name": "Finalize workflow",
   "icon_hint": "done",
   "status": "completed",
   "started": "2026-10-31T17:15:43Z",
   "completed": "2026-10-31T17:15:43Z",
   "skip_reason": null,
   "summary": "Workflow complete; all declared artifacts present; commit pending (user).",
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
    "category": "code_review",
    "description": "W1: event FOR SHARE lock released by commits in create/confirm; accept/reject load proposal unlocked; concurrent delete → StaleDataError 500 / stuck PROPOSED",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W2: anonymous sees owner display_name + party_id via /actions and /parties/{id}/items",
    "fixable": false,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W3: take/propose does not invalidate OWNER_ITEMS_KEY / EVENT_KEY / organizer page",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "code_review",
    "description": "W4: hard-coded item-actions/itemDetails query keys",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "completeness",
    "description": "W5: owner_items.py imports Organization model bypassing organizations_acl",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W6: 5 mode-label maps for 2 modes",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W7: owner-summary logic duplicated",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "pragmatic",
    "description": "W8: kind casing mapper boilerplate",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W9: 0073 lacks SET LOCAL lock_timeout",
    "fixable": true,
    "fixed": true
   },
   {
    "severity": "warning",
    "category": "production",
    "description": "W10: no rate limit on new anonymous endpoints (platform-wide)",
    "fixable": false,
    "fixed": false
   }
  ],
  "fixes": [
   {
    "issue": "W1",
    "fix": "commit=False flush-only create/confirm/cancel; use cases commit once; proposal locked FOR UPDATE with status re-check (409) in accept/reject; lock order event→proposal; also applies to terms"
   },
   {
    "issue": "W2",
    "fix": "/parties/{id}/items → 404 when party has no listed items"
   },
   {
    "issue": "W3",
    "fix": "useItemTake invalidates owner-items, event, organizer page keys"
   },
   {
    "issue": "W4",
    "fix": "exported ITEM_DETAILS_KEY; imports instead of literals"
   },
   {
    "issue": "W5",
    "fix": "Organization via organizations_acl"
   },
   {
    "issue": "W6",
    "fix": "label maps consolidated in termLabels.ts"
   },
   {
    "issue": "W7",
    "fix": "owner_summary helper shared by owner_items and item_actions"
   },
   {
    "issue": "W8",
    "fix": "single itemContextKind mapper"
   },
   {
    "issue": "W9",
    "fix": "SET LOCAL lock_timeout = '5s' in 0073 upgrade"
   },
   {
    "issue": "info",
    "fix": "error view shows message; dead ListingRowVM fields removed; NearestHint event wording; ReservationDetailResponse docstring"
   }
  ],
  "reverify_count": 0
 }
};
