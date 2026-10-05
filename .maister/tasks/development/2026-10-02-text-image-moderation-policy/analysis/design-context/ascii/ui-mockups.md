# UI Mockups: Text + image moderation policy

**Generated**: 2026-10-02
**Task Path**: `.maister/tasks/development/2026-10-02-text-image-moderation-policy`
**Feature Type**: Enhancement (error surfacing + status display; no new screens, no new components)

All paths below are relative to `src/frontend/src/`. User-facing copy is Polish. The admin back office (`/admin/*`, Chakra UI) is in English today, so its chrome stays English. Only the server message shown inside it is Polish.

---

## Overview

### UI requirements
1. **Synchronous text rejection (400).** Seven forms must show the server's Polish `{message}` that names the field, for example "Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.".
2. **Fail-closed (503).** The same forms must show "Moderacja jest chwilowo niedostępna — spróbuj za chwilę." (see the [503 gap](#gap-503)).
3. **Photo status.** PENDING "W moderacji", NEEDS_REVIEW "Do sprawdzenia", REJECTED "Odrzucone". The status refreshes by itself while any photo is PENDING (polling every ~10 s).
4. **ItemDetailPage.** The owner text-moderation banner is removed.
5. **Admin queue.** Text cards ("Name + description") are removed. Photos only.

### Integration strategy
**Decision:** add no new components and no new layout. In every form, change one line in the `catch` so it calls `serverMessageOr(err, <existing Polish fallback>)`. The error then renders in the **slot that form already uses** (inline `<p class="text-danger">`, a `danger-soft` box, the panel toast, or a Chakra red box). Photo badges reuse `ModerationBadge`. Polling is a `refetchInterval` on the existing `useItemDetail` query.

**Rationale:** the rejection is a normal domain 400, exactly like the existing contact-info rule (`moderation/rules.py`). The forms that already use `serverMessageOr` (`useItemDetail.ts`, `useCreateItem.ts`, `FirstTermStepperGuest.tsx`) prove the pattern works. A new "moderation error" component would duplicate it.

### Legend
```
[NEW]       added by this task
[CHANGED]   existing element whose behaviour/content changes
[REMOVED]   deleted by this task
(existing)  unchanged, shown for orientation
```

---

## Existing Layout Analysis

### Application structure
- **Mobile-first user app.** Pages wrap in `PhoneFrame` (`components/shared/PhoneFrame.tsx`) with the bottom `PanelNavBar` (`pages/panel/PanelNav.tsx`). Panel dialogs use `ModalSheet` + `Field` (`pages/panel/panelComponents.tsx:92,101`). The panel toast is rendered in `pages/panel/PanelPage.tsx:75` (`role="status"`, auto-hides after **2200 ms**, `PanelDataContext.tsx:623`).
- **Card shell pages.** `OrganizationPage.tsx` and `OnboardingWizard.tsx` both use a centred `max-w-[440px]` card.
- **Admin back office.** Chakra UI: `pages/ModerationPage.tsx` → `pages/ContentModerationQueue.tsx`, and `pages/ProductFormPage.tsx`.

### Error-rendering patterns found (keep them)

| Pattern | Markup | Used by |
|---|---|---|
| E1 danger box | `rounded-xl bg-danger-soft px-3 py-2.5 text-[13px] text-danger` | OrganizationPage.tsx:126, OnboardingWizard.tsx:111 |
| E2 inline text | `mt-2 text-[12.5px] font-semibold text-danger` | EditTermDialog.tsx:314/:421, FirstTermStepperOrganizer.tsx:96, PanelModals.tsx:264 |
| E3 field editor alert | `<p role="alert" className={ERROR_TEXT}>` (`mt-1.5 text-[12.5px] font-semibold text-danger`) | ItemFieldEditors.tsx:119/163/204 (already `serverMessageOr`) |
| E4 panel toast | `showToast(msg)` → PanelPage.tsx:75 | handleAddGroup, handleAddTerm (PanelDataContext.tsx:840, :895) |
| E5 Chakra red box | `Box bg="#FEE2E2" color="#991B1B"` | ProductFormPage.tsx:230 |

### Status-display patterns
- `ModerationBadge` (`pages/product/ItemGalleryEditor.tsx:14-24`). A pill: cream/ink-soft for PENDING and NEEDS_REVIEW, `danger-soft`/`danger` for REJECTED. It returns null for APPROVED.
- `ItemGallery` (`pages/product/ItemGallery.tsx:84-88`) shows the badge at the top-left of the **current** slide.
- `ItemGalleryEditor` (`ItemGalleryEditor.tsx:~125`) shows the badge next to "Zdjęcie N" on each row.

---

<a id="message-catalogue"></a>
## Message catalogue (rendered verbatim from the server)

The FE never builds these strings. It passes `err.body.message` through. The list is here so the mockups and tests use the same text.

| Field | 400 message (proposed backend copy) |
|---|---|
| Organisation name | `Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie.` |
| Group name | `Nazwa grupy narusza zasady społeczności. Zmień ją i spróbuj ponownie.` |
| Term description | `Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.` |
| Product name | `Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.` |
| Product description | `Opis rzeczy narusza zasady społeczności. Zmień go i spróbuj ponownie.` |
| Any field, model down (503) | `Moderacja jest chwilowo niedostępna — spróbuj za chwilę.` |

<a id="gap-503"></a>
### Gap: 503 does not pass through `serverMessageOr`
`api/problem.ts:62-74` returns `err.body.message` only for **400/409**. A 503 therefore shows the form's generic fallback ("Nie udało się zapisać… spróbuj ponownie"), even after all 7 forms switch to `serverMessageOr`. Two options for the spec:
- **(a) Recommended:** add `|| err.status === 503` to the pass-through condition in `serverMessageOr`. This is one line, and every caller benefits, including `useItemDetail`/`useCreateItem`.
- **(b)** Accept the generic fallback for 503. It still says "spróbuj ponownie", but the user cannot tell that a retry later will work.

The mockups below assume (a).

---

## Mockups

<a id="organization-page"></a>
### Mockup 1: OrganizationPage, rejected / unavailable name

**Context:** `/organizacja` (`pages/OrganizationPage.tsx`). Create or rename the organisation. Today `:72` shows `err.message` = **"400 Bad Request"**.

```
┌──────────────────────────────────────────────┐
│ ← Wróć                                       │
│                                              │
│          Moja organizacja                    │
│   Nazwa widoczna na Twojej publicznej        │
│   stronie.                                   │
│                                              │
│  NAZWA ORGANIZACJI                           │
│  ┌────────────────────────────────────────┐  │
│  │ <user's text — kept, not cleared>      │  │  (existing input #org-name)
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌ TWOJA PUBLICZNA STRONA ────────────────┐  │  (existing, only when org exists)
│  │ https://…/muzyczne-skrzaty             │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │  [CHANGED] E1 danger box, content
│  │ Nazwa organizacji narusza zasady       │  │  = serverMessageOr(err,
│  │ społeczności. Zmień ją i spróbuj       │  │    "Nie udało się zapisać
│  │ ponownie.                              │  │     organizacji")
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │               Zapisz                   │  │  (existing submit)
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘

503 variant (same box):
│  │ Moderacja jest chwilowo niedostępna —  │  │
│  │ spróbuj za chwilę.                     │  │
```

**Integration points:**
- `OrganizationPage.tsx:72`: change `err instanceof Error ? err.message : …` to `serverMessageOr(err, "Nie udało się zapisać organizacji")`.
- The "Zapisano." success box already hides while `error` is set (`saved && !error`).
- The input value is kept, so the user edits it and resubmits.

**Accessibility:** the E1 box has no `role`. Add `role="alert"` so the rejection is announced, matching E3. This is a one-attribute change on the existing div.

---

<a id="onboarding-wizard"></a>
### Mockup 2: OnboardingWizard, steps 1-3 (org, group, term)

**Context:** `pages/OnboardingPage.tsx` → `components/onboarding/OnboardingWizard.tsx`, with steps from `components/onboarding/steps/organizerSteps.tsx` (`createMyOrganization`, `createMyCircle`, `createTerm`). Today `:69` shows "400 Bad Request".

```
┌──────────────────────────────────────────────┐
│                                         ✕    │
│              Krąg grupy                      │
│              ●  ●  ○                          │
│              Krok 2 z 3                       │
│                                              │
│  Nazwa grupy                                 │  ← step title (existing)
│  ┌────────────────────────────────────────┐  │
│  │ <user's text — kept>                   │  │  #onboarding-circle-name
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │  [CHANGED] E1 danger box
│  │ Nazwa grupy narusza zasady             │  │  serverMessageOr(err,
│  │ społeczności. Zmień ją i spróbuj       │  │   "Nie udało się zapisać kroku")
│  │ ponownie.                              │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  [ Pomiń ]                     [ Dalej → ]   │  wizard stays on step 2
└──────────────────────────────────────────────┘

Same slot per step:
  Krok 1 "Nazwa organizacji" → "Nazwa organizacji narusza zasady…"
  Krok 2 "Nazwa grupy"       → "Nazwa grupy narusza zasady…"
  Krok 3 "Termin zajęć"      → "Opis terminu narusza zasady…"
                               (input #onboarding-term-description)
```

**Integration points:**
- `OnboardingWizard.tsx:69`: use `serverMessageOr(err, "Nie udało się zapisać kroku")`. The wizard already keeps `stepIndex` on failure.
- Step 1 runs before step 2 and is committed once it succeeds. A rejection on step 2 therefore does not re-moderate the org name when the user goes on (the backend moderates only changed values, and `createMyOrganization` is idempotent).
- Add `role="alert"` to the E1 box (`:111`), as in Mockup 1.

---

<a id="panel-add-group-modal"></a>
### Mockup 3: Panel, "Dodaj nową grupę" modal (toast pattern)

**Context:** `pages/panel/PanelModals.tsx:137-193`, handler `PanelDataContext.tsx:819 handleAddGroup` (`createAdditionalMyCircle`). Today the catch at `:840` shows the toast "Nie udało się dodać grupy". The modal stays open because `setModal(null)` runs only on success.

```
┌──────────────────────────────────────────────┐
│ Dodaj nową grupę                         ✕   │  ModalSheet (existing)
│                                              │
│  Nazwa grupy                                 │
│  ┌────────────────────────────────────────┐  │
│  │ <user's text — kept>                   │  │
│  └────────────────────────────────────────┘  │
│  Lokalizacja           Ile miejsc            │
│  ┌──────────────────┐  ┌──────────────────┐  │
│  │ Sala nr 2        │  │ 0                │  │
│  └──────────────────┘  └──────────────────┘  │
│  Widoczność grupy                            │
│  ┌────────────────────────────────────────┐  │
│  │ Publiczna                            ▾ │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │            Dodaj grupę                 │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
        ┌──────────────────────────────────────────┐
        │ Nazwa grupy narusza zasady społeczności. │ [CHANGED] toast text =
        │ Zmień ją i spróbuj ponownie.             │ serverMessageOr(err,
        └──────────────────────────────────────────┘ "Nie udało się dodać grupy")
          PanelPage.tsx:75 (role="status", bottom-[86px])
```

**Integration points:**
- `PanelDataContext.tsx:840`: change `catch {` to `catch (err) { showToast(serverMessageOr(err, "Nie udało się dodać grupy")) }`. The fallback string stays unchanged.
- **Concern (decision for spec):** the toast disappears after 2200 ms, which is too short for a two-sentence instruction, and the message sits outside the modal. Option **B (recommended if a slightly larger change is acceptable)** reuses the E2 inline pattern that "Edytuj grupę" already has (`editGroupError`, PanelModals.tsx:263). Add an `addGroupError` state and render `<p className="mt-2 text-[12.5px] font-semibold text-danger">` above "Dodaj grupę". This needs no new component, only one state plus one `<p>` copied from the sibling modal. Mockup with option B:

```
│  ┌────────────────────────────────────────┐  │
│  │ Publiczna                            ▾ │  │
│  └────────────────────────────────────────┘  │
│  Nazwa grupy narusza zasady społeczności.    │  [NEW, option B] E2 inline
│  Zmień ją i spróbuj ponownie.                │  (copy of PanelModals.tsx:264)
│  ┌────────────────────────────────────────┐  │
│  │            Dodaj grupę                 │  │
```

---

<a id="panel-edit-group-modal"></a>
### Mockup 4: Panel, "Edytuj grupę" modal (inline pattern)

**Context:** `PanelModals.tsx:196-275`, handler `PanelDataContext.tsx:1166 saveEditGroup`. It already renders `editGroupError` inline (E2). Only the string is generic today ("Nie udało się zapisać zmian — spróbuj ponownie", `:1202`).

```
┌──────────────────────────────────────────────┐
│ Edytuj grupę                             ✕   │
│  Nazwa grupy                                 │
│  ┌────────────────────────────────────────┐  │
│  │ <renamed text — kept>                  │  │
│  └────────────────────────────────────────┘  │
│  Lokalizacja           Ile miejsc            │
│  Szablon wizualizacji  [ … ▾ ]               │
│  Widoczność grupy      [ Publiczna — … ▾ ]   │
│                                              │
│  Nazwa grupy narusza zasady społeczności.    │  [CHANGED] E2 text =
│  Zmień ją i spróbuj ponownie.                │  serverMessageOr(err, "Nie udało
│                                              │  się zapisać zmian — spróbuj ponownie")
│  ┌────────────────────────────────────────┐  │
│  │               Zapisz                   │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

**Integration points:**
- `PanelDataContext.tsx:1201-1202`: change to `catch (err) { setEditGroupError(serverMessageOr(err, …)) }`.
- A PATCH that changes only layout or visibility sends the same name. The backend compares against the stored value, so **no rejection appears for an unchanged name**, and there is no FE work for that case.
- Add `role="alert"` to the `<p>` at PanelModals.tsx:264.

---

<a id="panel-add-term-modal"></a>
### Mockup 5: Panel, "Dodaj termin zajęć" modal (term description + needed items)

**Context:** `PanelModals.tsx:277-366`, handler `PanelDataContext.tsx:867 handleAddTerm`. It calls `createTerm` (term description is moderated) and then `resolveProduct` per drafted needed item (`:887`, so a new product name is moderated). The catch at `:895` shows the toast "Nie udało się dodać terminu".

```
┌──────────────────────────────────────────────┐
│ Dodaj termin zajęć                       ✕   │
│  Grupa             [ Nutki dla starszaków ▾ ]│
│  Data i godzina    [ 2026-10-14 17:00      ] │
│  Opis (opcjonalnie)                          │
│  ┌────────────────────────────────────────┐  │
│  │ <user's text — kept>                   │  │
│  └────────────────────────────────────────┘  │
│  Potrzebne rzeczy (opcjonalnie)              │
│   Hulajnoga — dla 5-latka          Usuń      │
│   <rejected product name>          Usuń      │
│   + Dodaj potrzebną rzecz                    │
│  ┌────────────────────────────────────────┐  │
│  │            Dodaj termin                │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
      ┌──────────────────────────────────────────┐
      │ Opis terminu narusza zasady…   (or)      │ [CHANGED] toast =
      │ Nazwa rzeczy narusza zasady…             │ serverMessageOr(err,
      └──────────────────────────────────────────┘ "Nie udało się dodać terminu")
```

**Integration points:**
- `PanelDataContext.tsx:895`: `catch (err) { showToast(serverMessageOr(err, "Nie udało się dodać terminu")) }`.
- The toast-duration concern from Mockup 3 applies. Option B is the same: an inline E2 `<p>` above "Dodaj termin".
- **Pre-existing partial-success hazard (flag for spec):** the term is created **before** the needed-item loop. When a needed-item name is rejected, the term already exists but the modal stays open with its fields intact, so pressing "Dodaj termin" again creates a **duplicate term**. Sync rejection makes this path common. Two minimal mitigations: (1) on a failure after `createTerm`, close the modal, `load()`, and show "Dodano termin, ale nie udało się dodać części rzeczy: <message>"; or (2) resolve all products first, then create the term. Option (2) changes no UI.

---

<a id="first-term-stepper-organizer"></a>
### Mockup 6: FirstTermStepperOrganizer, "Dodaj pierwszy termin"

**Context:** `components/panel/FirstTermStepperOrganizer.tsx`, opened from PanelModals.tsx:61. The catch at `:43` sets the fixed string "Nie udało się dodać terminu — spróbuj ponownie".

```
┌──────────────────────────────────────────────┐
│ Dodaj pierwszy termin                    ✕   │
│  Data i godzina                              │
│  ┌────────────────────────────────────────┐  │
│  │ 2026-10-14T17:00                       │  │
│  └────────────────────────────────────────┘  │
│  Opis (opcjonalnie)                          │
│  ┌────────────────────────────────────────┐  │
│  │ <user's text — kept>                   │  │
│  └────────────────────────────────────────┘  │
│  Opis terminu narusza zasady społeczności.   │  [CHANGED] E2 formError =
│  Zmień go i spróbuj ponownie.                │  serverMessageOr(err, "Nie udało się
│  ┌────────────────────────────────────────┐  │   dodać terminu — spróbuj ponownie")
│  │            Dodaj termin                │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

**Integration points:** `:43`, change `catch {` to `catch (err)` + `serverMessageOr`. Add `role="alert"` on `:96`.

---

<a id="edit-term-dialog"></a>
### Mockup 7: EditTermDialog, term description + needed-item edit/add

**Context:** `components/panel/EditTermDialog.tsx` (ModalSheet "Edytuj termin"). It has two independent E2 error slots: `formError` (`:314`, term fields) and `itemsError` (`:421`, the "Potrzebne rzeczy" list).

```
┌──────────────────────────────────────────────┐
│ Edytuj termin                            ✕   │
│  Data i godzina   [ 2026-10-14T17:00       ] │
│  Opis             [ <user's text — kept>   ] │
│  Opis terminu narusza zasady społeczności.   │  [CHANGED] formError (:173)
│  Zmień go i spróbuj ponownie.                │
│  ┌────────────────────────────────────────┐  │
│  │               Zapisz                   │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Potrzebne rzeczy                            │
│  ┌────────────────────────────────────────┐  │
│  │ Nazwa rzeczy [ <rejected name>       ] │  │  row in edit mode
│  │ Kategoria    [ Zabawki ▾ ]             │  │  ← [CHANGED] must STAY open
│  │ Opis         [ …                     ] │  │    on error (see below)
│  │ [ Zapisz ] [ Anuluj ]                  │  │
│  └────────────────────────────────────────┘  │
│   Rower — 16 cali             Edytuj  Usuń   │
│   + Dodaj potrzebną rzecz                    │
│  Nazwa rzeczy narusza zasady społeczności.   │  [CHANGED] itemsError
│  Zmień ją i spróbuj ponownie.                │  (:228 saveEdit, :263 addItem)
│                                              │
│  Formalizuj stałych członków  (existing)     │
└──────────────────────────────────────────────┘
```

**Integration points:**
- `:173` (`saveTermFields`): `setFormError(serverMessageOr(err, "Nie udało się zapisać zmian terminu — spróbuj ponownie"))`.
- `:228` (`saveEdit`): `setItemsError(serverMessageOr(err, "Nie udało się zapisać zmiany — spróbuj ponownie"))`. **Also drop the `setEditing(null)` in that catch.** Today it closes the row editor and throws away the typed name, so the user would have to retype the text the message asks them to change. `addItem` (`:263`) already keeps `adding`/`newDraft` open on failure, so only its message changes.
- Add `role="alert"` on `:314` and `:421`.

---

<a id="item-edit-page"></a>
### Mockup 8: ItemEditPage field editors (already correct, shown for reference)

**Context:** `/product/:id/edit` (`pages/product/ItemEditPage.tsx`). The name/category and description editors go through `useItemEditing.mutate` (`hooks/useItemDetail.ts:116-123`), which already calls `serverMessageOr(err, SAVE_FALLBACK)`. They render E3 under the editor. **No change** apart from the 503 pass-through ([gap](#gap-503)). `ItemCreatePage` / `useCreateItem.ts:45` behave the same way.

```
┌──────────────────────────────────────────────┐
│ Edycja rzeczy                     [ Gotowe ] │
│ ┌──────────────────────────────────────────┐ │
│ │ ZDJĘCIA (3/…)                         ✎  │ │  → Mockup 10 when open
│ │ [▢][▢][▢]                                │ │
│ └──────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────┐ │
│ │ NAZWA I KATEGORIA                        │ │
│ │ [ <rejected name>                      ] │ │
│ │ [ Zabawki ▾ ]                            │ │
│ │ Nazwa rzeczy narusza zasady              │ │  (existing) E3 role="alert"
│ │ społeczności. Zmień ją i spróbuj…        │ │  ItemFieldEditors.tsx:119
│ │ [ Zapisz ] [ Anuluj ]                    │ │
│ ├──────────────────────────────────────────┤ │
│ │ STAN   Bardzo dobry                   ✎  │ │
│ ├──────────────────────────────────────────┤ │
│ │ OPIS                                     │ │
│ │ [ <rejected description>               ] │ │
│ │ Opis rzeczy narusza zasady…              │ │  (existing) E3 :204
│ │ [ Zapisz ] [ Anuluj ]                    │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

<a id="admin-product-form"></a>
### Mockup 9: Admin ProductFormPage (catalog product)

**Context:** `/admin/products/new` and `/admin/products/:id/edit` (`pages/ProductFormPage.tsx`, Chakra, English chrome). The catch at `:84` sets "Failed to save product.".

```
┌────────────────────────────────────────────────────────────────┐
│ Products / Edit Product                                        │
│                                                                │
│ Product Name *            SKU *                                │
│ [ <rejected name>      ]  [ ABC-123            ]               │
│ Category *                                                     │
│ [ Zabawki ▾ ]                                                  │
│ Description                                                    │
│ [ <rejected description>                                     ] │
│ Photo URL                                                      │
│ [ https://…                                                  ] │
│                                                                │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Opis rzeczy narusza zasady społeczności. Zmień go i        │ │ [CHANGED] E5 =
│ │ spróbuj ponownie.                                          │ │ serverMessageOr(err,
│ └────────────────────────────────────────────────────────────┘ │ "Failed to save product.")
│ ──────────────────────────────────────────────────────────────│
│                                      [ Cancel ] [ Save ]       │
└────────────────────────────────────────────────────────────────┘
```

**Integration points:** `:84`, `catch (err) { setError(serverMessageOr(err, "Failed to save product.")) }`. The English fallback stays to match the admin chrome. The server's Polish message shows as-is. Add `role="alert"` to the Box at `:231`.

---

<a id="item-detail-page"></a>
### Mockup 10: ItemDetailPage, text banner removed, photo badges

**Context:** `/product/:id` (`pages/product/ItemDetailPage.tsx`), owner view. Product text is now either saved (approved) or rejected at submit, so the "sprawdzane / odrzucone" text state no longer exists.

```
BEFORE (owner, text_status != APPROVED)        AFTER
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│ ← Wróć                           │   │ ← Wróć                           │
│ ┌──────────────────────────────┐ │   │ ┌──────────────────────────────┐ │
│ │[W moderacji]                 │ │   │ │[W moderacji]                 │ │ ItemGallery
│ │        (photo 1)             │ │   │ │        (photo 1)             │ │ (existing badge,
│ │                       1 / 3  │ │   │ │                       1 / 3  │ │  ItemGallery.tsx:84)
│ └──────────────────────────────┘ │   │ └──────────────────────────────┘ │
│ [▣][▢][▢]                        │   │ [▣][▢][▢]                        │
│                                  │   │                                  │
│ Hulajnoga            ✎ Edytuj    │   │ Hulajnoga            ✎ Edytuj    │
│ Zabawki · Stan: Bardzo dobry     │   │ Zabawki · Stan: Bardzo dobry     │
│ [W moderacji] Nazwa i opis są    │   │                                  │ [REMOVED]
│ sprawdzane — inni zobaczą opis,  │   │                                  │ ItemDetailPage.tsx
│ a rzecz da się udostępnić po     │   │                                  │ :94-100
│ weryfikacji.                     │   │                                  │
│ ┌──────────────────────────────┐ │   │ ┌──────────────────────────────┐ │
│ │ OPIS                         │ │   │ │ OPIS                         │ │
│ │ <description>                │ │   │ │ <description>                │ │ always visible now
│ └──────────────────────────────┘ │   │ └──────────────────────────────┘ │
│ ReadOnlyCards / historia …       │   │ ReadOnlyCards / historia …       │
├──────────────────────────────────┤   ├──────────────────────────────────┤
│ PanelNavBar                      │   │ PanelNavBar                      │
└──────────────────────────────────┘   └──────────────────────────────────┘
```

**Integration points:**
- Delete the `{item.is_owner && item.text_status !== "APPROVED" && …}` block (`:94-101`) and the now-unused `ModerationBadge` import (`:11`).
- `api/items.ts:36`: remove `text_status` from `ItemDetailsResponse`. Update the fixtures in the ItemDetailPage / useItemDetail tests.
- `ItemGalleryEditor.tsx:13` doc comment: "on a photo (or text)" becomes "on a photo".
- The gallery is unchanged. The badge for the current slide comes from `photos[i].status`.

<a id="item-gallery"></a>
#### Gallery badge states (owner only; non-owners only ever receive APPROVED photos)

```
PENDING                     NEEDS_REVIEW                REJECTED
┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
│[W moderacji]         │    │[Do sprawdzenia]      │    │[Odrzucone]           │
│                      │    │                      │    │                      │
│      (photo)         │    │      (photo)         │    │      (photo)         │
│                1 / 3 │    │                2 / 3 │    │                3 / 3 │
└──────────────────────┘    └──────────────────────┘    └──────────────────────┘
 cream / ink-soft pill       cream / ink-soft pill       danger-soft / danger pill
 AI verdict not in yet       AI unsure, OR VPS B failed  ShieldGemma ≥ reject threshold
 (20–90 s on VPS B)          after all retries → admin   or admin rejected
 → polled (Mockup 11)        → NOT polled (terminal for   → NOT polled
                               the owner; admin decides)
```

<a id="item-gallery-editor"></a>
#### Gallery editor rows (ItemEditPage, photos field open)

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────────────────────────────┐ │
│ │ [▢] Zdjęcie 1 [W moderacji]    ˄ ˅  🗑   │ │  ItemGalleryEditor.tsx:~125
│ │ [▢] Zdjęcie 2 [Do sprawdzenia] ˄ ˅  🗑   │ │  (existing rows + badge)
│ │ [▢] Zdjęcie 3 [Odrzucone]      ˄ ˅  🗑   │ │  REJECTED does not count toward
│ └──────────────────────────────────────────┘ │  the photo limit (activeCount)
│ [ + Dodaj zdjęcie ]                          │
└──────────────────────────────────────────────┘
```
No change except that the badges now update by themselves through polling.

---

<a id="pending-photo-polling"></a>
### Mockup 11: Pending-photo polling behaviour

**Context:** `hooks/useItemDetail.ts:43` `useItemDetail` (query key `[ITEM_DETAILS_KEY, itemId]`). This one query feeds **both** ItemDetailPage and ItemEditPage, so a single change covers the view gallery, the edit strip and the editor rows.

```
 Owner uploads photo (POST /products/{id}/photos)
        │  mutate() → invalidate ITEM_DETAILS_KEY
        ▼
 ┌─────────────────────────────┐
 │ item.photos[k].status =     │
 │ PENDING  → badge            │
 │ "W moderacji"               │
 └──────────────┬──────────────┘
                │ refetchInterval(query) =
                │   data.is_owner && data.photos.some(p => p.status === "PENDING")
                │     ? 10_000 : false
                ▼
   t=0s ──► t=10s ──► t=20s ──► … ──► t≈20–90s (VPS B ShieldGemma)
   GET       GET       GET              GET  → status changes
                                             │
         ┌───────────────────┬───────────────┼────────────────────┐
         ▼                   ▼               ▼                    ▼
     APPROVED           NEEDS_REVIEW      REJECTED          still PENDING
     badge disappears   "Do sprawdzenia"  "Odrzucone"       (VPS B retrying with
     (ModerationBadge   (also after the                     backoff) → keep polling
      returns null)      last failed retry)
         │                   │               │
         └──── no PENDING photos left → refetchInterval returns false → polling stops
```

**Rules:**
- Poll only when the viewer is the owner **and** at least one photo is PENDING. Non-owners never see non-approved photos, so they never poll.
- Keep TanStack's default `refetchIntervalInBackground: false`, so a hidden tab does not poll. Polling resumes on focus, and the existing `refetchOnWindowFocus` also triggers a fetch then.
- Polling is a background fetch. `loading` (isPending) stays false, so no spinner or flicker appears. The `fetching` flag changes, but `ItemEditPage` uses it only for `details.failed && !details.fetching`, which is unaffected.
- Editors keep local drafts (`useFieldSave`), so a refetch while the name/description editor is open does not overwrite what the user is typing. `ItemGalleryEditor` refocus logic keys on `busy`, not on refetches. The open question about the photo list changing under the open editor is answered by the existing design: every action re-reads first.
- Optional ceiling: stop after ~10 min of continuous PENDING (`query.state.dataUpdateCount` or a timestamp). With retries plus backoff, the backend resolves to NEEDS_REVIEW long before that. **Not required.**
- No new `aria-live` region. The badge text change is visual only, the item is not time-critical for the owner, and a 10 s live region would be noisy.

---

<a id="admin-moderation-queue"></a>
### Mockup 12: Admin ContentModerationQueue, photos only

**Context:** `/admin/moderation` → `pages/ModerationPage.tsx:59` → `pages/ContentModerationQueue.tsx`. The tabs are **status** tabs (NEEDS_REVIEW / PENDING / REJECTED), not subject-type tabs. Text appeared as **cards** inside each tab, labelled "Name + description". Those cards and that branch are what get removed. The status tabs stay.

```
BEFORE                                              AFTER
┌───────────────────────────────────────────┐       ┌───────────────────────────────────────────┐
│ Content review                            │       │ Photo review                  [CHANGED]   │
│ [Needs review] (Pending…) (Rejected)      │       │ [Needs review] (Pending…) (Rejected)      │ (existing tabs)
│ ┌───────────────────────────────────────┐ │       │ ┌───────────────────────────────────────┐ │
│ │┌──────┐ PHOTO                         │ │       │ │┌──────┐ PHOTO                         │ │
│ ││ img  │ Hulajnoga                     │ │       │ ││ img  │ Hulajnoga                     │ │
│ ││120px │ nsfw 0.62 · normal 0.38       │ │       │ ││120px │ violence 0.71 · weapons 0.40 ·│ │ [CHANGED data]
│ │└──────┘ (falconsai…) · 02.10 14:03    │ │       │ │└──────┘ dangerous 0.12 · sexual 0.03  │ │ ShieldGemma
│ │                  [Approve] [Reject]   │ │       │ │         (shieldgemma-2…) · 02.10 14:03│ │ categories
│ └───────────────────────────────────────┘ │       │ │                  [Approve] [Reject]   │ │
│ ┌───────────────────────────────────────┐ │       │ └───────────────────────────────────────┘ │
│ │ NAME + DESCRIPTION                    │ │       │ ┌───────────────────────────────────────┐ │
│ │ Hulajnoga                             │ │ [REM] │ │┌──────┐ PHOTO                         │ │
│ │ <description text>                    │ │ ────► │ ││ img  │ Rower 16"                     │ │ [NEW case]
│ │ hate 0.55 · vulgar 0.10 (bielik…)     │ │       │ │└──────┘ No model score · 02.10 14:10  │ │ VPS B failed
│ │                  [Approve] [Reject]   │ │       │ │                  [Approve] [Reject]   │ │ after retries →
│ └───────────────────────────────────────┘ │       │ └───────────────────────────────────────┘ │ NEEDS_REVIEW,
└───────────────────────────────────────────┘       └───────────────────────────────────────────┘ scores null
```

**Integration points:**
- `ContentModerationQueue.tsx`:
  - Remove the `isPhoto` branching. Lines `:44`, `:48`, `:53` become an unconditional "Photo" label and image. Remove the `!isPhoto && entry.description` block (`:58-62`).
  - `:90-92` doc comment: drop "and product names/descriptions".
  - `:100` heading: optionally change to "Photo review" (English, matching the admin chrome). Keeping "Content review" is also acceptable.
- `formatScores` (`:15`) is unchanged. It already renders any `{label: score}` map sorted desc, and prints "No model score" for `null`, which now also covers the failed-after-retries case. Consider "No model score (AI unavailable)" only if the backend exposes the reason. It does not today, so no change.
- `api/moderation.ts`: narrow `ModerationSubjectType` to `"PHOTO"` (or keep the union if the backend still accepts it for history). Drop `description` from `ModerationQueueEntry` if the backend schema drops it.
- `ModerationPage.tsx:10-12` doc comment: change "(photos, product names and descriptions)" to "(photos)".
- Update the `ContentModerationQueue` tests that render PRODUCT_TEXT entries.

---

## Reusable Components

### Layout
- **PhoneFrame**: `components/shared/PhoneFrame.tsx`, the ItemDetailPage / ItemEditPage shell.
- **ModalSheet / Field**: `pages/panel/panelComponents.tsx:101/:92`, used by every panel dialog in Mockups 3-7.
- **Card shell**: inline in `OrganizationPage.tsx` and `OnboardingWizard.tsx` (`max-w-[440px] rounded-[22px] … p-10`).

### Error / feedback
- **serverMessageOr**: `api/problem.ts:62`. It is the only change point for the 7 forms. Proposed: add 503 to the pass-through ([gap](#gap-503)).
- **Panel toast**: `showToast` (`PanelDataContext.tsx:435`) → `PanelPage.tsx:75`.
- **E1/E2/E3/E5 markup**: existing per-file, listed in [patterns](#existing-layout-analysis). No new component.

### Status
- **ModerationBadge**: `pages/product/ItemGalleryEditor.tsx:14`, used for every photo status pill.
- **ItemGallery / SafeImage**: `pages/product/ItemGallery.tsx:57/:8`, the view gallery with the current-slide badge.
- **ItemGalleryEditor / ItemPhotoStrip**: `pages/product/ItemGalleryEditor.tsx:58/:27`, the edit rows with badges.
- **useItemDetail**: `hooks/useItemDetail.ts:43`, where the polling goes (`refetchInterval`).

### Admin
- **QueueCard / ContentModerationQueue**: `pages/ContentModerationQueue.tsx:23/:93`.
- **EmptyState**: `components/shared/EmptyState.tsx` ("Nothing to review", unchanged).

---

## Implementation Notes

### Per-site change list (7 forms)

| # | File:line | Current | Change | Slot |
|---|---|---|---|---|
| 1 | `pages/OrganizationPage.tsx:72` | `err.message` ("400 Bad Request") | `serverMessageOr(err, "Nie udało się zapisać organizacji")` | E1 + `role="alert"` |
| 2 | `components/onboarding/OnboardingWizard.tsx:69` | `err.message` | `serverMessageOr(err, "Nie udało się zapisać kroku")` | E1 + `role="alert"` |
| 3 | `components/panel/FirstTermStepperOrganizer.tsx:43` | fixed string | `serverMessageOr(err, <same string>)` | E2 + `role="alert"` |
| 4a | `components/panel/EditTermDialog.tsx:173` | fixed string | `serverMessageOr(err, <same>)` | E2 formError |
| 4b | `EditTermDialog.tsx:228` (saveEdit) | fixed + `setEditing(null)` | `serverMessageOr`; **keep editor open** | E2 itemsError |
| 4c | `EditTermDialog.tsx:263` (addItem) | fixed string | `serverMessageOr(err, <same>)` | E2 itemsError |
| 5a | `pages/panel/PanelDataContext.tsx:1202` saveEditGroup | fixed string | `serverMessageOr(err, <same>)` | E2 editGroupError |
| 5b | `PanelDataContext.tsx:840` handleAddGroup | toast fixed | toast `serverMessageOr(...)` (or option B inline) | E4 |
| 5c | `PanelDataContext.tsx:895` handleAddTerm (covers resolveProduct :887) | toast fixed | toast `serverMessageOr(...)` (or option B inline); fix the duplicate-term hazard | E4 |
| 6 | `pages/ProductFormPage.tsx:84` | "Failed to save product." | `serverMessageOr(err, "Failed to save product.")` | E5 + `role="alert"` |
| — | `api/problem.ts:66` | 400/409 only | add 503 | — |

### Consistency checklist
- ✅ No new components. Every error appears in the slot the form already has.
- ✅ Fallback strings stay unchanged, so existing tests for network/500 paths still pass.
- ✅ The user's input is never cleared on 400/503 (EditTermDialog `saveEdit` fixed for this).
- ✅ Photo badges reuse `ModerationBadge`. Labels and colours are unchanged.
- ✅ Polling uses TanStack `refetchInterval` on the existing query (data-fetching standard: no `useEffect` timers).
- ✅ Admin copy stays English. User-facing copy is Polish and comes from the server.

### Accessibility considerations
- Add `role="alert"` to the E1/E2/E5 error containers that lack it (OrganizationPage, OnboardingWizard, FirstTermStepperOrganizer, EditTermDialog ×2, PanelModals edit-group, ProductFormPage). E3 already has it. This follows the "don't rely on colour alone / announce dynamic content" standard.
- The toast already has `role="status"`. Its 2200 ms timeout is short for a two-sentence instruction, which argues for option B (inline) in the two add modals.
- Optional: `aria-invalid="true"` + `aria-describedby` on the rejected input. Only where the form knows which field failed (single-field forms: OrganizationPage, onboarding steps 1-2, FirstTermStepper). Not required.
- Badges are text, so they are readable by screen readers. Status changes from polling are deliberately not announced.

### Responsive behaviour
- User app: phone-width layouts (PhoneFrame, `max-w-[440px]` cards). Messages wrap inside existing containers, and there are no fixed heights to break.
- Admin: Chakra desktop layout. The queue card's `HStack` keeps the image at 120 px. A longer ShieldGemma score line wraps under `minW="0"`.

---

## Alternatives Considered

### A. New shared `<ModerationError>` component (rejected)
**Why:** the forms already have five different error slots, each consistent within its area. A new component would either force a restyle of all of them or add a sixth style. The behaviour difference is just the string, and `serverMessageOr` already handles that.

### B. Field-level errors via `fieldErrors` (rejected, backend decision)
**Why:** `serverMessageOr` deliberately ignores bodies that carry `fieldErrors`, and the backend chose a plain `{message}` naming the field (contact-info precedent). Per-input highlighting would need new FE plumbing on every form.

### C. Keep the owner banner on ItemDetailPage for "recently rejected" text (rejected)
**Why:** rejected text is never persisted, so there is nothing to show. The rejection is shown at submit time.

### D. Poll the whole page / use a websocket for photo status (rejected)
**Why:** there is no push channel today. A conditional `refetchInterval` on the one existing query is the smallest change, and it stops by itself.

### E. Toast vs inline for the two "add" modals (open, for spec)
**Selected default:** keep the toast (pattern match, one-line change).
**Recommended upgrade:** inline E2, copied from the sibling "Edytuj grupę" modal, because 2.2 s is too short for an actionable message.

---

*Generated by ui-mockup-generator subagent*
