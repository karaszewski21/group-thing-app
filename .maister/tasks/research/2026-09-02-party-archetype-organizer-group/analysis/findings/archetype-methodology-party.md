# Findings: Party Archetype Mapper — Methodology

**Source category**: archetype-methodology
**Source file**: `.claude/skills/party-archetype-mapper/SKILL.md` (read in full, 470 lines)
**Purpose of this document**: Faithfully document the RULES and OUTPUT FORMAT of the `party-archetype-mapper` skill so the research-synthesizer/design phase can later apply this methodology to the concrete domain (Organizator → Grupa → Uczestnicy, "prośba o rzecz na zajęcia" / "zgłoszenie na ochotnika"). No domain mapping is performed here — methodology only.

---

## 0. Skill Identity & Goal

**Source**: SKILL.md:1-11

```yaml
name: party-archetype-mapper
description: Transform domain requirements into a Party Archetype model. Identifies
  Parties (Person/Organization/Group), Role Types with validity, Relationships between
  parties with cardinality and directionality, and Contact Mechanisms.
```

> "Transform any domain description that involves **who is what to whom** into a Party archetype model (Fowler's Party pattern: Person/Organization playing Roles, related to each other via Relationships). The actors do not need to be literal "users" — they can be people, organizations, groups, or any addressable participant that plays one or more roles over time." (SKILL.md:9)

**Output goal** (SKILL.md:11):
> "A complete, implementable model that decouples identity (who someone *is*) from role (what they currently *do*) from relationship (how two parties are connected), with full temporal history and no role explosion in the data model."

---

## 1. Fit Test — "When to Use" / "When NOT to Use"

### 1.1 Positive fit signals (SKILL.md:13-26, "When to Use")

Use the skill when:
- The same real-world entity can play **multiple roles**, simultaneously or over time (e.g. person is both parent and teacher; former employee becomes customer). (SKILL.md:16)
- Roles must be **added/removed without restructuring identity** (a Person doesn't stop existing when they stop being an Employee). (SKILL.md:17)
- Two parties are connected by an explicit, named **relationship** that itself carries data (start date, terms, status). (SKILL.md:18)
- Relationships or roles have a **validity period** queryable historically ("who was the class teacher in March 2024?"). (SKILL.md:19)
- The domain has **role-scoped context** (Employee *of* Organization X, not Employee in the abstract). (SKILL.md:20)

Useful for: domain modeling before implementing identity/actor/relationship-heavy features; multi-role systems; systems needing an audit trail of who-was-related-to-whom-since-when. (SKILL.md:22-25)

### 1.2 The Fit Test (mandatory gate before mapping) (SKILL.md:27-76)

> "Before starting the mapping, apply this test. If the domain fails it, **stop and tell the user** that the party archetype does not fit, and briefly explain why." (SKILL.md:29)

**Core question** (SKILL.md:33):
> "Is there an entity that plays one or more roles, and/or is connected to other entities via a named relationship that itself has a lifecycle?"

Decision routing (SKILL.md:35-38):
- If **yes** → party archetype likely fits.
- If the natural question is **"how much X does S have?"** → accounting ledger → use `accounting-archetype-mapper` instead.
- If the natural question is **"how much does X cost?"** → pricing engine → use `pricing-archetype-mapper` instead.
- If the natural question is **"what state is X in?"** → state machine, not actor/relationship model → do not map.

**Signal table** (SKILL.md:42-53):

| Signal in requirements | Likely archetype fit? |
|------------------------|-----------------------|
| "a user can be both a parent and a teacher" | Yes — multi-role |
| "person keeps their history after their role ends" | Yes — role lifecycle |
| "X is the legal guardian of Y" / "X works for Y" | Yes — relationship with parties on both ends |
| "who was the assigned case worker on this date" | Yes — temporal role query |
| "an organization has multiple contacts, each with a role" | Yes — role-scoped contacts |
| "task moves from open → assigned → resolved" | No — state machine |
| "user earns / spends N points" | No — accounting archetype |
| "price depends on customer segment" | No — pricing archetype (segment may be *fed by* a party role, but pricing logic itself is not party) |
| "single fixed `role` column on the user table, never changes, never queried historically, no relationships" | Borderline — may be over-engineering; plain enum column may suffice |
| "list of users with a `type` field used only for authorization" | Borderline — apply borderline test |

**Borderline-case decision rules** (SKILL.md:55-59):
- **Single static role, no relationships**: if a user has exactly one lifetime role, never changing, and nothing else relates one party to another → plain `role` enum column is simpler and correct. Only introduce the Party archetype when at least one of (multi-role, role history, relationships) is present or clearly imminent.
- **Authorization-only "role"**: RBAC permission roles (`admin`, `editor`, `viewer`) are usually **not** the Party archetype's "Role" — they are access-control flags. The archetype's Role models a *business* role (Parent, Teacher, Guardian, Supplier), not a *permission* role. Same person may have one business Role and an independent permission role — do not conflate; ask the user if ambiguous.
- **Relationship vs. foreign key**: a plain FK (`order.customer_id`) is not automatically a Party relationship. It becomes one only when the connection itself needs a lifecycle (start/end), a type that can vary (guardian vs. emergency contact vs. co-parent), or must support many-to-many/historical queries. A single immutable FK set once at creation may just be a reference, not a modeled Relationship.

**If the domain does not fit — required output** (SKILL.md:61-76):
```
## Archetype Fit Assessment: ❌ Does Not Fit

The party archetype models actors that play roles and/or relate to other actors, with a
lifecycle attached to that role or relationship. This domain is a [accounting ledger /
pricing engine / state machine / plain reference] because:

- [specific reason from the requirements]
- The natural question is "[...]" not "who is playing what role in relation to whom?"
```
> "Do NOT suggest alternative patterns beyond naming the correct archetype mapper. Stop here." (SKILL.md:76)

---

## 2. Party Types (SKILL.md:91-111)

**Detection signals** for identifying which nouns are "actors" (Parties) vs. passive objects/documents (SKILL.md:95-98):
- Nouns that can initiate actions, be assigned responsibility, or be addressed/contacted.
- Nouns that can play more than one role, or the same role for more than one counterpart.
- Nouns that persist independently of any single role (a Person still exists after resigning as Employee).

**Party Type categories** (SKILL.md:102-106):

| Type | Description | Example |
|------|-------------|---------|
| `Person` | An individual human | Parent, Teacher, Child, Employee |
| `Organization` | A legal or administrative entity | Facility, School Board, Supplier Company |
| `Group` | An informal or ad-hoc collection of parties, itself addressable | Family, Class, Household, Committee |

**Key question to answer** (SKILL.md:108): *"What are the "who"s in this domain — and can any of them wear more than one hat?"*

**Output of this step**: Named Party Types present in the domain, with a one-line description each.

Note: `Group` is explicitly defined as "itself addressable" — implying a Group can be a first-class Party (can hold roles / participate in relationships in its own right), not merely a container of other Parties. Examples given (Family, Class, Household, Committee) are informal/ad-hoc collections, distinct from `Organization` (legal/administrative entity).

---

## 3. Role Types (SKILL.md:176-192)

**Detection signals** (SKILL.md:180-183):
- Verbs/nouns describing what a party *does* or *is regarded as* in a given context (teaches, guards, supplies, manages).
- The same underlying Party appearing under different labels in different parts of the requirements.

**Naming convention** (SKILL.md:184): `{RoleName}` as a stable catalog entry, **not** embedded as a boolean/enum column on the Party record itself.

**For each Role Type, define** (SKILL.md:186-191):
- **Applicable Party Types**: which Party Types may hold this role (e.g. only `Person` can be `Teacher`; only `Organization` can be `Supplier`).
- **Scope**: global, or scoped to a specific context/organization (`Teacher at Facility`).
- **Concurrency**: can a single Party hold this Role Type more than once concurrently under different scopes (e.g. `Teacher` at two different facilities at once)?
- **Validity**: does this role have a start/end date that must be tracked?

**Validity/lifecycle mechanics apply generically to Roles and Relationships** — see Section 5 below (Step 6, SKILL.md:217-233):
- Half-open interval convention: `[validFrom, validTo)` — `validFrom` inclusive, `validTo` exclusive; use an "open-ended" sentinel (`null` / "end of time") for currently-active roles/relationships. (SKILL.md:230)
- Historical query rule: "who held Role R for Party P at time T" must filter by `validFrom ≤ T < validTo` — explicitly analogized to the accounting archetype's `applied_at` filtering and the pricing archetype's `versionAt(t)`. (SKILL.md:232)
- Each time-constrained Role/Relationship should define:
```
Role/Relationship: [name]
  validFrom: [when it becomes effective]
  validTo:   [when it ends, if ever — open-ended if none]
  onTermination: [what happens — soft end-date only, cascading effects, notification]
```
(SKILL.md:223-228)

---

## 4. Relationships (SKILL.md:194-215)

**Detection signals** (SKILL.md:198-201):
- Verbs connecting two actors: "is guardian of", "works for", "supplies", "supervises", "is sibling of".
- Any connection whose *type* can vary (guardian vs. emergency contact vs. co-parent) even between the same two parties.
- Any connection needing a lifecycle (established, suspended, terminated) or supporting data (since when, under what terms).

**For each Relationship Type, define** (SKILL.md:203-214):

| Field | Description |
|-------|-------------|
| Relationship Type name | Stable identifier, e.g. `guardianship`, `employment`, `sibling` |
| From Party Type / Role | Which party type or role occupies the "from" side |
| To Party Type / Role | Which party type or role occupies the "to" side |
| Directionality | Symmetric (same meaning both ways) or Asymmetric (needs distinct forward/inverse names, e.g. `guardian of` / `ward of`) |
| Cardinality | 1:1, 1:N, N:1, or N:N |
| Validity | Does the relationship have `validFrom`/`validTo`? What happens at termination? |
| Uniqueness constraint | Can the same pair hold the same relationship type twice concurrently (usually no), or under different roles/scopes (sometimes yes)? |

**Cardinality/Directionality clarifying questions** the skill instructs to ask up front (SKILL.md:124-125, Step 2 Category A):
- **Relationship directionality**: symmetric (siblings, co-parents — same meaning both ways) or asymmetric (guardian→child vs. child→guardian — different meaning per direction, needing an inverse name)?
- **Relationship cardinality**: for each relationship type — 1:1 (a child has exactly one primary guardian), 1:N (a guardian may have many children), or N:N (a teacher relates to many classes, a class has many teachers)?

**Important pitfall pattern** — Relationships connect Roles (or Parties), not rows in a generic bag (SKILL.md:355-357):
> "A relationship is a first-class concept with its own type, direction, and lifecycle — not a generic `related_to` junction table with a free-text `type` string. Each Relationship Type should be explicitly enumerated with its own cardinality and directionality rules (Step 5), the same way Account Types and Transaction Types are enumerated in the accounting archetype."

---

## 5. Validity & Lifecycle (Step 6) (SKILL.md:217-233)

Covered inline above (Section 3) — reiterated here as its own methodology step since it applies uniformly to both Role Types and Relationship Types:
- Convention: half-open interval `[validFrom, validTo)`.
- Open-ended sentinel for active roles/relationships.
- Historical query rule: filter `validFrom ≤ T < validTo`.
- `onTermination` must be documented: soft end-date only vs. cascading effects vs. notification.

Related pitfall — **"History Is a Model Outcome, Not a Log"** (SKILL.md:367-369):
> "As with the pricing archetype's versioning, once Role/Relationship validity is modeled correctly with `[validFrom, validTo)`, historical questions ("who was the guardian on this date") are answered by filtering the existing rows — no separate audit log needed. The model is its own history."

---

## 6. Contact Mechanisms & Identifiers (Step 7) (SKILL.md:236-248)

> "Only include this section if Step 2 surfaced a need for it." (SKILL.md:238)

**ContactMechanism** — a way to reach a Party, optionally scoped to a specific Role:
- Types: address, phone, email, and any domain-specific channel.
- Scope: per-Party (shared across all roles) or per-Role (e.g. work email tied to Employee role, different from personal email).
- Cardinality: can a Party/Role have multiple of the same type (e.g. two phone numbers), and if so, is one marked primary?

**Identifier** — an external identifier for a Party, distinct from the system's own primary key:
- Examples: national ID, tax ID, student number, employee number.
- Scope: whether the identifier is unique per Party Type, per issuing Organization, or globally.

Clarifying question tied to this (Step 2, Category B, SKILL.md:132): "Does each Party (or each Role a Party plays) need its own contact details (address, phone, email), or is contact info shared at the Party level regardless of role?"

---

## 7. Full Mapping Workflow (Steps 0–7.5) — process overview

For completeness, the skill's full step sequence (SKILL.md:80-284), since synthesizer may need to replicate the *process*, not just the output shape:

- **Step 0 — Get Requirements** (SKILL.md:82-87): use provided argument; else scan conversation; else ask a single scoping question.
- **Step 1 — Identify Party Types** (SKILL.md:91-111): as above (Section 2).
- **Step 2 — Ask Clarifying Questions** (SKILL.md:114-149): two categories.
  - **Category A — Standard party decisions** (SKILL.md:118-126): role concurrency, role history, relationship directionality, relationship cardinality, role scoping context — ask only what's not clearly addressed in requirements.
  - **Category B — Gap-triggered questions** (SKILL.md:128-137): scan for archetype capabilities not mentioned in requirements — contact mechanisms, identity deduplication, role transitions (side effects on end), relationship approval/verification, role-type extensibility (fixed enum vs admin-definable), "any other gap."
  - Must use `AskUserQuestion`, up to 4 questions per call, split into multiple calls if more needed; **always include "To zależy / It depends" as an explicit last option in every question** (SKILL.md:116, 143).
  - **Handling "it depends"** (SKILL.md:141-149): treat as a **variable policy** — document the parameter name the model accepts (e.g. `role_scope`, `relationship_cardinality`, `requires_verification`), note in Implementation Notes that its value is computed externally by a policy/business-rules layer and passed in at role-assignment/relationship-creation time. **Do not model the decision logic inside the party archetype itself.**
- **Step 3 — Map Domain Concepts to Party Archetypes** (SKILL.md:153-173): produce the Concept Mapping table (see Section 8 below) plus a mandatory Unmapped Concepts section.
- **Step 4 — Identify Role Types** (SKILL.md:176-192): as above (Section 3).
- **Step 5 — Identify Relationships** (SKILL.md:194-215): as above (Section 4).
- **Step 6 — Define Validity & Lifecycle** (SKILL.md:217-233): as above (Section 5).
- **Step 7 — Contact Mechanisms & Identifiers** (SKILL.md:236-248): as above (Section 6), conditional on Step 2 gap surfacing.
- **Step 7.5 — Decision Sanity Check** (SKILL.md:251-282): mandatory pre-output audit — see Section 9 below.

---

## 8. Concept Mapping & Unmapped Concepts (Step 3) (SKILL.md:153-173)

**Concept Mapping table** — required for every significant noun/verb in the requirements:
```
| Domain Concept       | Party Archetype | Notes |
|----------------------|-----------------|-------|
| [domain noun/verb]   | Party / PartyType / Role / RoleType / Relationship / RelationshipType / ContactMechanism / Identifier | [why] |
```
(SKILL.md:158-161)

**Unmapped Concepts** — mandatory section, present even if empty:
```
## Unmapped Concepts

The following domain concepts have no clear party archetype equivalent:
- [concept] — [reason it doesn't fit / decision needed]
```
> "This section must be present even if empty (`None identified`)." (SKILL.md:172)

---

## 9. Decision Sanity Check (Step 7.5) (SKILL.md:251-282)

> "Before producing the final output, enumerate every concrete decision embedded in the draft model and verify each one has a source. This prevents silent assumptions from leaking into the output." (SKILL.md:253)

Each decision is classified by source:
- **(R)** — explicitly stated in the requirements
- **(A)** — asked and answered in Step 2
- **(X)** — neither: assumed silently

**Decision checklist categories** (SKILL.md:262-275): role concurrency, role history, role scoping, relationship directionality, relationship cardinality, relationship uniqueness, validity/termination (cascade vs. pure date stamp), identity deduplication, contact mechanism scope, verification/approval, role-type extensibility, authorization-vs-business-role distinction.

**Resolution rule for (X) decisions** (SKILL.md:277-282):
1. Low-impact/purely-technical/easily-changed → mark as explicit assumption in Implementation Notes.
2. Affects business behavior (role concurrency, relationship cardinality, termination effects, etc.) → **stop and ask** via `AskUserQuestion` before delivering the model.
> "Do not deliver the model until all material (X) decisions are either confirmed or documented as explicit assumptions." (SKILL.md:282)

---

## 10. Output Format — exact required document structure (SKILL.md:286-337)

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

**Ordering note**: Sections must appear in exactly this order — Party Types → Concept Mapping → Unmapped Concepts → Role Types → Relationships → Validity Rules → Contact Mechanisms & Identifiers → Implementation Notes. Note that Concept Mapping and Unmapped Concepts come *before* Role Types/Relationships in the final document, even though they are produced from an initial "Step 3" pass across the whole domain.

---

## 11. Common Patterns & Pitfalls (SKILL.md:341-369)

Four named patterns, each with rationale:

### 11.1 Pattern: Identity Is Not Role (SKILL.md:343-353)
> "The single most common modeling error this archetype prevents: putting a `role` column directly on the `Person`/`User` table, then adding a new boolean column or a new row-per-role hack every time a new role type appears."

Correct shape:
```
Party (Person, id=42, name="Anna Kowalska")
  ├── PartyRole (RoleType=Parent, validFrom=2022-01-01, validTo=null)
  └── PartyRole (RoleType=Teacher, scope=Facility#7, validFrom=2023-09-01, validTo=null)
```
> "Anna is one Party with two independent, independently-terminable roles. Losing the Teacher role does not touch the Parent role or delete any identity data." (SKILL.md:353)

### 11.2 Pattern: Relationships Connect Roles (or Parties), Not Rows in a Junction Table Bag (SKILL.md:355-357)
Covered in Section 4 above — relationships must be first-class typed entities, not a generic `related_to` table with free-text type.

### 11.3 Pattern: Role Scope Prevents Accidental Global Uniqueness (SKILL.md:359-361)
> "If a Role can be scoped (e.g., `Teacher at Facility X`), do not model it as a single global `is_teacher: boolean` on the Party. Model the scope as part of the Role instance's identity, so the same Party can independently hold the same Role Type at multiple scopes (or the model can explicitly forbid it, if that's a real constraint — verify in Step 2, don't assume)."

### 11.4 Pattern: Authorization Roles Are a Different Archetype (SKILL.md:363-365)
> "RBAC/permission roles (`admin`, `can_edit_billing`) answer "what is this account allowed to do in the system," not "what business role does this party occupy in the domain." Keep them separate: a Party's business Role (e.g., Teacher) may *inform* which permission role their user account gets, but the permission system itself is not part of this archetype's output."

(A fifth item, "History Is a Model Outcome, Not a Log," is listed under this section header in the source but overlaps with Validity/Lifecycle — already captured in Section 5.)

---

## 12. Quality Checks (final checklist before returning model) (SKILL.md:373-386)

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

## 13. Worked Example (SKILL.md:390-469) — summarized as an analogical pattern

**Domain (Polish, kindergarten)**: A person may simultaneously be a parent of one child and a teacher at the same or a different facility. A child has one or more legal guardians (parents/guardians) — the system must know who was the guardian during a given period, since guardians change (e.g. after a court ruling). A teacher is assigned to a facility and may change facility mid-year. The system must also know who is the primary contact for a child.

This is structurally close to the target domain (Organizator/Grupa/Uczestnik) in that it involves multiple people-in-roles tied to a shared context (facility/child) with historical validity — useful as an analogical template.

**How it was mapped** (full model produced, condensed here):

- **Party Types**: `Person` (Parent/Guardian, Teacher, Child), `Organization` (Facility). No `Group` type used in this particular example (note: the example does not exercise the Group party type at all).

- **Concept Mapping** (selected rows):
  - "Rodzic / opiekun prawny" → `Person + PartyRole(Guardian)`, scoped to a specific Child.
  - "Dziecko" → `Person (Party)`, also a Party in its own right — target ("to" side) of the Guardian relationship.
  - "Nauczyciel" → `Person + PartyRole(Teacher, scope=Facility)`; concurrency: one active Facility scope at a time (per clarifying answer).
  - "Placówka" → `Organization (Party)`, scope target for Teacher role.
  - "Kto był opiekunem w danym okresie" → `Relationship(guardianship)` validity `[validFrom, validTo)` — historical query requirement.
  - "Zmiana opiekuna po orzeczeniu sądu" → Relationship termination (`validTo` set) + new Relationship created; old relationship preserved, not deleted.
  - "Zmiana placówki nauczyciela w trakcie roku" → `PartyRole(Teacher)` `validTo` set on old scope + new `PartyRole` created for new scope; role history retained.
  - "Główny kontakt do dziecka" → Relationship attribute `is_primary_contact: boolean` on the guardianship relationship; exactly one primary per child — flagged as a decision needing confirmation.

- **Unmapped Concepts**: None identified.

- **Role Types**:
  - `Guardian` — Applicable to `Person`; scoped to a specific Child (via Relationship, not the Role itself); multiple concurrent (one person can guard several children); validity tracked via relationship.
  - `Teacher` — Applicable to `Person`; scoped to a Facility; single active scope at a time (per clarifying answer), historically many; validity tracked.
  - `Child` — Applicable to `Person`; global scope; N/A concurrency (always exactly one); "not applicable (identity, not a role)" for validity — i.e. Child is treated as identity, not really a Role.

- **Relationships**:
  - `guardianship`: From `Person(Role: Guardian)` → To `Person(Role: Child)`. Directionality: Asymmetric (`guardian of` / `child of`). Cardinality: N:N (child may have multiple guardians; guardian may have multiple children). Uniqueness: same (guardian, child) pair cannot hold two *concurrently active* guardianship relationships, but a new one may be created after the previous is terminated. Validity table: validFrom = court order/enrollment date; validTo = court order revoking guardianship or open-ended; onTermination = old relationship's validTo set, new relationship created if new guardian appointed; `is_primary_contact` flag lives on this relationship instance.
  - `employment`: From `Person(Role: Teacher)` → To `Organization(Facility)`. Directionality: Asymmetric (`employed at` / `employs`). Cardinality: N:1 at any instant (per concurrency answer), N:N over time. Uniqueness: only one currently-active employment relationship per Teacher. Validity table: validFrom = start date at facility; validTo = end date or open-ended; onTermination = old relationship's validTo set when teacher transfers, new one created for new facility — "mid-year facility change is a termination + creation, not an update."

- **Validity Rules table**: both `guardianship` and `employment` follow "preserve row with validTo set; do not delete."

- **Contact Mechanisms & Identifiers**: ContactMechanism (phone/email) scoped per-Person (shared across all roles) — "a Guardian's contact info doesn't change depending on which child they're linked to, per requirements." Identifier: none surfaced beyond the system's own Party ID.

- **Implementation Notes** (source-tagged):
  - (A) Role concurrency: a Person may hold Guardian and Teacher roles simultaneously — confirmed.
  - (A) Teacher role scope: single active Facility at a time; historical scopes retained via validTo.
  - (A) Guardianship cardinality: N:N, since siblings share guardians and a guardian may have multiple children.
  - (X) `is_primary_contact` assumed to allow exactly one `true` per child at a time — flagged for confirmation with the user before implementation (not explicitly asked in this pass).
  - General assumption: guardianship and employment changes are modeled as terminate-old + create-new, never in-place mutation of validFrom/validTo on an active record, to keep history append-only.

---

## Notes for Synthesizer / Design Phase

1. The skill's Fit Test (Section 1) must be applied *first* to each candidate concept (Organizator, Grupa, Uczestnik, "prośba o rzecz", "zgłoszenie na ochotnika") before any Party/Role/Relationship mapping is attempted — per SKILL.md:29, a no-fit result requires stopping and naming the correct alternative archetype rather than forcing the mapping.
2. The example in Section 13 is the closest structural analogy available in the skill itself: it involves a Person playing two concurrent roles (Parent/Teacher) tied to different scoped contexts (Child / Facility), with N:N relationships carrying validity — likely relevant to how "Organizator" (Organization or Person role?) and "Uczestnik" roles concurrently coexist with "Grupa" membership.
3. The `Group` Party Type (SKILL.md:106: "an informal or ad-hoc collection of parties, itself addressable," e.g. Family, Class, Household, Committee) is defined in the skill but **not exercised in the worked example** — this is a gap the synthesizer should note, since "Grupa" in the target domain may be exactly this under-demonstrated Party Type, requiring the design phase to reason about Group-as-Party without a direct precedent in the skill's own example.
4. The skill explicitly separates "authorization role" (RBAC) from "business role" (Party archetype Role) — relevant if "Organizator" or "Uczestnik" also imply any system permission distinction, which must not be conflated with the business-role model (SKILL.md:58, 363-365).
5. The "it depends" / variable-policy handling (SKILL.md:141-149) is directly relevant to any cardinality/directionality question in the target domain that the requirements leave open (e.g. can one Uczestnik belong to multiple Grupy? can an Organizator also be a Uczestnik?) — such open policy points should be modeled as external parameters, not hardcoded into the archetype.
