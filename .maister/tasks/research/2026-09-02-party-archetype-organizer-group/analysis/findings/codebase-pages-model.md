# Codebase Findings — `pages/*.tsx` domain concepts

Source category: `codebase`. All line numbers verified against the actual files read on
2026-09-02. Every finding cites `file:line`. Where something is absent from the code, this
is stated explicitly rather than inferred.

---

## 1. `pages/KragGrupy.tsx` and `pages/KragGrupyStart.tsx`

These two files are near-byte-identical (only the `FAMILIES` array length differs — 8 vs 2
records; confirmed by diff-reading both files in full). All line numbers below apply
identically to both files unless noted.

### 1.1 Type `Family` (implicit, not a named `type`)

There is **no explicit `type Family = {...}` declaration** in this file (unlike
`PanelOrganizatora.tsx`, which does declare named types). The shape is only implicit in the
`FAMILIES` array literal and in the one destructure `(typeof FAMILIES)[number]` at
`KragGrupy.tsx:335`. Evidence — the array literal itself:

```
KragGrupy.tsx:260-277
const FAMILIES = [
  { id: "wis", n: "Wiśniewskich", i: "WI", c: "#1B8168", kids: "Zosia, 2 lata",
    bring: "3 książeczki dźwiękowe", swap: "Książka: Pucio", mode: "wymienię", fresh: true },
  ...
];
```

Fields, inferred from usage:
- `id: string` — stable identity, used as React key and for `active === f.id` (KragGrupy.tsx:302, 389, 407, 411, 432, 445).
- `n: string` — surname in genitive case ("Wiśniewskich"), used to build display strings like `Rodzina ${f.n}` (KragGrupy.tsx:296, 413, 494). Code comment at KragGrupy.tsx:258 explains the genitive-case convention explicitly: `/* nazwisko: forma dopełniacza ("Rodzina Wiśniewskich"), bo "Rodzina Wiśniewscy" jest błędne */`.
- `i: string` — 2-letter initials shown in the avatar circle (KragGrupy.tsx:417-418).
- `c: string` — hex color used as avatar background (KragGrupy.tsx:417, 480, etc.).
- `kids: string` — free-text description of the child(ren), e.g. `"Zosia, 2 lata"` (KragGrupy.tsx:261). Not a separate `Child` entity — just a string on the family record.
- `bring: string | null` — what the family is bringing to the next session (KragGrupy.tsx:150 comment in SPEC.md: "co rodzina przynosi na najbliższe zajęcia").
- `swap: string | null` — what the family is offering to exchange/lend/give away (SPEC.md:151: "co rodzina oferuje do wymiany/pożyczenia/oddania").
- `mode: "wymienię" | "pożyczę" | "oddam" | null` — the exchange mode for the `swap` item. Declared as a literal union only implicitly (via `MODE_STYLE` keys, KragGrupy.tsx:279-283) — there is **no exported/named `Mode` type**.
- `fresh: boolean` — whether to show the pulsing "new offer" ring (KragGrupy.tsx:107-115, 419).

Confidence: High (100%) for field presence and usage; the type is unnamed/inline so "type
Family" as referenced in the research brief/plan is an informal label for this shape, not a
literal identifier in the code.

### 1.2 Constant `NEEDED_ITEMS`

```
KragGrupy.tsx:285-289
/* ---------------- kto co przynosi ---------------- */
/*  lista rzeczy, których prowadząca potrzebuje na najbliższe zajęcia;
    goście mogą się zgłosić dobrowolnie, nie muszą wybierać nic  */

const NEEDED_ITEMS = ["Tamburyn i dzwonki", "Mata piankowa", "Koc piknikowy"];
```

- It is a flat `string[]` of item *names* — not IDs, not references to any `Item`/product
  entity. There is no `Term`/session object in `KragGrupy.tsx` at all; `NEEDED_ITEMS` is a
  page-level constant, not scoped to a specific meeting/session record. The code comment
  says these are things "the leader needs for the upcoming session" (singular, implicit —
  "najbliższe zajęcia") but there is no session/term identifier tying this list to a
  particular date.
- Adjacent type: `BringClaim` (KragGrupy.tsx:291): `type BringClaim = { by: "family" | "you"; name: string; c: string; i: string } | null;` — the "who is bringing what" pledge itself.
- `INITIAL_BRING_CLAIMS` (KragGrupy.tsx:293-297) seeds the claim map by scanning `FAMILIES`
  for any family whose `bring` field textually matches a `NEEDED_ITEMS` entry:
  ```
  const INITIAL_BRING_CLAIMS: Record<string, BringClaim> = {};
  NEEDED_ITEMS.forEach((name) => {
    const fam = FAMILIES.find((f) => f.bring === name);
    INITIAL_BRING_CLAIMS[name] = fam ? { by: "family", name: `Rodzina ${fam.n}`, c: fam.c, i: fam.i } : null;
  });
  ```
  This is a **string-equality join** between two independently-declared datasets
  (`FAMILIES[].bring` and `NEEDED_ITEMS`), not a foreign key / relational reference. This is
  a concrete signal that "needed item" and "family's bring-pledge" are not yet modeled as a
  single relationship in code — they're two parallel string lists reconciled by text match.

### 1.3 Function `toggleBringClaim`

```
KragGrupy.tsx:307-313
const toggleBringClaim = (item: string) => {
  setBringClaims((c) => {
    const current = c[item];
    if (current && current.by !== "you") return c;
    return { ...c, [item]: current ? null : { by: "you", name: "Ciebie", c: "#1E2E27", i: "TY" } };
  });
};
```

Mechanics (evidence-based, no speculation):
- **Who can claim**: only the current viewer ("you" / `Ciebie`, hardcoded name/color/initials
  at line 311) — there is no user-picker; the logged-in user is implicit/singleton.
- **Can it be revoked?** Yes — calling `toggleBringClaim` again on an item you already claimed
  sets it back to `null` (`current ? null : {...}`). The UI label flips between "Ja to
  przyniosę" (I'll bring it) and "Rezygnuję" (I withdraw) — KragGrupy.tsx:467-469.
- **Can you steal/overwrite someone else's claim?** No — guarded by
  `if (current && current.by !== "you") return c;` — if another family (`by: "family"`)
  already claimed the item (from `INITIAL_BRING_CLAIMS`), the toggle is a no-op and the
  button is not even rendered: `{(!claim || isYou) && (<button>...)}` at KragGrupy.tsx:466.
- **Cardinality**: exactly one claimant per item — `BringClaim` is a single object, not an
  array, so this is 1 claimant : 1 needed-item, with the assignment either empty, held by a
  pre-seeded "family" claim, or held by "you". No support for multiple simultaneous
  volunteers per item, and no queue/waitlist.
- **Persistence**: `setBringClaims` is local `useState` — resigns on page refresh, matching
  the "no backend, state lives in memory" pattern SPEC.md documents project-wide (see §5
  below, SPEC.md:12-16).

### 1.4 "Kto co przynosi" (Who brings what) UI section

```
KragGrupy.tsx:449-475
{/* kto co przynosi */}
<div className="kg-bring">
  <h2>Kto co przynosi</h2>
  <p className="kg-bring-sub">Te rzeczy są potrzebne na najbliższe zajęcia — zgłoś się, jeśli możesz coś przynieść. To opcjonalne.</p>
  <div className="kg-bring-list">
    {NEEDED_ITEMS.map((item) => {
      const claim = bringClaims[item];
      const isYou = claim?.by === "you";
      return (
        <div className="kg-bring-item" key={item}>
          ...
          <div className="kg-bring-body">
            <strong>{item}</strong>
            <small>{claim ? `Przynosi: ${claim.name}` : "Jeszcze nikt się nie zgłosił"}</small>
          </div>
          {(!claim || isYou) && (
            <button className={`kg-bring-btn ${isYou ? "is-on" : ""}`} onClick={() => toggleBringClaim(item)}>
              {isYou ? "Rezygnuję" : "Ja to przyniosę"}
            </button>
          )}
        </div>
      );
    })}
  </div>
</div>
```

This is explicitly framed as **optional** ("To opcjonalne", KragGrupy.tsx:452) and shown to
every viewer of the group circle — it is not gated by an organizer-only view. Contrast with
`toggleNeededItem` in `PanelOrganizatora.tsx` (see §2.3), which is where the organizer
*creates* the need in the first place. `KragGrupy.tsx` only *displays and lets someone claim*
a hardcoded needs-list; it has no UI to add/remove entries from `NEEDED_ITEMS` itself.

### 1.5 "Krąg" (circle) structure — Organizer/Group/Family relation

The circle is rendered with families around a circumference and the group leader's avatar
fixed at the center:

```
KragGrupy.tsx:338-343 (geometry)
const slots = FAMILIES.length + 1;
const R = 38;
const pos = (i: number) => {
  const a = (i / slots) * 2 * Math.PI - Math.PI / 2;
  return { left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` };
};
```

```
KragGrupy.tsx:439-443 (center = organizer)
<div className="kg-center">
  <div className="kg-center-av"><Note /></div>
  <strong>Zuzanna Karaszewska</strong>
  <span>prowadzi zajęcia</span>
</div>
```

Observations:
- The organizer ("Zuzanna Karaszewska", labeled "prowadzi zajęcia" — "leads the sessions")
  is a **hardcoded string literal**, not a data field pulled from any `Family`-like record
  or a `Profile` type. There is no `Organizer` type in this file at all.
- The group itself is identified only by header text: `<h1>Muzyczne Maluchy</h1>` and
  `<div className="kg-head-sub">Środy 16:30 · Sala nr 2 · 8 rodzin</div>` (KragGrupy.tsx:358-359)
  — again hardcoded strings, no `Group` type/object.
- The relationship "Organizator → Grupa" is **not represented as data at all** — it's
  purely visual/positional (organizer literally drawn in the middle of a circle of family
  avatars). There is no field anywhere linking the "Zuzanna Karaszewska" string to the
  "Muzyczne Maluchy" group name, nor a field linking each `Family` record to a specific
  group — `FAMILIES` is a single flat array with an implicit "this group" scope, no
  `groupId` field.
- The relationship "Grupa → Uczestnik/Rodzina" is likewise implicit: membership is just
  "being present in the `FAMILIES` array of this page instance." Cardinality (N families :
  1 group here) is fixed by array containment, not by any explicit relationship/FK field on
  `Family` (no `groupId`, no `memberSince`, no validity dates).
- The "+`" button to add a family (KragGrupy.tsx:430-437, `aria-label="Zaproś kolejną
  rodzinę"`) is a toast-stub only — clicking it shows `setToast("Zaproszenie do grupy —
  prototyp")` and does not mutate `FAMILIES`. So there is no working "join group" flow in
  code, only a UI affordance placeholder.

Confidence: High (100%) that no explicit Organizer/Group/Family relational data structure
exists in this file — it's directly observable from the full file contents above.

### 1.6 `MODE_STYLE` — exchange-mode vocabulary #1

```
KragGrupy.tsx:279-283
const MODE_STYLE: Record<string, { bg: string; c: string }> = {
  "wymienię": { bg: "var(--lime-soft)", c: "#56701F" },
  "pożyczę": { bg: "var(--teal-soft)", c: "#245F61" },
  "oddam": { bg: "var(--mint-soft)", c: "#12604D" },
};
```
This is vocabulary set #1 of three inconsistent sets found across the prototype (see §4).
Values: "wymienię" (I'll exchange), "pożyczę" (I'll lend/borrow), "oddam" (I'll give away).

### 1.7 `KragGrupyStart.tsx` — same model, smaller dataset

Confirmed identical component logic; only difference is `FAMILIES` has 2 entries
(KragGrupyStart.tsx:260-265) instead of 8, and the header subtitle text reads "2 rodziny"
(KragGrupyStart.tsx:347) instead of "8 rodzin". No new domain concepts. This matches
`pages/SPEC.md:141-143`, which independently documents this file as "widok na starcie" (the
view right after the group is founded), differing only in family-count.

---

## 2. `pages/PanelOrganizatora.tsx`

### 2.1 Types: `Profile`, `Group`, `Term`, `Item`, `ItemMode`, `Gift`, `GiftSource`

```
PanelOrganizatora.tsx:370-375
type Profile = {
  name: string;
  bio: string;
  location: string;
  avatar: string;
};
```
`Profile` here represents the **organizer's own profile** — no role field, no reference to
which group(s) they organize; it is a flat attribute bag for a single implicit user (the
signed-in organizer, "Zuzanna Karaszewska", seeded at PanelOrganizatora.tsx:468-473).

```
PanelOrganizatora.tsx:377-382
type Group = {
  id: string;
  name: string;
  location: string;
  freeSpots: number;
};
```
`Group` is a **distinct, named type** here (unlike in `KragGrupy.tsx`, where it's only a
header string). Fields: `id`, `name`, `location`, `freeSpots` (integer). There is **no
`organizerId` field on `Group`** — ownership by the organizer is implicit (this whole
component instance = one organizer's panel), not an explicit relationship. There is also
**no participant/family list on `Group`** — `Group` only tracks a scalar `freeSpots` count,
not a roster of members. So Group↔Participant cardinality is not modeled at all in this
type; it's inferred only from the separate `KragGrupy.tsx` `FAMILIES` array in a different,
disconnected component.

```
PanelOrganizatora.tsx:384-391
type Term = {
  id: string;
  day: string;
  month: string;
  groupName: string;
  note: string;
  neededItems: string[];
};
```
`Term` (a scheduled meeting/session) links to a `Group` via `groupName: string` — a
**string match on the group's display name, not a `groupId` foreign key**. This is a
concrete data-modeling gap: renaming a group would silently break the Term→Group link
because it is matched by free-text name equality, evidenced by the `<select>` in the "Dodaj
termin" modal:
```
PanelOrganizatora.tsx:1030-1035
<select id="org-t-group" value={termForm.groupName} onChange={(e) => setTermForm({ ...termForm, groupName: e.target.value })}>
  <option value="">Wybierz grupę…</option>
  {groups.map((g) => (
    <option key={g.id} value={g.name}>{g.name}</option>
  ))}
</select>
```
Note the `<option value={g.name}>` — the dropdown is keyed on `g.id` for React but stores
`g.name` as the actual selected value into `termForm.groupName`. Confirms the string-based
(not id-based) link.

`Term.neededItems: string[]` — this is the **"prośba o rzecz na zajęcia"** (request for
items needed at the session) mechanism at the data-model level: a plain array of item name
strings attached directly to the `Term` record. No richer structure (no quantity, no
per-item claimant, no due-date) — just names.

```
PanelOrganizatora.tsx:393
type ItemMode = "wypożyczę" | "oddam" | "zamienię";
```
Exchange-mode vocabulary #2 (see §4): "wypożyczę" (I'll lend), "oddam" (I'll give away),
"zamienię" (I'll swap) — a different verb set than `KragGrupy.tsx`'s `MODE_STYLE`
("wymienię"/"pożyczę"/"oddam"). Note `"pożyczę"` (KragGrupy) vs `"wypożyczę"` (Panel*) are
different-but-similar verbs (lend vs rent/borrow), and `"wymienię"` (KragGrupy) vs
`"zamienię"` (Panel*) both mean "I'll swap" but with different words.

```
PanelOrganizatora.tsx:395-399
type Item = {
  id: string;
  name: string;
  mode: ItemMode | null;
};
```
`Item` is the organizer's own item they're offering to the group — attributes are minimal
(`id`, `name`, `mode`). No description, no photo, no quantity/condition fields. This is the
organizer's personal inventory used both in the "Moje rzeczy" (My things) view
(PanelOrganizatora.tsx:877-926) and as the source list when building a `Term`'s
`neededItems` checklist (see §2.3 below) — i.e., the organizer can only request items *from
their own catalog*, not arbitrary free-text items, when creating a term (contrast with
`KragGrupy.tsx`'s `NEEDED_ITEMS`, which is a hardcoded free-text list unconnected to any
`Item` catalog).

```
PanelOrganizatora.tsx:429-436
type GiftSource = "pożyczone" | "otrzymane" | "zamienione";

type Gift = {
  id: string;
  name: string;
  from: string;
  source: GiftSource;
};
```
Exchange-mode vocabulary #3 (see §4): "pożyczone" (borrowed/received-as-loan), "otrzymane"
(received/given permanently), "zamienione" (received via swap) — past-tense/passive forms
describing how an item already in the organizer's possession *arrived*, as opposed to
`ItemMode`'s active-voice "what I'm offering." `Gift.from: string` is again a free-text
name ("Rodzina Lewandowskich" — PanelOrganizatora.tsx:446), not a foreign key to any
`Family`/`Party` record.

### 2.2 CRUD functions: `addGroup`, `removeGroup`, `addTerm`, `removeTerm`

```
PanelOrganizatora.tsx:511-527
const addGroup = () => {
  if (!groupForm.name.trim()) return;
  setGroups((gs) => [
    ...gs,
    {
      id: nextId(),
      name: groupForm.name.trim(),
      location: groupForm.location.trim() || "Lokalizacja do ustalenia",
      freeSpots: Number(groupForm.freeSpots) || 0,
    },
  ]);
  setGroupForm({ name: "", location: "", freeSpots: "" });
  setModal(null);
  showToast("Dodano grupę");
};

const removeGroup = (id: string) => setGroups((gs) => gs.filter((g) => g.id !== id));
```

```
PanelOrganizatora.tsx:529-553
const addTerm = () => {
  if (!termForm.day.trim() || !termForm.groupName.trim()) return;
  setTerms((ts) => [
    ...ts,
    {
      id: nextId(),
      day: termForm.day.trim(),
      month: termForm.month.trim() || "—",
      groupName: termForm.groupName.trim(),
      note: termForm.note.trim(),
      neededItems: termForm.needsItems ? termForm.neededItems : [],
    },
  ]);
  setTermForm({ day: "", month: "", groupName: "", note: "", needsItems: false, neededItems: [] });
  setModal(null);
  showToast("Dodano termin");
};

const toggleNeededItem = (name: string) =>
  setTermForm((f) => ({
    ...f,
    neededItems: f.neededItems.includes(name) ? f.neededItems.filter((n) => n !== name) : [...f.neededItems, name],
  }));

const removeTerm = (id: string) => setTerms((ts) => ts.filter((t) => t.id !== id));
```

All are pure `useState` array mutations — no backend calls, no validation beyond
"non-empty required fields," ids generated by a module-level incrementing counter
(`let uid = 0; const nextId = () => \`item-${++uid}\`;` — PanelOrganizatora.tsx:401-402,
shared/reused for groups, terms, items, and gifts alike, i.e. **not type-scoped**, just a
single global counter for every entity in the file).

### 2.3 The "prośba o rzecz" (request items) mechanism — exact flow

The organizer creates the need for items *at term-creation time only*, via a modal form
(`Modal = "termin"`):

```
PanelOrganizatora.tsx:1041-1071
<div className="org-field is-full">
  <label className="org-checkbox-toggle">
    <input
      type="checkbox"
      checked={termForm.needsItems}
      onChange={(e) => setTermForm({ ...termForm, needsItems: e.target.checked })}
    />
    Potrzebuję rzeczy na zajęcia od rodzin
  </label>
</div>

{termForm.needsItems && (
  <div className="org-field is-full">
    <label>Wybierz z listy swoich rzeczy</label>
    <div className="org-check-list">
      {items.length === 0 && (
        <p className="org-check-empty">Nie masz jeszcze żadnych rzeczy — dodaj je w zakładce Rzeczy.</p>
      )}
      {items.map((it) => (
        <label className="org-check-row" key={it.id}>
          <input
            type="checkbox"
            checked={termForm.neededItems.includes(it.name)}
            onChange={() => toggleNeededItem(it.name)}
          />
          {it.name}
        </label>
      ))}
    </div>
  </div>
)}
```

Mechanics:
- **Trigger**: a checkbox "Potrzebuję rzeczy na zajęcia od rodzin" ("I need items for the
  session from families") gates whether the checklist even appears.
- **Source of choices**: the organizer's own `items` catalog (`Item[]`, the same entities
  managed in "Moje rzeczy") — the checklist is built from `items.map(...)`, so the
  organizer is choosing *which of their own things they want brought/returned*, not typing
  free text. This differs from `KragGrupy.tsx`'s `NEEDED_ITEMS`, which is hardcoded
  free-text unconnected to any `Item` record.
- **Persistence of the request**: on `addTerm`, the checked item **names** (not ids) are
  copied into `Term.neededItems: string[]` (PanelOrganizatora.tsx:539). Once the term is
  created, the connection back to the `Item` record is lost — `neededItems` is just
  strings, so renaming or deleting the original `Item` would not update/cascade to any
  `Term.neededItems` entries already created (again, string-copy not FK).
- **No per-term claim/volunteer mechanism on the organizer side**: `PanelOrganizatora.tsx`
  only lets the organizer *state the need* (`toggleNeededItem` builds the request) and
  later *display* the resulting `neededItems` as read-only chips:
  ```
  PanelOrganizatora.tsx:650-654 and 861-865
  {t.neededItems.length > 0 && (
    <div className="org-need-chips">
      {t.neededItems.map((n) => <span className="org-need-chip" key={n}>{n}</span>)}
    </div>
  )}
  ```
  There is **no click handler on these chips** and **no claim/volunteer state anywhere in
  this file** — the organizer cannot see *who* (if anyone) has volunteered to bring a given
  needed item. That "who volunteers" bridging logic exists only in `KragGrupy.tsx`'s
  `toggleBringClaim`/`bringClaims`, and the two are **not wired together** — `Term` (in
  Panel*) and the `NEEDED_ITEMS`/`bringClaims` pair (in KragGrupy) are two entirely separate,
  non-communicating data structures, even though they represent the same real-world concept
  (organizer's item need for a session). This is the single most important integration gap
  for the research question.

### 2.4 `spotkania` (meetings) view structure — Groups + Terms

```
PanelOrganizatora.tsx:807-875 (structure only, abbreviated)
{view === "spotkania" && (
  <>
    {/* ---------- grupy ---------- */}
    <div className="org-section">
      <div className="org-section-title">...Grupy...<button onClick={() => setModal("grupa")}>Dodaj grupę</button></div>
      <div className="org-card">{groups.map((g) => (<div className="org-list-item" key={g.id}>...<button onClick={() => removeGroup(g.id)}>...</button></div>))}</div>
    </div>

    {/* ---------- terminy ---------- */}
    <div className="org-section">
      <div className="org-section-title">...Terminy...<button onClick={() => setModal("termin")}>Dodaj termin</button></div>
      <div className="org-card">{terms.map((t) => (<div className="org-list-item org-date" key={t.id}>...<button onClick={() => removeTerm(t.id)}>...</button></div>))}</div>
    </div>
  </>
)}
```
Confirms: this single view renders two independent CRUD lists side by side — `Group[]` and
`Term[]` — linked only by the string `groupName` on each `Term` (§2.1). There is no UI
concept of "select a group, see only its terms" — all terms for all groups render in one
flat list.

### 2.5 Item mode toggles (`setItemMode`) and Gift display (read-only)

```
PanelOrganizatora.tsx:565-566
const setItemMode = (id: string, mode: ItemMode) =>
  setItems((is) => is.map((i) => (i.id === id ? { ...i, mode: i.mode === mode ? null : mode } : i)));
```
Toggle behavior identical in shape to `toggleBringClaim` (assign-or-clear), but scoped to a
single item's `mode` field, one of three buttons (wypożyczę/oddam/zamienię) rendered per
item (PanelOrganizatora.tsx:900-916). `removeGift` (PanelOrganizatora.tsx:580) is the only
gift-related mutator — gifts cannot be added or edited from the UI, only removed, since they
represent things already received from someone else, not authored by the organizer.

---

## 3. `pages/PanelGoscia.tsx` — participant/guest perspective

### 3.1 Shared types, `MY_TERMS`, read-only "Spotkania"

`PanelGoscia.tsx` declares its own copies of `Profile`, `Term`, `ItemMode`, `Item`,
`GiftSource`, `Gift` (PanelGoscia.tsx:342-408) — textually identical to
`PanelOrganizatora.tsx`'s versions, confirming `pages/SPEC.md`'s claim of "~85%" code
duplication (SPEC.md:26, §1 row 5). Notably, **`Group` is not declared at all** in this
file — the guest has no group-management type.

```
PanelGoscia.tsx:371-373
const MY_TERMS: Term[] = [
  { id: nextId(), day: "27", month: "sie", groupName: "Muzyczne Maluchy", note: "16:30 · Sala nr 2 · zapisani", neededItems: ["Tamburyn i dzwonki", "Mata piankowa"] },
];
```
`MY_TERMS` is the guest's personal, hardcoded subset of terms — only 1 entry, versus the
organizer's 2-entry `INITIAL_TERMS` (PanelOrganizatora.tsx:409-412). It reuses the exact
same `Term` shape, including `neededItems: string[]` — meaning the guest's view *does*
receive the organizer's declared item-needs for a term (as read-only chips, see below), but
cannot act on them (no claim button anywhere in `PanelGoscia.tsx`).

```
PanelGoscia.tsx:436
const [terms] = useState<Term[]>(MY_TERMS);
```
Note the array destructure has **no setter** (`const [terms] = ...`, not
`const [terms, setTerms] = ...`) — this is a hard, deliberate read-only guarantee at the
React-state level, confirming SPEC.md's characterization ("MY_TERMS (tylko odczyt)" —
SPEC.md:81-83, "Brak sekcji Grupy... spotkania pokazuje tylko listę zajęć, na które jest
zapisany (MY_TERMS, tylko odczyt, bez dodawania/usuwania)" — SPEC.md:212).

```
PanelGoscia.tsx:712-739 (spotkania view for guest)
{view === "spotkania" && (
  <div className="org-section">
    <div className="org-section-title">
      <div className="org-section-title-text">
        <h2>Spotkania</h2>
        <small>{terms.length} {terms.length === 1 ? "termin, na który jesteś zapisana" : "terminy, na które jesteś zapisana"}</small>
      </div>
    </div>
    <div className="org-card">
      {terms.length === 0 && <div className="org-empty">Nie jesteś jeszcze zapisana na żadne zajęcia.</div>}
      {terms.map((t) => (
        <div className="org-list-item org-date" key={t.id}>
          ...
          {t.neededItems.length > 0 && (
            <div className="org-need-chips">
              {t.neededItems.map((n) => <span className="org-need-chip" key={n}>{n}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
)}
```
Confirms: **no "Dodaj termin"/"Dodaj grupę" buttons anywhere in `PanelGoscia.tsx`** (grep
of the whole file — the only `setModal` call is for `"rzecz"`, PanelGoscia.tsx:748) — the
guest cannot create/remove groups or terms, matching PanelOrganizatora's `addGroup`/
`addTerm`/`removeGroup`/`removeTerm` being entirely absent from this file. The
`org-need-chips` here are rendered exactly like the organizer's read-only display
(PanelOrganizatora.tsx:650-654) — **no click handler, no volunteer/claim action** — so even
though this is the "guest" panel, it does *not* implement the "zgłoszenie na ochotnika"
(volunteer) interaction described in the research brief. That interaction exists only in
`KragGrupy.tsx`'s `toggleBringClaim`, which is a completely separate component/page from
`PanelGoscia.tsx`.

### 3.2 Differences vs `PanelOrganizatora.tsx` (own re-verification of SPEC.md §3.6)

Confirmed directly against both full files:
- No `Group` type, no `groups` state, no `addGroup`/`removeGroup` in `PanelGoscia.tsx`.
- No `addTerm`/`removeTerm`/`toggleNeededItem` in `PanelGoscia.tsx` — `terms` is a
  read-only, unsettable array (§3.1).
- `Modal` type is narrower: `type Modal = "rzecz" | null;` (PanelGoscia.tsx:413) vs
  `type Modal = "grupa" | "termin" | "rzecz" | null;` in PanelOrganizatora.tsx:453.
- Own items (`rzeczy`) and gifts (`podarki`) management is functionally identical
  (`addItem`/`removeItem`/`setItemMode`/`removeGift` all present and byte-similar in both
  files) — a guest also maintains their own item-offer catalog and gift-receipt list, same
  as the organizer. So "Item"/"Gift" management is symmetric between organizer and
  participant; only "Group"/"Term" management is organizer-exclusive.
- Avatar source differs: guest uses a hardcoded external URL
  (`const GUEST_AVATAR = "https://i.pravatar.cc/160?img=32";` — PanelGoscia.tsx:369)
  instead of importing from the missing `../data/photos` module, which is why (per
  SPEC.md:215) this file actually compiles while `PanelOrganizatora.tsx` does not.

---

## 4. Three inconsistent exchange-mode vocabularies (confirmed)

Directly re-verified in code (not merely trusting SPEC.md) — three separate, non-shared
enumerations describing overlapping ideas around lending/giving/swapping:

| # | Location | Values | Meaning (as used in code) |
|---|---|---|---|
| 1 | `KragGrupy.tsx:279-283` (`MODE_STYLE` keys) / `KragGrupyStart.tsx:267-271` | `"wymienię"` \| `"pożyczę"` \| `"oddam"` | Active voice, first-person future: "I'll swap" / "I'll lend" / "I'll give away" — describes what a *family* is offering (`Family.mode`, paired with `Family.swap`) |
| 2 | `PanelOrganizatora.tsx:393` / `PanelGoscia.tsx:358` (`type ItemMode`) | `"wypożyczę"` \| `"oddam"` \| `"zamienię"` | Active voice, first-person future, but different verbs for "lend" (`wypożyczę`, more formal/rental-flavored than `pożyczę`) and "swap" (`zamienię` vs `wymienię`) — describes what mode an *organizer's/guest's own Item* is offered under |
| 3 | `PanelOrganizatora.tsx:429` / `PanelGoscia.tsx:389` (`type GiftSource`) | `"pożyczone"` \| `"otrzymane"` \| `"zamienione"` | Passive/past-tense: "was lent to me" / "was given to me" / "was swapped to me" — describes how a `Gift` already in hand *arrived*, from the recipient's point of view |

Cross-checked against `pages/SPEC.md:41-49`, which independently documents this exact
3-way split and recommends unification ("To są trzy osobne, nieujednolicone słowniki
opisujące w gruncie rzeczy tę samą ideę... warto ujednolicić nazewnictwo w jeden wspólny
enum" — SPEC.md:47-49). This research confirms SPEC.md's finding is accurate by direct
code inspection; it is not merely an assertion to take on faith.

Semantic mapping across the three sets (own analysis, cross-referencing verb meaning):
- "give away permanently": `oddam` (set 1) = `oddam` (set 2) = `otrzymane` (set 3, passive)
- "lend/borrow temporarily": `pożyczę` (set 1) ≈ `wypożyczę` (set 2) = `pożyczone` (set 3, passive)
- "swap/exchange": `wymienię` (set 1) = `zamienię` (set 2) = `zamienione` (set 3, passive)

So there appear to be exactly **3 underlying modes** (give-away / lend / swap), expressed
in 3 different verb choices depending on grammatical voice (active offering vs. passive
receipt) and which file the code lives in — not 9 distinct concepts, but the vocabulary is
not shared as a single type/enum anywhere in the codebase.

---

## 5. `pages/ProfilMobilny.tsx`

### 5.1 Statistic "Rodziny: 32"

```
ProfilMobilny.tsx:104-109 (markup)
<div className="mv-stat">
  <span className="mv-stat-ico" style={{ background: "var(--teal-soft)" }}><People /></span>
  <span><small>Rodziny</small><b>32</b></span>
</div>
```
The `32` is a **hardcoded literal string in JSX**, not sourced from any `FAMILIES`/`Family`
data structure — there is no import of, or reference to, `KragGrupy.tsx`'s `FAMILIES`
array or any count derived from it. This is a static mock number describing "how many
families are in this leader's groups" in aggregate (across all of "Zuzanna Karaszewska"'s
groups, per the profile's framing at ProfilMobilny.tsx:384-387 — "Rodzinny grajdołek...
Zajęcia umuzykalniające dla dzieci 0–6 lat"), not tied to any specific `Group`.

### 5.2 "Wymiana rzeczy" (exchange of things) section

```
ProfilMobilny.tsx:330-334
const EXCHANGE = [
  { label: "Oddam", count: 3, bg: "var(--mint-soft)", c: "#12604D", Icon: GiftIcon },
  { label: "Wymienię", count: 4, bg: "var(--lime-soft)", c: "#56701F", Icon: SwapIcon },
  { label: "Wypożyczę", count: 0, bg: "var(--teal-soft)", c: "#245F61", Icon: BasketIcon },
];
```
Rendered at ProfilMobilny.tsx:430-439. This introduces a **fourth vocabulary variant**:
labels here are `"Oddam"` / `"Wymienię"` / `"Wypożyczę"` — capitalized display labels that
mix set-1's `"Wymienię"` with set-2's `"Wypożyczę"`, while `"Oddam"` is shared by both sets.
This is not identical to either `MODE_STYLE` or `ItemMode` — it's an independently authored
array with its own hardcoded counts (3/4/0), not computed from any `Item[]`/`itemCounts`
data (contrast with `PanelOrganizatora.tsx`'s `itemCounts` object at
PanelOrganizatora.tsx:568-572, which *is* computed live from `items.filter(...)`). This
confirms `ProfilMobilny.tsx` is a pure read-only "public profile" mock with no live
connection to the organizer's actual item catalog — a distinct duplication/inconsistency
not previously called out in SPEC.md's §2 vocabulary list (SPEC.md only names 3 sets, not
this 4th display-only set).

### 5.3 Other content

- `AVATAR_SRC`, `HERO_SRC` imported from `../data/photos` (ProfilMobilny.tsx:2) — module
  does not exist in the repo (independently confirmed missing via Glob of the whole repo
  root and `pages/` — no `data/photos.*` file found), consistent with SPEC.md:22's
  documented critical gap.
- No `Group`/`Family`/`Term`/`Item` types declared in this file at all — it is purely
  presentational, consuming only local `DATES` and `EXCHANGE` constants plus a `toast`
  state and the `onOpenGallery` prop.

---

## 6. `pages/StronaGlowna.tsx` and `pages/GaleriaZdjec.tsx` — secondary, confirmed no additional relational concepts

### 6.1 `StronaGlowna.tsx`

Purely a landing page. Props are navigation callbacks only:
```
StronaGlowna.tsx:213-223
export default function StronaGlowna({
  onOpenProfil,
  onOpenKrag,
  onOpenPanelOrganizatora,
  onOpenPanelGoscia,
}: {
  onOpenProfil: () => void;
  onOpenKrag: () => void;
  onOpenPanelOrganizatora: () => void;
  onOpenPanelGoscia: () => void;
}) {
```
No `Family`/`Group`/`Term`/`Item` types or data. The only domain-adjacent content is
marketing copy referencing the exchange concept in prose (e.g. "co się dzieje: kto
przychodzi, czego potrzeba na zajęcia i co akurat krąży między rodzinami" —
StronaGlowna.tsx:266-268, and step 3 of `STEPS`: "Bawicie się i wymieniacie... grzechotki,
maty i książeczki krążą między rodzinami" — StronaGlowna.tsx:208) and a `FEATURES` array
whose `key` values (`"profil" | "krag" | "panel" | "gosc"`, StronaGlowna.tsx:178-203) name
the four other pages but carry no relational/domain data. Confirms this file is secondary
for domain modeling purposes, as anticipated in the research plan.

### 6.2 `GaleriaZdjec.tsx`

```
GaleriaZdjec.tsx:33-35
type Photo = { id: string; label: string; src: string };

export default function GaleriaZdjec({ photos, onBack }: { photos: Photo[]; onBack: () => void }) {
```
Only a `Photo` type (`id`, `label`, `src`) and a lightbox `useState<Photo | null>`. No
Organizer/Group/Participant concepts whatsoever. This is, per `pages/SPEC.md:118-119` and
independently confirmed here, "the only component that correctly receives data via props
instead of keeping it hardcoded in the file" — i.e. it is an architectural outlier (props-
driven) rather than a domain-model outlier.

---

## 7. `pages/SPEC.md` — treated as pre-existing reliable analysis, cited findings used above

Key SPEC.md findings already cited inline above; consolidated here for completeness:

- **No App shell / router**: "Brak App shell / routera... Callbacki nawigacyjne
  (`onOpenProfil`, `onOpenKrag`, `onOpenPanelOrganizatora`, `onOpenPanelGoscia`,
  `onOpenGallery`, `onBack`) nie mają obecnie żadnego wywołującego" (SPEC.md:23). Confirmed
  by direct reading — every page is a standalone default export with no shared parent
  component in `pages/`.
- **Missing `../data/photos` module**: breaks compilation of `ProfilMobilny.tsx` and
  `PanelOrganizatora.tsx` (SPEC.md:22; independently confirmed by Glob search finding no
  `data/photos.*` file anywhere in the repo).
- **`KragGrupy.tsx` / `KragGrupyStart.tsx` ~99% duplicate** (SPEC.md:25) — confirmed by
  full-file comparison in §1 above; only the `FAMILIES` array length and one subtitle
  string differ.
- **`PanelOrganizatora.tsx` / `PanelGoscia.tsx` ~85% duplicate** (SPEC.md:26) — confirmed
  in §2/§3 above: identical CSS, icons, `Profile`/`Term`/`Item`/`ItemMode`/`Gift`/
  `GiftSource` types, toast pattern; organizer-only additions are `Group` type + `groups`
  state + `addGroup`/`removeGroup`/`addTerm`/`removeTerm`/`toggleNeededItem`.
- **Product naming inconsistency**: "Rodzinny grajdołek" (StronaGlowna, PanelOrganizatora,
  PanelGoscia) vs "Muzyczna Wioska" (KragGrupy*, ProfilMobilny) (SPEC.md:24) — confirmed:
  `KragGrupy.tsx:4` comment says "Muzyczna Wioska" and header shows "Muzyczne Maluchy" (a
  *group* name, distinct from either product name) at KragGrupy.tsx:358; `ProfilMobilny.tsx:5`
  comment also says "Muzyczna Wioska" but renders "Rodzinny grajdołek" as the on-screen title
  (ProfilMobilny.tsx:385) — so the inconsistency is even messier than a clean two-way split:
  comments and rendered text disagree within the same file.
- **Recommended vocabulary unification** across the 3 (now 4, per §5.2 above) mode sets
  (SPEC.md:46-49).
- **100% of state is in-memory only, nothing persists** (SPEC.md:14, "backendu / API — cały
  stan żyje w pamięci komponentu i znika po odświeżeniu", and §5 recommendation #8,
  SPEC.md:251-253) — confirmed throughout: every list (`FAMILIES`, `groups`, `terms`,
  `items`, `gifts`, `bringClaims`) is `useState` with no fetch/persist calls anywhere in any
  of the 7 files.

---

## 8. Summary table — concepts and their exact code location

| Concept (informal) | Named type? | File(s) | Line(s) | Group/Org/Participant link representation |
|---|---|---|---|---|
| Family / participant household | No (implicit shape) | KragGrupy.tsx, KragGrupyStart.tsx | 260-277 | Membership = array containment only; no `groupId` field |
| Organizer (group leader) | No (hardcoded string) | KragGrupy.tsx, KragGrupyStart.tsx | 441 ("Zuzanna Karaszewska") | Positional (center of circle) only, no data field |
| Group (as a named type) | Yes, `type Group` | PanelOrganizatora.tsx | 377-382 | No `organizerId`; no member list, only `freeSpots: number` |
| Term / session | Yes, `type Term` | PanelOrganizatora.tsx, PanelGoscia.tsx | 384-391 / 349-356 | Links to Group via `groupName: string` (name match, not FK) |
| Item (own catalog entry) | Yes, `type Item` | PanelOrganizatora.tsx, PanelGoscia.tsx | 395-399 / 360-364 | Owned implicitly by the single signed-in user of that panel |
| ItemMode | Yes, `type ItemMode` | PanelOrganizatora.tsx, PanelGoscia.tsx | 393 / 358 | Attribute of `Item`, not a role/party concept |
| Gift (received item) | Yes, `type Gift` | PanelOrganizatora.tsx, PanelGoscia.tsx | 431-436 / 391-396 | `from: string` free text, not FK to any Family/Party |
| GiftSource | Yes, `type GiftSource` | PanelOrganizatora.tsx, PanelGoscia.tsx | 429 / 389 | Attribute of `Gift` |
| NEEDED_ITEMS (organizer's ask) | No (flat `string[]`) | KragGrupy.tsx, KragGrupyStart.tsx | 289 | Free-standing, string-matched against `Family.bring`, not linked to any `Term` |
| Term.neededItems (organizer's ask, Panel* version) | Field on `Term`, `string[]` | PanelOrganizatora.tsx, PanelGoscia.tsx | 390 / 355 | Populated from `Item.name` at term-creation time (copy, not FK); read-only, no claim mechanism |
| BringClaim (volunteer pledge) | Yes, `type BringClaim` | KragGrupy.tsx, KragGrupyStart.tsx | 291 | Keyed by item-name string in `bringClaims` map; not linked to `Term.neededItems` |
| toggleBringClaim (volunteer action) | Function | KragGrupy.tsx, KragGrupyStart.tsx | 307-313 | Self-service, 1 claimant per item, revocable by claimant only, no override of others |
| toggleNeededItem (organizer's item-request action) | Function | PanelOrganizatora.tsx | 547-551 | Only mutates the in-progress `termForm`, before `Term` is created — not usable after creation |

---

## Open gaps directly observed in code (not present anywhere in `pages/`)

- No field or code path anywhere links `KragGrupy.tsx`'s `NEEDED_ITEMS`/`bringClaims`
  (volunteer mechanism) to `PanelOrganizatora.tsx`'s `Term.neededItems` (organizer's
  request mechanism) — these are two disconnected implementations of what the research
  question treats as one flow ("organizator prosi o rzecz → uczestnik zgłasza się na
  ochotnika").
- No `RoleType`/`Relationship`/validity concept anywhere — no start/end dates for group
  membership, no distinction in code between "parent," "child," "organizer" as roles with
  time-boxed validity. `kids: string` on `Family` is a free-text description, not a
  separate child entity or role.
- No explicit `organizerId` on `Group`, no explicit `groupId` on `Family`/`Term`/`Item`,
  no explicit `familyId`/`participantId` anywhere that would allow a real relational query
  ("all groups this organizer runs," "all families in this group," "all items this family
  offers") — every cross-reference observed in `pages/` is either positional (array order/
  containment) or a **free-text string match** (`groupName`, `Gift.from`, `Family.bring` ↔
  `NEEDED_ITEMS`).
