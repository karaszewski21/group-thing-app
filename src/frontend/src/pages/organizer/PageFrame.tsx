import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";

// Height of the sticky account bar that `components/layout/PublicLayout.tsx`
// shows to logged-in visitors: border-t (1px) + py-2 (16px) + h-10 controls
// (40px). Update together with that bar's classes.
const LOGGED_IN_MIN_HEIGHT = "min-h-[calc(100dvh-57px)]";
const ANONYMOUS_MIN_HEIGHT = "min-h-dvh";

/** The cream, viewport-tall wrapper of the organizer's public pages. */
export function PageFrame({ className = "", children }: { className?: string; children: ReactNode }) {
  const { token } = useAuth();
  const minHeight = token ? LOGGED_IN_MIN_HEIGHT : ANONYMOUS_MIN_HEIGHT;
  return <div className={`flex flex-col bg-cream ${minHeight} ${className}`}>{children}</div>;
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
