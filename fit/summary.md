# Archetype Scan: Rodzinny grajdołek

## Quick View

| Archetype | Fit | Core Reason |
|-----------|-----|--------------|
| party | ✅ | Domain is fundamentally relational (who leads/joins/lends to whom) with identity-vs-role already flagged as an anti-pattern in the source doc; no ledger of quantities, no pricing. |
| accounting | ❌ | No accumulating, consumable, queryable-balance value — entities move through discrete states (active/cancelled, borrowed/returned), not quantities that are earned/spent/reversed. |
| pricing | ❌ | Explicit barter/exchange system with no monetary or computed value anywhere; nothing to price. |

## Matched Archetypes

### party ✅

**What matched**: The domain fails both the accounting test ("how much X does S have?") and the pricing test ("how much does X cost?"), but strongly passes the party test — the interesting questions are relational: who organizes which group, who is a guest in which group with which child, who lent an item to whom and for how long. The source doc itself already flags the identity-is-not-role anti-pattern (organizer and guest `Profile` objects are separate, unlinked records that should be one `User`/`Person` read through two roles), which is the textbook signal for this archetype. Relationships also carry their own lifecycle rather than being plain foreign keys: `GroupMembership` (active/cancelled, joined_at), `BorrowRecord` (active/returned, borrowed_at/returned_at, with two-sided confirmation floated as a future improvement), and `BringClaim` (a responsibility assignment).

**Domain value / key entities**: `Person` (unifying today's split `User`/`Profile` per role), `Group`, and three lifecycle-bearing relationships — `leads` (Organizer → Group), `membership` (Guest → Group, carrying child_name/child_age as attributes), and `borrowing` (Person → Person, sub-typed by source: pożyczone/otrzymane/zamienione). A fourth, lighter relationship — `bring_claim` — extends the archetype from Party↔Party to Party↔Resource (Guest → TermNeededItem).

**Key decisions surfaced**:
1. **Unify identity across roles**: collapse the two disconnected `Profile` objects (organizer panel, guest panel) into a single `Person` party holding independent `PartyRole` rows (Organizer, Guest), rather than a fixed `role` enum column that forks identity.
2. **Role concurrency assumption (X)**: a Person can hold both Organizer and Guest roles simultaneously (e.g., an organizer who also enrolls their own child elsewhere) — not confirmed interactively, flagged as a domain-informed default.
3. **`leads` promoted from plain FK to a full Relationship (X)**, on the assumption that group leadership could transfer (substitute instructor, handoff); if leadership is truly permanent, `Group.organizer_id` can stay a plain FK instead.
4. **Child modeled as an attribute, not a Party (assumption)**: `GroupMembership.child_name`/`child_age` stay flat fields rather than promoting Child to its own `Person` party — deliberate simplification given no requirement for child logins, multiple guardians, or independent child history. Flagged as revisitable.
5. **`borrowing` termination is one-sided today**; the doc itself recommends two-sided confirmation (guest reports return → owner confirms) as a future direction, carried into the model as a recommendation rather than a confirmed requirement.

## Domain Concept Distribution

| Domain Concept | Archetype(s) | Role |
|----------------|--------------|------|
| `User` | party | Party (Person) — identity, should be one record across roles |
| `User.role` | party | PartyRole / RoleType — the anti-pattern being corrected (fixed enum → independent role rows) |
| `Profile` (organizer + guest, currently split) | party | Attributes of Party (Person) — should merge into one Profile per Person |
| `GalleryPhoto` | party | Attribute collection of Party (Profile) — plain owned collection, not itself a party/relationship |
| `Group` | party | Party (Group) — collective actor, target of `leads` and `membership` |
| `GroupMembership` | party | Relationship: `membership` (Guest ↔ Group), with lifecycle (active/cancelled, joined_at) |
| Child (implicit — `child_name`/`child_age` fields) | party | ⚠️ Unmapped as its own Party — modeled as attributes of `membership` (assumption); would become a `Person` Party + `guardianship` relationship if requirements ever need shared guardianship or child-specific history |
| `Term` | party (partial) | Resource owned by Group, not a Party itself — scheduling mechanics not covered by any archetype (see Gaps) |
| `TermNeededItem` | party (partial) | Resource/need-slot linked to a Term, not a Party — target side of the `bring_claim` extension |
| `BringClaim` | party | Relationship: `bring_claim` (Party → Resource) — a light extension beyond strict Party↔Party scope, flagged explicitly |
| `Item` | party | Resource owned by a Party via plain reference (`owner_id`); ownership itself has no independent lifecycle, so it stays a FK, not a Relationship |
| `Item.mode` (wypożyczę/oddam/zamienię) | — | Attribute of Item; not party-relevant, not covered by any archetype |
| `BorrowRecord` | party | Relationship: `borrowing` (Person ↔ Person), asymmetric, sub-typed by `source`, with lifecycle |
| `Settings.email_notifications`/`sms_notifications` | party | Implies ContactMechanism types (email confirmed; phone implied but ⚠️ has no backing field anywhere — gap) |
| `Settings.public_profile` | party | Attribute of Party (Profile visibility) |
| Nawigacja / role switch (`App.tsx`) | — | ⚠️ Explicitly out of scope for all archetypes — an access/session concern (not real authentication), not a business-role concept |

## Overlaps

No concept was independently claimed by two archetypes. `Term` and `TermNeededItem` are touched only partially by party (as resources owned by / linked to a Party) but are not fully modeled by any archetype — see Gaps rather than Overlaps. `BringClaim` is a controlled extension of party (Party→Resource instead of strict Party→Party) rather than a genuine overlap with another archetype, since accounting and pricing were both rejected outright.

## Gaps

- **Term / TermNeededItem scheduling mechanics** — no archetype covers *how* a Term is scheduled, how `TermNeededItem` entries are generated per Term, or what happens to open `BringClaim`s when a Term passes unclaimed. Party only tells us these are non-Party resources; it says nothing about the scheduling workflow itself. This looks like plain CRUD/state-machine territory, not a value-flow or party-relationship problem. **Next step**: run `problem-classifier` on the Term/TermNeededItem/BringClaim lifecycle specifically, or model it directly as a small state machine (need created → open → claimed → fulfilled/expired) since it doesn't need a dedicated archetype.
- **Child as attribute vs. Party** — flagged as an open assumption (X) in the party mapping: today Child is flat data on `GroupMembership`, but this is a genuine design fork (single vs. shared guardianship, child-specific history across groups) that no archetype resolves on its own — it's a scope/requirements question, not an archetype-fit question. **Next step**: interactive follow-up with the domain owner, or re-run `party-archetype-mapper` in interactive mode specifically on this fork once the guardianship requirement is clarified.
- **Declarative/unverified borrow-return workflow** — `BorrowRecord` termination today is one-sided (recipient/owner flips status with no counter-confirmation), which the source doc itself calls out as an intentional but unverified trust-based design. Party captures this as a relationship validity/termination note but does not decide whether two-sided confirmation is actually required. **Next step**: treat as a `problem-classifier` question (is this Resource Contention — competing claims on returning custody — or plain CRUD?) before committing to a two-sided confirmation state machine.
- **Phone contact mechanism gap** — `Settings.sms_notifications` implies a `phone` field that does not exist anywhere in the current model. Party flags this but doesn't originate the requirement. **Next step**: direct modeling fix (add `phone` to `Person`/`Profile`) once confirmed as in-scope; no archetype re-scan needed.
- **Authentication vs. business role** — the `App.tsx` role switch is explicitly not real authentication. No archetype models access control; party only models `Organizer`/`Guest` as business roles. **Next step**: out of scope for domain modeling entirely — belongs to a separate technical/authorization design pass, not a re-run of any archetype mapper.

## Archetype Rejection Reasons

- **accounting**: No value accumulates, is consumed, or is queryable as a balance with transaction history — Groups, Terms, Items, and BorrowRecords move through discrete states (active/cancelled, borrowed/returned) rather than tracked quantities; even `Group.free_spots` is a single decrementing capacity field, not a ledger.
- **pricing**: The domain is an explicit barter/exchange system (borrowing, gifting, swapping children's items) with no monetary or computed value anywhere — items and enrollment are free, and the natural question is "what state is this in?", not "how much does X cost?".
