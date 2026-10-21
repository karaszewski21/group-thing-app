## Accessibility

### Semantic HTML
Use appropriate elements (nav, main, button) that convey meaning to assistive technologies.

### Keyboard Navigation
Make all interactive elements accessible via keyboard with visible focus indicators.

### Color Contrast
Maintain 4.5:1 contrast for normal text; don't rely solely on color to convey information.

### Alt Text and Labels
Provide descriptive alt text for images and labels for form inputs.

### Screen Reader Testing
Verify all views work with screen readers.

### ARIA When Needed
Use ARIA attributes to enhance complex components when semantic HTML isn't enough.

### Heading Structure
Use heading levels (h1-h6) in proper order for clear document outline.

### Focus Management
Manage focus appropriately in dynamic content, modals, and SPAs.

### Modal Sheets and Blocking Dialogs
Every `aria-modal="true"` sheet traps Tab/Shift+Tab with `components/shared/trapFocus.ts`, closes on Esc handled on its dialog element (ignoring events already `defaultPrevented`, e.g. a nested menu's Esc), and returns focus to the opener (fallback `main[tabindex=-1]`). Prefer the shared `components/shared/ModalSheet` over hand-rolling this.

### Register Blocking Dialogs With the Open-Sheet Registry
Every blocking dialog/sheet calls `useRegisterOpenSheet(open)` from `components/shared/openSheets.ts` so the app-wide `PendingActionsHost` waits until it closes before showing its prompt. The host's own sheet passes `registerAsPageSheet={false}`.

### Inline Combobox Inside a Sheet
A search field with its own `role="combobox"` + `role="listbox"` inside a modal sheet owns its Esc: while the listbox is open, Esc closes only the listbox and calls `preventDefault()` + `stopPropagation()`; because the sheet's Esc handler ignores `defaultPrevented` events, the sheet stays open, and a second Esc closes the sheet. Set `aria-controls` only while the listbox is open/mounted, point `aria-activedescendant` at the highlighted option (`aria-selected` on it), and support ArrowUp/ArrowDown to move and Enter to pick. Options use `onMouseDown={(e) => e.preventDefault()}` so clicking one does not blur the input first. Reference: `components/shared/LocationAddForm.tsx`.
```tsx
if (event.key === "Escape" && open) {
  event.preventDefault();   // the host ModalSheet skips defaultPrevented Esc
  event.stopPropagation();
  setOpen(false);
}
```

### Spacing Around Visually Hidden Text
When an accessible name is composed with `sr-only` text (e.g. link "Otwórz w Google Maps" + "(nowa karta)"), put the separating space as `{" "}` outside the `<span className="sr-only">`, never as a leading space inside it. A leading space inside the hidden span is dropped from the computed name (jsdom/Testing Library and some screen readers), yielding "Maps(nowa karta)". Decorative glyphs such as "↗" go in `aria-hidden="true"` spans. Reference: `pages/krag/components/TermCard.tsx`.
```tsx
Otwórz w Google Maps<span aria-hidden="true"> ↗</span>{" "}
<span className="sr-only">(nowa karta)</span>
```
