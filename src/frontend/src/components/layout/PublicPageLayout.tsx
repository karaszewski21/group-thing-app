import type { ReactNode } from "react";
import { useAuth } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { BackIcon } from "../shared/appIcons";
import { Link, useAppPathname, useAppSearch } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The `(public)` layout for public pages of their own, without the top bar
 * and the bottom tab bar. The header carries „Wróć” to Start and, for a
 * guest, „Zaloguj się” that brings them back to this page. The window scrolls. */
export function PublicPageLayout({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const pathname = useAppPathname();
  const search = useAppSearch();

  return (
    <div className="flex min-h-dvh justify-center bg-cream font-sans text-ink">
      <div className="w-full max-w-130 px-4.5 pb-6 pt-3">
        <header className="mb-3 flex items-center justify-between gap-2">
          <Link
            to={viewPath("home")}
            className={`-ml-2 flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-extrabold text-ink-soft hover:text-ink ${FOCUS_RING}`}
          >
            <BackIcon /> Wróć
          </Link>
          {!token && (
            <Link
              to={authPath("login", pathname + search)}
              className={`flex min-h-11 items-center rounded-full px-3 text-sm font-extrabold text-primary-fg hover:underline ${FOCUS_RING}`}
            >
              Zaloguj się
            </Link>
          )}
        </header>
        <main tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
