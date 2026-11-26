import type { ReactNode } from "react";
import Image from "next/image";
import { Link, useAppPathname, useAppSearch } from "../../routing/navigation";
import { useAuth } from "../../auth/AuthContext";
import { HEADER_BUTTON } from "../shared/headerButton";
import { NotificationBell } from "../shared/NotificationBell";
import { PendingActionsHost } from "./pending/PendingActionsHost";
import { BellIcon, CalendarIcon, SearchIcon } from "../shared/appIcons";
import { viewPath } from "../../routing/paths";
import { INBOX_PATH } from "../../routing/messagesPaths";
import { authPath } from "../../auth/authPaths";
import { BottomNav } from "./BottomNav";
import { homePath } from "../../auth/homePath";
import { ShieldCheck } from "lucide-react";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The `(public)` route group's layout (every page but the OAuth2 consent
 * page and /admin): a sticky top bar and the bottom tab bar on every page,
 * for anonymous visitors too. The top bar carries the Gooo mark (Start), the
 * search field, Terminy and the notification bell — for anonymous visitors a
 * bell that leads to /login. /search itself and a chat thread drop the
 * search field. Messages and the account live in the
 * bottom tab bar (Czat, Konto). Logged in, the app-wide pending-actions
 * prompt is mounted too. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { token, permissions } = useAuth();
  const isBackOffice = token !== null && homePath(permissions) !== "/";
  const pathname = useAppPathname();
  const showSearchField = pathname !== viewPath("search") && !pathname.startsWith(`${INBOX_PATH}/`);

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <header className="sticky top-0 z-20 flex-none border-b border-line bg-paper">
        <nav aria-label="Menu konta" className="mx-auto flex w-full max-w-300 items-center gap-2 px-4 py-3 md:gap-3 md:px-6">
          <Link to="/" aria-label="Gooo — Start" className={`flex flex-none items-center gap-2.5 rounded-full ${FOCUS_RING}`}>
            <Image src="/assets/logo-gooo-96.webp" alt="" width={40} height={40} priority className="h-10 w-10" />
            <span className="hidden font-serif text-[22px] font-extrabold tracking-tight text-ink md:inline">Gooo</span>
          </Link>
          {showSearchField && (
            <Link
              to={viewPath("search")}
              className={`flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border-[1.5px] border-line bg-cream px-4.5 text-[15px] text-ink-soft transition-colors hover:border-line-strong md:ml-3 md:max-w-140 ${FOCUS_RING}`}
            >
              <span className="flex-none">
                <SearchIcon c="currentColor" />
              </span>
              <span className="truncate">Szukaj</span>
            </Link>
          )}
          <div className="ml-auto flex flex-none items-center gap-2">
            {isBackOffice && (
              <Link
                to="/admin/products"
                aria-label="Panel admina"
                className={`${HEADER_BUTTON} md:w-auto md:gap-2 md:px-4 md:text-[15px] md:font-extrabold`}
              >
                <ShieldCheck size={20} aria-hidden="true" className="text-primary-fg" />
                <span className="sr-only md:not-sr-only">Panel admina</span>
              </Link>
            )}
            <Link
              to={viewPath("meetings")}
              className={`${HEADER_BUTTON} md:w-auto md:gap-2 md:px-4 md:text-[15px] md:font-extrabold`}
            >
              <span className="text-primary-fg">
                <CalendarIcon c="currentColor" />
              </span>
              <span className="sr-only md:not-sr-only">Terminy</span>
            </Link>
            {token ? <NotificationBell /> : <LoginBell />}
          </div>
        </nav>
      </header>
      <main tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {children}
      </main>
      <BottomNav />
      {token && <PendingActionsHost />}
    </div>
  );
}

/** The bell for anonymous visitors: same place and look as NotificationBell,
 * but it sends them to log in (and back here afterwards). */
function LoginBell() {
  const pathname = useAppPathname();
  const search = useAppSearch();
  const returnTo = pathname === "/" || pathname === "/login" ? null : pathname + search;
  return (
    <Link to={authPath("login", returnTo)} aria-label="Powiadomienia" className={HEADER_BUTTON}>
      <BellIcon c="currentColor" />
    </Link>
  );
}
