## Validation

### Server-Side Always
Validate on the server; client-side validation alone is insufficient for security and data integrity.

### Client-Side for Feedback
Use client-side validation for immediate user feedback, but duplicate checks server-side.

### Validate Early
Check inputs as early as possible and reject invalid data before processing.

### Specific Errors
Provide clear, field-specific messages that help users correct their input.

### Allowlists Over Blocklists
Define what's allowed rather than trying to block everything else.

### Type and Format Checks
Validate data types, formats, ranges, and required fields systematically.

### Input Sanitization
Sanitize user input to prevent injection attacks (SQL, XSS, command injection).

### Business Rules
Validate business logic (sufficient balance, valid dates) at the appropriate layer.

### Consistent Enforcement
Apply validation uniformly across all entry points (forms, APIs, background jobs).

### Integer Inputs
For bounded integer fields (e.g. capacity 1–10000) use `type="text" inputMode="numeric" pattern="[0-9]*"`, not `type="number"`: a controlled `type=number` reports unparseable input ("-", "e", "1e3") as `""`, silently turning bad input into "empty". Keep the raw string in state and parse it with one shared helper returning `null` (blank), a number (valid) or `undefined` (invalid). While invalid, show an inline Polish `role="alert"` error ("Podaj liczbę od 1 do 10000") wired with `aria-invalid`/`aria-describedby`, and disable submit. The server still validates (`Field(ge=1, le=10000)`). Reference: `utils/appHelpers.ts` (`parseCapacity`, `capacityText`, `CAPACITY_ERROR`), `components/shared/appComponents.tsx` (`CapacityField`).
```ts
export function parseCapacity(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= MAX_CAPACITY ? parsed : undefined;
}
```
