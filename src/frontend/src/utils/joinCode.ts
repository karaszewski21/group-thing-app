/** The raw text of a join-code input: blank is `null`, exactly 6 digits
 * (spaces and hyphens ignored, so a pasted `482 913`/`482-913` works) are
 * those digits, anything else is `undefined` (invalid). */
export function parseJoinCode(raw: string): string | null | undefined {
  const digits = raw.replace(/[\s-]/g, "");
  if (digits === "") return null;
  return /^\d{6}$/.test(digits) ? digits : undefined;
}

/** `"482913"` → `"482 913"`, for display only. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
