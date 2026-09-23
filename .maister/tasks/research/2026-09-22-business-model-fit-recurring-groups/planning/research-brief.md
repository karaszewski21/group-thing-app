# Research Brief: Business Model Fit + Recurring-Group-from-Session Design

## Research Question

Does the current group-thing-app data model and UX cover these four target
use cases, and what gaps exist / what new approach should be taken (PoC
stage, free to redesign)?

1. **Ad-hoc music classes**: anyone signs up to a single session via a
   shared link; no fixed members; different people each time. Organizer
   needs a way to later "promote" a session into a standing/recurring
   group (with ability to add more people afterward). Example: Kasia
   starts out with no regular clients, runs first sessions ad-hoc; over
   time a recurring group of attendees forms, and she wants to convert
   that into a proper standing group she can still add people to.
2. **Family gatherings** (Christmas Eve dinner, parties): fixed, known
   members.
3. **Teacher's class**: fixed members (students).
4. **Football coach's team**: fixed members — players and their parents.

## Research Type

Mixed (technical codebase analysis + requirements/business-fit analysis).

## Scope

**Included**:
- Current groups/circles ("kręgi") domain model, backend and frontend
- Membership semantics: fixed membership vs per-term/ad-hoc signup
- Public signup flow for a single term/session (link-based, no login)
- Group visibility/privacy (recent work: layout_mode, visibility migrations
  0035/0036)
- Any existing or missing path from "attendees of a term" → "standing
  group membership"

**Excluded**:
- Payments/billing
- Notification/email delivery internals
- OAuth2 authorization server internals unrelated to group membership

**Constraints**:
- App is PoC stage: no backward-compatibility requirement, new domain
  concepts/models can be introduced freely
- Any backend redesign proposal must be checked against
  `.maister/docs/standards/backend/models.md` (SQLAlchemy conventions,
  DDD layering) at implementation time — not necessarily during research

## Success Criteria

- Clear mapping of which of the 4 use cases the current model already
  supports, partially supports, or does not support at all, with evidence
  (file/line citations)
- Explicit identification of the missing capability: converting an ad-hoc
  session's attendee list into a standing group ("krąg") membership
- At least one concrete alternative domain-model/UX approach for the
  promotion flow, with trade-offs, feeding into optional brainstorming/
  design phases
