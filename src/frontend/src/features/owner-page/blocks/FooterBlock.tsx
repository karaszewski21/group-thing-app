/** Minimal page footer with the platform credit; `on-primary` is for the
 * primary-colored LINKS page. */
export function FooterBlock({ variant }: { variant?: string }) {
  const colors = variant === "on-primary" ? "border-on-primary/25 text-on-primary" : "border-line text-ink-soft";
  return (
    <footer className={`mx-6 mt-10 border-t pt-4 pb-6 text-center text-xs ${colors}`}>
      Strona utworzona w Krąg grupy
    </footer>
  );
}
