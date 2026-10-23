import type { ReactNode } from "react";

/** The cream wrapper of the organizer's public pages, filling the space
 * between PublicLayout's top and bottom bars. */
export function PageFrame({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`flex flex-1 flex-col bg-cream ${className}`}>{children}</div>;
}

/** Shown for a slug that resolves to no organization. */
export function NotFoundFrame() {
  return (
    <PageFrame className="items-center justify-center px-4 text-center font-sans text-ink">
      <div>
        <h1 className="mb-2 font-serif text-2xl font-semibold">Nie znaleziono strony</h1>
        <p className="text-sm text-ink-soft">Ta organizacja nie istnieje.</p>
      </div>
    </PageFrame>
  );
}
