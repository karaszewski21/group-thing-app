export function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

// URL parsers strip tab/CR/LF, so "/\t/evil.com" would resolve as the
// protocol-relative "//evil.com"; whitespace and control chars are rejected.
function hasControlOrSpace(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || /\s/.test(ch)) return true;
  }
  return false;
}

export function isSafeReturnPath(value: string | null | undefined): value is string {
  if (!value) return false;
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !hasControlOrSpace(value)
  );
}
