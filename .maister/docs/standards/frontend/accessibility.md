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
Every `aria-modal="true"` sheet traps Tab/Shift+Tab with `components/krag/trapFocus.ts`, closes on Esc handled on its dialog element (ignoring events already `defaultPrevented`, e.g. a nested menu's Esc), and returns focus to the opener (fallback `main[tabindex=-1]`). Prefer the shared `components/krag/ModalSheet` over hand-rolling this.

### Register Blocking Dialogs With the Open-Sheet Registry
Every blocking dialog/sheet calls `useRegisterOpenSheet(open)` from `components/shared/openSheets.ts` so the app-wide `PendingActionsHost` waits until it closes before showing its prompt. The host's own sheet passes `registerAsPageSheet={false}`.
