---
name: party-archetype-mapper
description: Transform domain requirements into a Party Archetype model. Identifies Parties (Person/Organization/Group), Role Types with validity, Relationships between parties with cardinality and directionality, and Contact Mechanisms. Produces implementable model with explicit concept mapping and unmapped concepts sections.
argument-hint: "[domain requirements or feature description]"
---

# Party Archetype Mapper

Transform any domain description that involves **who is what to whom** into a Party archetype model (Fowler's Party pattern: Person/Organization playing Roles, related to each other via Relationships). The actors do not need to be literal "users" — they can be people, organizations, groups, or any addressable participant that plays one or more roles over time.

**Output goal**: A complete, implementable model that decouples identity (who someone *is*) from role (what they currently *do*) from relationship (how two parties are connected), with full temporal history and no role explosion in the data model.

## When to Use

**Use this skill when:**
- The same real-world entity (person/organization) can play **multiple roles**, simultaneously or over time (e.g., a person is both a parent and a teacher; a former employee becomes a customer)
- Roles must be **added or removed without restructuring identity** (a Person doesn't stop existing when they stop being an Employee)
- Two parties are connected by an explicit, named **relationship** (guardian↔child, employer↔employee, supplier↔customer) that itself carries data (start date, terms, status)
- Relationships or roles have a **validity period** that must be queryable historically ("who was the class teacher in March 2024?")
- The domain has **role-scoped context** (Employee *of* Organization X, not Employee in the abstract)

**Output is useful for:**
- Domain modeling sessions before implementation of identity/actor/relationship-heavy features
- Multi-role systems (a single login can act as parent, staff, or admin depending on context)
- Systems needing an audit trail of who was related to whom, and since when

## When NOT to Use — Fit Test

Before starting the mapping, apply this test. If the domain fails it, **stop and tell the user** that the party archetype does not fit, and briefly explain why.

### The core question

> *"Is there an entity that plays one or more roles, and/or is connected to other entities via a named relationship that itself has a lifecycle?"*

If **yes** → party archetype likely fits.
If the natural question is **"how much X does S have?"** → it's an accounting ledger. Use `accounting-archetype-mapper` instead.
If the natural question is **"how much does X cost?"** → it's a pricing engine. Use `pricing-archetype-mapper` instead.
If the natural question is **"what state is X in?"** → it's a state machine, not an actor/relationship model. Do not map.

### Signal table

| Signal in requirements | Likely archetype fit? |
|------------------------|-----------------------|
| "a user can be both a parent and a teacher" | ✅ Yes — multi-role |
| "person keeps their history after their role ends" | ✅ Yes — role lifecycle |
| "X is the legal guardian of Y" / "X works for Y" | ✅ Yes — relationship with parties on both ends |
| "who was the assigned case worker on this date" | ✅ Yes — temporal role query |
| "an organization has multiple contacts, each with a role" | ✅ Yes — role-scoped contacts |
| "task moves from open → assigned → resolved" | ❌ No — state machine |
| "user earns / spends N points" | ❌ No — accounting archetype |
| "price depends on customer segment" | ❌ No — pricing archetype (segment may be *fed by* a party role, but the pricing logic itself is not party) |
| "single fixed `role` column on the user table, never changes, never queried historically, no relationships" | ⚠️ Borderline — may be over-engineering; plain enum column may suffice |
| "list of users with a `type` field used only for authorization" | ⚠️ Borderline — apply the borderline test below |

### Borderline cases — how to decide

- **Single static role, no relationships**: If a user has exactly one role for their entire lifetime, it never changes, and nothing else in the domain relates one party to another, a plain `role` enum column is simpler and correct. Only introduce the Party archetype when at least one of (multi-role, role history, relationships) is actually present or clearly imminent.
- **Authorization-only "role"**: RBAC permission roles (`admin`, `editor`, `viewer`) are usually **not** the Party archetype's "Role" — they are access-control flags. The Party archetype's Role models a *business* role (Parent, Teacher, Guardian, Supplier), not a *permission* role. The same person can have one business Role and a different, independent permission role. Do not conflate the two; ask the user which one is being described if ambiguous.
- **Relationship vs. foreign key**: A plain foreign key (`order.customer_id`) is not automatically a Party relationship. It becomes one when the connection itself needs a lifecycle (start/end), a type that can vary (guardian vs. emergency contact vs. co-parent), or must support many-to-many/historical queries. If it's a single immutable FK set once at creation, it may just be a reference, not a modeled Relationship.

### If the domain does not fit

Output:

```
## Archetype Fit Assessment: ❌ Does Not Fit

The party archetype models actors that play roles and/or relate to other actors, with a
lifecycle attached to that role or relationship. This domain is a [accounting ledger /
pricing engine / state machine / plain reference] because:

- [specific reason from the requirements]
- The natural question is "[...]" not "who is playing what role in relation to whom?"
```

Do NOT suggest alternative patterns beyond naming the correct archetype mapper. Stop here.

---

## Mapping Workflow

### Step 0: Get Requirements

- If provided as argument, use it directly.
- If not provided, scan the recent conversation for domain context. If found, use that.
- Only if no argument AND no context in session, ask:
  > "Describe the domain — which entities exist (people/organizations), what roles do they play, and how are they connected to each other?"

---

### Step 1: Identify Party Types

Detect which nouns in the domain are **actors** — things capable of playing a role or participating in a relationship, as opposed to passive objects or documents.

**Detection signals:**
- Nouns that can initiate actions, be assigned responsibility, or be addressed/contacted
- Nouns that can play more than one role, or the same role for more than one counterpart
- Nouns that persist independently of any single role (a Person still exists after resigning as Employee)

**Party Type categories:**

| Type | Description | Example |
|------|-------------|---------|
| `Person` | An individual human | Parent, Teacher, Child, Employee |
| `Organization` | A legal or administrative entity | Facility, School Board, Supplier Company |
| `Group` | An informal or ad-hoc collection of parties, itself addressable | Family, Class, Household, Committee |

**Key question to answer:** *What are the "who"s in this domain — and can any of them wear more than one hat?*

**Output:** Named Party Types present in the domain, with a one-line description each.

---

### Step 2: Ask Clarifying Questions

Before continuing, identify gaps between the requirements and party archetype capabilities. Ask about **two categories** of questions in a single `AskUserQuestion` call (up to 4 questions per call; split into multiple calls if more needed). Always include **"To zależy / It depends"** as an explicit last option in every question.

#### Category A — Standard party decisions

Ask only about those **not clearly addressed** in the requirements:

- **Role concurrency**: Can one Party hold multiple Roles at the same time (e.g., a Person who is simultaneously a Parent and a Teacher)? Or is a Party restricted to exactly one active Role?
- **Role history**: Must past (ended) roles remain queryable — "who was the class's teacher last year"? Or is only the current role relevant?
- **Relationship directionality**: Are relationships symmetric (siblings, co-parents — same meaning both ways) or asymmetric (guardian→child vs. child→guardian — different meaning per direction, needing an inverse name)?
- **Relationship cardinality**: For each relationship type — is it 1:1 (a child has exactly one primary guardian), 1:N (a guardian may have many children), or N:N (a teacher relates to many classes, a class has many teachers)?
- **Role scoping context**: Is a Role global (Person is "a Teacher", full stop) or scoped to a specific Organization/context (Person is "a Teacher *at Facility X*", and could be something else at Facility Y)?

#### Category B — Gap-triggered questions

Scan the requirements for **anything the party archetype supports but the requirements do not mention**. For each gap found, ask whether that dimension is wanted. Do not limit yourself to the list below — reason freely. Examples of gaps to look for:

- **Contact mechanisms**: Does each Party (or each Role a Party plays) need its own contact details (address, phone, email), or is contact info shared at the Party level regardless of role?
- **Identity deduplication**: Could the same real-world person end up as two separate Party records (e.g., created independently by two facilities) that later need to be merged/linked?
- **Role transitions**: When a Role ends, does anything need to happen (notification, access revocation, data retention), or is it a pure end-date stamp?
- **Relationship approval/verification**: Does establishing a relationship (e.g., "X is guardian of Y") require verification/approval, or is it asserted directly?
- **Role-type extensibility**: Is the set of Role Types fixed and known upfront (small enum), or must administrators be able to define new Role Types without a code change?
- **Any other gap** you identify between what the archetype can model and what the requirements specify.

Collect answers before proceeding. If the user cannot answer, document the assumption made in **Implementation Notes**.

#### Handling "it depends / both / varies by situation" answers

Always include **"To zależy / It depends"** as an explicit option in every `AskUserQuestion` call — do not rely on the automatic "Other" fallback. Place it as the last option in each question. If the user selects it, treat it as a **variable policy**:

- Document the *parameter* the model will accept (e.g., `role_scope`, `relationship_cardinality`, `requires_verification`)
- Note in **Implementation Notes** that its value is computed externally by a policy/business-rules layer and passed in at role-assignment or relationship-creation time
- Do **not** attempt to model the decision logic inside the party archetype itself

This is the correct outcome — variability means the rule lives above the actor/relationship model, not inside it.

---

### Step 3: Map Domain Concepts to Party Archetypes

For each significant noun and verb in the requirements, produce an explicit mapping table:

```
| Domain Concept       | Party Archetype | Notes |
|----------------------|-----------------|-------|
| [domain noun/verb]   | Party / PartyType / Role / RoleType / Relationship / RelationshipType / ContactMechanism / Identifier | [why] |
```

After the table, list any domain concepts that **could not be mapped**:

```
## Unmapped Concepts

The following domain concepts have no clear party archetype equivalent:
- [concept] — [reason it doesn't fit / decision needed]
```

This section must be present even if empty (`None identified`).

---

### Step 4: Identify Role Types

Determine all **Role Types** a Party can play in this domain — the "hats" available.

**Detection signals:**
- Verbs/nouns describing what a party *does* or *is regarded as* in a given context (teaches, guards, supplies, manages)
- The same underlying Party appearing under different labels in different parts of the requirements

**Naming convention:** `{RoleName}` as a stable catalog entry, not embedded as a boolean/enum column on the Party record itself.

**For each Role Type, define:**
- **Applicable Party Types**: which Party Types may hold this role (e.g., only `Person` can be a `Teacher`; only `Organization` can be a `Supplier`)
- **Scope**: global, or scoped to a specific context/organization (`Teacher at Facility`)
- **Concurrency**: can a single Party hold this Role Type more than once concurrently under different scopes (e.g., `Teacher` at two different facilities at once)?
- **Validity**: does this role have a start/end date that must be tracked?

---

### Step 5: Identify Relationships

Find all **named connections** between two parties (or two role-instances) that carry meaning beyond a simple reference.

**Detection signals:**
- Verbs connecting two actors: "is guardian of", "works for", "supplies", "supervises", "is sibling of"
- Any connection whose *type* can vary (guardian vs. emergency contact vs. co-parent) even between the same two parties
- Any connection needing a lifecycle (established, suspended, terminated) or supporting data (since when, under what terms)

**For each Relationship Type, define:**

| Field | Description |
|-------|-------------|
| Relationship Type name | Stable identifier, e.g. `guardianship`, `employment`, `sibling` |
| From Party Type / Role | Which party type or role occupies the "from" side |
| To Party Type / Role | Which party type or role occupies the "to" side |
| Directionality | Symmetric (same meaning both ways) or Asymmetric (needs distinct forward/inverse names, e.g. `guardian of` / `ward of`) |
| Cardinality | 1:1, 1:N, N:1, or N:N |
| Validity | Does the relationship have `validFrom`/`validTo`? What happens at termination? |
| Uniqueness constraint | Can the same pair hold the same relationship type twice concurrently (usually no), or under different roles/scopes (sometimes yes)? |

---

### Step 6: Define Validity & Lifecycle

If roles or relationships have time constraints, define validity rules — mirroring how the accounting/pricing archetypes handle temporal data, so historical queries stay correct.

**For each time-constrained Role or Relationship:**

```
Role/Relationship: [name]
  validFrom: [when it becomes effective]
  validTo:   [when it ends, if ever — open-ended if none]
  onTermination: [what happens — soft end-date only, cascading effects, notification]
```

**Half-open interval convention**: `[validFrom, validTo)` — `validFrom` inclusive, `validTo` exclusive; use an "open-ended" sentinel (`null` / "end of time") for currently-active roles/relationships.

**Historical query rule**: "who held Role R for Party P at time T" must filter by `validFrom ≤ T < validTo`, exactly as the accounting archetype's `applied_at` filtering and the pricing archetype's `versionAt(t)`.

---

### Step 7: Contact Mechanisms & Identifiers (if applicable)

Only include this section if Step 2 surfaced a need for it.

**ContactMechanism** — a way to reach a Party, optionally scoped to a specific Role:
- Types: address, phone, email, and any domain-specific channel
- Scope: per-Party (shared across all roles) or per-Role (e.g., work email tied to the Employee role, different from personal email)
- Cardinality: can a Party/Role have multiple of the same type (e.g., two phone numbers), and if so, is one marked primary?

**Identifier** — an external identifier for a Party, distinct from the system's own primary key:
- Examples: national ID, tax ID, student number, employee number
- Scope: whether the identifier is unique per Party Type, per issuing Organization, or globally

---

### Step 7.5: Decision Sanity Check

**Before producing the final output**, enumerate every concrete decision embedded in the draft model and verify each one has a source. This prevents silent assumptions from leaking into the output.

For each decision, classify its source:
- **(R)** — explicitly stated in the requirements
- **(A)** — asked and answered in Step 2
- **(X)** — neither: assumed silently

**Decision checklist** (go through every one that appears in your draft):

| Decision area | Example decisions to check |
|---------------|---------------------------|
| Role concurrency | Can a Party hold multiple Roles at once? Multiple instances of the same Role under different scopes? |
| Role history | Are ended roles retained and queryable, or hard-deleted? |
| Role scoping | Global role or scoped to an Organization/context? |
| Relationship directionality | Symmetric or asymmetric? Inverse name defined for asymmetric ones? |
| Relationship cardinality | 1:1 / 1:N / N:1 / N:N — explicitly chosen or assumed? |
| Relationship uniqueness | Can the same pair hold the same relationship type twice concurrently? |
| Validity / termination | Does ending a role/relationship cascade (revoke access, notify), or is it a pure date stamp? |
| Identity deduplication | Can the same real person exist as two Party records? Is merge/linking needed? |
| Contact mechanism scope | Per-Party or per-Role? Multiple per type? Primary flag? |
| Verification/approval | Does establishing a relationship require approval, or is it asserted directly? |
| Role-type extensibility | Fixed enum, or admin-definable catalog? |
| Authorization vs. business role | Is this modeling a business role (Party archetype) or an access-control permission (out of scope)? |

**For every (X) decision found:**

1. If the decision has low impact (purely technical, easily changed): mark as explicit assumption in Implementation Notes.
2. If the decision affects business behavior (e.g., role concurrency, relationship cardinality, what happens on termination): **stop and ask** using `AskUserQuestion` before delivering the model.

Do not deliver the model until all material (X) decisions are either confirmed or documented as explicit assumptions.

---

## Output Format

```markdown
# Party Archetype Model: [Domain Name]

## Party Types

| Party Type | Description | Examples in this domain |
|------------|-------------|--------------------------|
| Person / Organization / Group | ... | ... |

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|----------------|-----------------|-------|
| ...            | ...             | ...   |

## Unmapped Concepts
[List or "None identified"]

## Role Types

| Role Type | Applicable Party Type(s) | Scope | Concurrency | Validity |
|-----------|---------------------------|-------|-------------|----------|
| [name] | [Person/Organization/Group] | Global / Scoped to [context] | Single active / Multiple concurrent | Tracked / Not tracked |

## Relationships

### [relationship_type_name]
**From**: [Party Type / Role] → **To**: [Party Type / Role]
**Directionality**: Symmetric / Asymmetric ([forward name] / [inverse name])
**Cardinality**: 1:1 / 1:N / N:1 / N:N
**Uniqueness**: [constraint on concurrent duplicates]

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| [relationship instance shape] | [rule] | [rule] | [effect] | [notes] |

[Repeat for each relationship type]

## Validity Rules

| Role / Relationship | Valid From | Valid To | On Termination |
|----------------------|-----------|---------|-----------------|
| [name] | [rule] | [rule] | [action] |

## Contact Mechanisms & Identifiers
[Table of contact mechanism types + scope, and identifier types + scope — or "Not applicable, not surfaced in requirements"]

## Implementation Notes
[Key decisions, assumptions made for unanswered clarifying questions, edge cases]
```

---

## Common Patterns & Pitfalls

### Pattern: Identity Is Not Role

The single most common modeling error this archetype prevents: putting a `role` column directly on the `Person`/`User` table, then adding a new boolean column or a new row-per-role hack every time a new role type appears. Instead:

```
Party (Person, id=42, name="Anna Kowalska")
  ├── PartyRole (RoleType=Parent, validFrom=2022-01-01, validTo=null)
  └── PartyRole (RoleType=Teacher, scope=Facility#7, validFrom=2023-09-01, validTo=null)
```

Anna is one Party with two independent, independently-terminable roles. Losing the Teacher role does not touch the Parent role or delete any identity data.

### Pattern: Relationships Connect Roles (or Parties), Not Rows in a Junction Table Bag

A relationship is a first-class concept with its own type, direction, and lifecycle — not a generic `related_to` junction table with a free-text `type` string. Each Relationship Type should be explicitly enumerated with its own cardinality and directionality rules (Step 5), the same way Account Types and Transaction Types are enumerated in the accounting archetype.

### Pattern: Role Scope Prevents Accidental Global Uniqueness

If a Role can be scoped (e.g., `Teacher at Facility X`), do not model it as a single global `is_teacher: boolean` on the Party. Model the scope as part of the Role instance's identity, so the same Party can independently hold the same Role Type at multiple scopes (or the model can explicitly forbid it, if that's a real constraint — verify in Step 2, don't assume).

### Pattern: Authorization Roles Are a Different Archetype

RBAC/permission roles (`admin`, `can_edit_billing`) answer "what is this account allowed to do in the system," not "what business role does this party occupy in the domain." Keep them separate: a Party's business Role (e.g., Teacher) may *inform* which permission role their user account gets, but the permission system itself is not part of this archetype's output.

### Pattern: History Is a Model Outcome, Not a Log

As with the pricing archetype's versioning, once Role/Relationship validity is modeled correctly with `[validFrom, validTo)`, historical questions ("who was the guardian on this date") are answered by filtering the existing rows — no separate audit log needed. The model is its own history.

---

## Quality Checks

Before returning the model, verify:

- [ ] Every Party Type present in the domain is listed with a description
- [ ] Every Role Type specifies applicable Party Type(s), scope, concurrency, and validity tracking
- [ ] Every Relationship Type specifies From/To, directionality (with inverse name if asymmetric), cardinality, and uniqueness constraint
- [ ] Roles and Relationships with time constraints use `[validFrom, validTo)` half-open interval notation consistently
- [ ] Business roles (Party archetype) are not conflated with authorization/permission roles
- [ ] Concept mapping table is present and complete
- [ ] Unmapped concepts section is present (even if empty)
- [ ] Contact Mechanisms & Identifiers section is present, even if "Not applicable"
- [ ] All clarifying question answers (or assumptions) are reflected in the model
- [ ] Implementation Notes document all (X) assumptions and boundary decisions

---

## Example

**Input:** "W przedszkolu osoba może być jednocześnie rodzicem jednego dziecka i nauczycielem w tej samej lub innej placówce. Dziecko ma jednego lub więcej opiekunów prawnych (rodziców/guardians) — musimy wiedzieć, kto był opiekunem w danym okresie, bo opiekunowie się zmieniają (np. po orzeczeniu sądu). Nauczyciel jest przypisany do placówki i może zmienić placówkę w trakcie roku. Musimy też wiedzieć, kto jest głównym kontaktem do dziecka."

**Output:**

```markdown
# Party Archetype Model: Kindergarten Guardianship & Staffing

## Party Types

| Party Type | Description | Examples in this domain |
|------------|-------------|--------------------------|
| Person | Any individual human in the system | Parent/Guardian, Teacher, Child |
| Organization | A facility (placówka) | Facility |

## Concept Mapping

| Domain Concept | Party Archetype | Notes |
|----------------|-----------------|-------|
| Rodzic / opiekun prawny | Person + PartyRole(Guardian) | Scoped to a specific Child |
| Dziecko | Person (Party), target of Guardian relationship | Also a Party — participates as the "to" side |
| Nauczyciel | Person + PartyRole(Teacher, scope=Facility) | Concurrency: one active Facility scope at a time (confirmed in clarifying Qs) |
| Placówka | Organization (Party) | Scope target for Teacher role |
| "Kto był opiekunem w danym okresie" | Relationship(guardianship) validity `[validFrom, validTo)` | Historical query requirement |
| Zmiana opiekuna po orzeczeniu sądu | Relationship termination (validTo set) + new Relationship created | Old relationship preserved, not deleted |
| Zmiana placówki nauczyciela w trakcie roku | PartyRole(Teacher) validTo set on old scope + new PartyRole created for new scope | Role history retained |
| Główny kontakt do dziecka | Relationship attribute `is_primary_contact: boolean` on guardianship relationship | Exactly one primary per child — flagged as decision needing confirmation |

## Unmapped Concepts
None identified.

## Role Types

| Role Type | Applicable Party Type(s) | Scope | Concurrency | Validity |
|-----------|---------------------------|-------|-------------|----------|
| Guardian | Person | Scoped to a specific Child (via Relationship, not the Role itself) | Multiple concurrent (one person can guard several children) | Tracked (via relationship validity, see below) |
| Teacher | Person | Scoped to a Facility | Single active scope at a time (per clarifying answer) — historically many | Tracked |
| Child | Person | Global (a child is a child regardless of facility) | N/A — always exactly one | Not applicable (identity, not a role) |

## Relationships

### guardianship
**From**: Person (Role: Guardian) → **To**: Person (Role: Child)
**Directionality**: Asymmetric (`guardian of` / `child of`)
**Cardinality**: N:N (a child may have multiple guardians; a guardian may have multiple children)
**Uniqueness**: The same (guardian, child) pair cannot hold two *concurrently active* guardianship relationships, but a new one may be created after the previous is terminated

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| guardianship instance | Court order / enrollment date | Court order revoking guardianship, or open-ended | Old relationship's validTo is set; new relationship created if a new guardian is appointed | `is_primary_contact` flag lives on this relationship instance |

### employment
**From**: Person (Role: Teacher) → **To**: Organization (Facility)
**Directionality**: Asymmetric (`employed at` / `employs`)
**Cardinality**: N:1 at any instant (per concurrency answer), N:N over time
**Uniqueness**: Only one currently-active employment relationship per Teacher (per clarifying answer)

| Field | validFrom | validTo | onTermination | Notes |
|-------|-----------|---------|----------------|-------|
| employment instance | Start date at facility | End date, or open-ended | Old relationship's validTo set when teacher transfers; new one created for new facility | Mid-year facility change is a termination + creation, not an update |

## Validity Rules

| Role / Relationship | Valid From | Valid To | On Termination |
|----------------------|-----------|---------|-----------------|
| guardianship | Court order / enrollment | Court order / revocation, or open-ended | Preserve row with validTo set; do not delete |
| employment | Facility start date | Transfer date, or open-ended | Preserve row with validTo set; do not delete |

## Contact Mechanisms & Identifiers
- **ContactMechanism**: phone/email, scoped per-Person (shared across all roles) — a Guardian's contact info doesn't change depending on which child they're linked to, per requirements.
- **Identifier**: none surfaced in requirements beyond the system's own Party ID.

## Implementation Notes
- (A) Role concurrency: a Person may hold Guardian and Teacher roles simultaneously — confirmed.
- (A) Teacher role scope: single active Facility at a time; historical scopes retained via validTo.
- (A) Guardianship cardinality: N:N, since siblings share guardians and a guardian may have multiple children.
- (X) `is_primary_contact` assumed to allow exactly one `true` per child at a time — flagged for confirmation with the user before implementation (not explicitly asked in this pass).
- Assumption: guardianship and employment changes are modeled as terminate-old + create-new, never as in-place mutation of validFrom/validTo on an active record, to keep the history append-only.
```
