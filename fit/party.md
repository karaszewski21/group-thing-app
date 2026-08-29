---
archetype: party
fit: true
---

# Party Archetype Model: Rodzinny grajdołek

## Fit Rationale

The domain fails the "how much X does S have?" test (accounting) and the "how much does X cost?" test
(pricing) — there is no ledger of quantities and no price calculation anywhere. It also is not a pure
state machine: the interesting questions are relational — *who* is the organizer of *which* group, *who*
is a guest in *which* group with *which* child, *who* lent an item to *whom* and for how long.

Two strong signals confirm the fit:

1. **Identity-is-not-role smell, already flagged by the project's own docs.** Section 5 explicitly says
   `Profile`/`Item`/`Term` exist today as two separate, unrelated objects on the organizer panel and the
   guest panel, and that "w realnym systemie to jeden rekord `User`, czytany przez obie strony przez API."
   This is exactly the anti-pattern the Party archetype exists to fix: `role` should not fork identity —
   a single `Person` should be able to hold an `Organizer` role, a `Guest` role, or both, without being
   two different database rows.
2. **Relationships with their own lifecycle**, not plain foreign keys:
   - `GroupMembership` — status (`active`/`cancelled`), `joined_at` — a guest's membership in a group.
   - `BorrowRecord` — status (`active`/`returned`), `borrowed_at`/`returned_at` — a lending relationship
     between two people, and the doc itself asks for two-sided confirmation on termination.
   - `BringClaim` — an assignment of responsibility from a guest onto a needed item at a term.

## Party Types

| Party Type | Description | Examples in this domain |
|------------|-------------|--------------------------|
| Person | Any individual human in the system | Prowadząca (organizer), rodzic (guest) |
| Group | An addressable, ad-hoc collection of parties led by an organizer | Grupa zajęciowa, e.g. "Muzyczne Maluchy" |

No `Organization` party type is needed — there is no legal/administrative entity distinct from the
individual organizer; a `Group` (class) is the only collective actor, and it fits the `Group` party
type (informal, addressable collection, itself capable of having members and being led).

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|----------------|-----------------|-------|
| `User` | Party (Person) | Identity — should be a single record regardless of role |
| `User.role` (organizer/guest) | PartyRole / RoleType | Currently a single fixed enum column — this is the anti-pattern to fix (see Fit Rationale) |
| `Profile` (organizer's and guest's, currently two separate objects) | Attributes of Party (Person) | Should merge into one `Profile` per `Person`, independent of which role is active |
| `GalleryPhoto` | Attribute collection of Party (Profile) | Not itself a party or relationship — plain owned collection |
| `Group` (`PanelOrganizatora.tsx` groups list) | Party (Group) | Addressable collective, target of `leads` and `membership` relationships |
| Organizer "owns"/runs a `Group` (`Group.organizer_id`) | Relationship: `leads` | Currently a plain FK; promoted to a Relationship because leadership could conceivably transfer (co-instructor covering a group) — see Implementation Notes for the (X) assumption |
| Rodzic zapisuje się do grupy (`FAMILIES` w `KragGrupy.tsx`, `GroupMembership`) | Relationship: `membership` | Party(Guest) ↔ Party(Group), with lifecycle |
| `child_name`, `child_age`, `avatar_color`, `avatar_initials` on `GroupMembership` | Attributes of the `membership` Relationship | See Unmapped Concepts — Child modeled as attribute, not as its own Party (assumption) |
| `Term` | Resource owned by Group | Not a Party — a scheduled occurrence, not an actor |
| `TermNeededItem` | Resource / need-slot linked to a Term | Not a Party |
| `BringClaim` | Relationship: `bring_claim` (Party → Resource) | Extension of the archetype: the "to" side is a resource (`TermNeededItem`), not a Party — flagged below |
| `Item` | Resource owned by a Party | `Item.owner_id` is a plain reference, not a modeled Relationship (see Unmapped Concepts) |
| `Item.mode` (wypożyczę/oddam/zamienię) | Attribute of Item | Not party-relevant |
| `BorrowRecord` ("Podarek"/Gift) | Relationship: `borrowing` | Party(lender) ↔ Party(recipient), asymmetric, with lifecycle |
| `BorrowRecord.source` (pożyczone/otrzymane/zamienione) | Sub-type / attribute of `borrowing` Relationship | Distinguishes the flavor of the same relationship shape |
| `Settings.email_notifications` / `sms_notifications` | Implies ContactMechanism types (email, phone) | Phone is implied but not modeled anywhere as a field — gap, see Implementation Notes |
| `Settings.public_profile` | Attribute of Party (Profile visibility) | Not a party-archetype concept itself |
| Nawigacja / role switch w `App.tsx` | Out of scope | Explicitly called out in the doc as "not real authentication" — an access/session concern, not a business role |

## Unmapped Concepts

- **Child as a person** — `GroupMembership` embeds `child_name`/`child_age` as flat fields rather than
  modeling the child as its own `Person` party related to the guest via a `guardianship` relationship.
  This is a deliberate simplification (assumption, see Implementation Notes): the requirements never
  describe a child having their own login, multiple guardians, or independent attributes, so promoting
  Child to a full Party would be over-modeling for what's specified today. If the domain later needs
  shared guardianship (two parents, grandparents picking up) or child-specific history across groups,
  this should be revisited — Child would become a `Person` Party, and `GroupMembership` would relate a
  `Group` to a `Child`, with a separate `guardianship` Relationship between `Guest` and `Child`.
- **`Item.owner_id`** — treated as a plain reference, not a Relationship, because ownership itself never
  changes and carries no independent lifecycle (temporary custody changes are captured separately by
  `borrowing`). Per the "Relationship vs. foreign key" rule, this stays a simple FK.
- **`bring_claim`** (`BringClaim`) — included as a Relationship for completeness, but its "to" side
  (`TermNeededItem`) is a resource, not a Party. This is a light extension beyond the strict archetype
  (which models Party↔Party); flagged here rather than silently folded into the Relationship section.

## Role Types

| Role Type | Applicable Party Type(s) | Scope | Concurrency | Validity |
|-----------|---------------------------|-------|-------------|----------|
| Organizer | Person | Global (platform-level capability) | Multiple concurrent Groups led (1:N via `leads`); assumed compatible with also holding Guest (X) | Tracked (soft end if person stops organizing) |
| Guest | Person | Global | Multiple concurrent Group memberships; assumed compatible with also holding Organizer (X) | Tracked (soft end if person leaves the platform) |

## Relationships

### leads
**From**: Person (Role: Organizer) → **To**: Group
**Directionality**: Asymmetric (`leads` / `led by`)
**Cardinality**: 1:N (one organizer leads many groups; each group has exactly one active leading organizer)
**Uniqueness**: A Group has at most one *currently active* `leads` relationship at a time

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| leads instance | Group creation date | Leadership transfer date, or open-ended | Old row's `validTo` set; new `leads` row created for the new organizer | (X) Promoted from a plain FK on the assumption that leadership transfer is a real, if rare, business event — flagged in Implementation Notes |

### membership
**From**: Person (Role: Guest) → **To**: Group
**Directionality**: Asymmetric (`member of` / `has member`)
**Cardinality**: N:N (a guest may belong to several groups; a group has many guests; a guest may even hold multiple membership rows for the same group, one per child)
**Uniqueness**: Not unique per (guest, group) pair — uniqueness is effectively per (guest, group, child-name), since one guest can enroll multiple children in the same group

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| membership instance | `joined_at` | Set when `status` becomes `cancelled` | Soft cancellation, no cascading delete — history retained for "who was in this group when" queries | Carries `child_name`, `child_age`, `avatar_color`, `avatar_initials` as attributes (see Unmapped Concepts) |

### borrowing
**From**: Person (lender, `from_user_id`, nullable) → **To**: Person (recipient, `to_user_id`)
**Directionality**: Asymmetric (`lent to` / `borrowed from`) — sub-typed by `source` (`pożyczone`/`otrzymane`/`zamienione`)
**Cardinality**: N:N over time (any two people may have many borrow records, sequential or concurrent, over different items)
**Uniqueness**: None — same pair, same item type, may recur

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| borrowing instance | `borrowed_at` | `returned_at` (nullable while active) | Today: one-sided, declarative ("Zwróć" button flips status) — doc explicitly flags this is unverified. Recommended: two-sided confirmation (`to_user_id` reports return → `from_user_id` confirms receipt) before `validTo` is finalized | Linked optionally to `Item` via `item_id` when tied to a specific offer |

### bring_claim (extension — Party→Resource, not Party→Party)
**From**: Person (Role: Guest, via an active `membership`) → **To**: `TermNeededItem` (resource, not a Party)
**Directionality**: Asymmetric (`claims` / `claimed by`)
**Cardinality**: 1:1 per `TermNeededItem` (one claimant at a time; `claimed_by_id = null` means unclaimed)
**Uniqueness**: At most one active claimant per `TermNeededItem`

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| bring_claim instance | `claimed_at` | Not modeled today (no "un-claim" flow described) | Assumption (X): claim can be cleared back to unclaimed, no history requirement stated | Not a strict party-party relationship — included for completeness per Unmapped Concepts note |

## Validity Rules

| Role / Relationship | Valid From | Valid To | On Termination |
|----------------------|-----------|---------|-----------------|
| Organizer (role) | Person first leads a Group | Not specified — assumed soft end-date, no cascade (X) | Existing Groups keep their history; role marked inactive |
| Guest (role) | Person first joins a Group | Not specified — assumed soft end-date, no cascade (X) | Existing memberships keep their history; role marked inactive |
| leads | Group creation | Leadership transfer, or open-ended | Old row ends, new row starts for new organizer |
| membership | `joined_at` | `status` → `cancelled` | Soft cancellation, retained for history |
| borrowing | `borrowed_at` | `returned_at`, or open-ended | Recommended two-sided confirmation (see above); today one-sided |
| bring_claim | `claimed_at` | Not modeled | Assumed clearable back to unclaimed |

## Contact Mechanisms & Identifiers

- **ContactMechanism**: `email` (per-Person, shared across roles — used for both login and
  `email_notifications`). `phone` is implied by `Settings.sms_notifications` but has no backing field
  anywhere in the current model — flagged as a gap; assumption (X) that it would be added per-Person,
  not per-role, since notification preferences in `Settings` are already 1:1 with `User`, not
  role-scoped.
- **Identifier**: None beyond the system's own Party ID — no external identifiers (e.g., a facility
  membership number) are surfaced in the requirements.

## Implementation Notes

- (R) `User.role` today is a single fixed enum (`organizer`, `guest`), implemented as two entirely
  separate, unlinked objects (`Profile` in `PanelOrganizatora.tsx` vs. `PanelGoscia.tsx`). This is the
  primary finding of this mapping: unify into one `Person` Party with independently-held `PartyRole`
  rows, per the "Identity Is Not Role" pattern.
- (X) **Role concurrency assumed true**: a Person can hold both `Organizer` and `Guest` roles at the
  same time (e.g., an organizer who also enrolls their own child in a colleague's group). Not asked
  interactively (batch scan); this is a domain-informed default consistent with the doc's own call for
  unifying the two objects. If the real requirement is "a person is exclusively one or the other,
  forever," a plain `role` enum column would suffice for that piece alone and the `PartyRole` table
  could be simplified — but the relationships (`membership`, `borrowing`) still benefit from the full
  model regardless.
- (X) **`leads` promoted from plain FK to a full Relationship** on the assumption that group leadership
  could transfer (substitute instructor, business handoff). If leadership is truly permanent and 1:1
  with group creation, `Group.organizer_id` can safely stay a plain foreign key and the `leads`
  Relationship can be dropped without losing anything else in this model.
- (X) **No approval/verification step assumed** for `membership` or `borrowing` — both are asserted
  directly by the guest (join a group; claim an item), matching the simple `active`/`cancelled` and
  `active`/`returned` status enums already in the doc. No "pending approval" state is implied by the
  requirements.
- (X) **Role-type set assumed fixed** (`Organizer`, `Guest`) — nothing in the requirements suggests
  administrators need to define new business role types.
- (R) The doc's own section 5 explicitly recommends two-sided confirmation for `borrowing` termination
  ("dwustronne potwierdzenie") — carried into the `borrowing` Relationship's `onTermination` field
  above as a recommendation, not yet a confirmed requirement.
- **Authorization vs. business role**: `Organizer`/`Guest` here are business roles (what someone *does*
  in the domain), not access-control permissions. If/when real authentication is added (flagged in the
  doc as currently missing — the "role switch" is just page navigation in `App.tsx`), a separate,
  simpler permission model can sit on top of this without being conflated with it.
