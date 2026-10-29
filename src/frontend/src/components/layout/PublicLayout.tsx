import { Link, Outlet, useLocation, useMatch } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { HEADER_BUTTON } from "../shared/headerButton";
import { NotificationBell } from "../shared/NotificationBell";
import { PendingActionsHost } from "../pending/PendingActionsHost";
import { INBOX_PATH } from "../../utils/messagesPaths";
import { BellIcon, CalendarIcon, SearchIcon } from "../shared/appIcons";
import { viewPath } from "../../utils/appHelpers";
import { authPath } from "../../auth/authPaths";
import { BottomNav } from "./BottomNav";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The app-wide layout route (everything but the standalone wizards and
 * /admin): a sticky top bar and the bottom tab bar on
 * every page, for anonymous visitors too. The top bar carries the Krąg grupy
 * mark (home), Spotkania and the notification bell — for anonymous visitors
 * a bell that leads to /login — and the search field below them. Messages
 * and the account live in the bottom tab bar (Czat, Konto). A chat
 * thread gets a one-row bar, no tab bar and a viewport-tall body for its
 * scrolling messages and composer. Logged in, the app-wide pending-actions
 * prompt is mounted too. */
export function PublicLayout() {
  const { token } = useAuth();
  const inThread = useMatch(`${INBOX_PATH}/:conversationId`) !== null;
  const onSearch = useMatch(viewPath("search")) !== null;

  return (
    <div className={`flex flex-col bg-cream ${inThread ? "h-dvh" : "min-h-dvh"}`}>
      <header className="sticky top-0 z-20 flex flex-none flex-col gap-3 border-b border-line bg-cream px-4 py-3">
        <nav aria-label="Menu konta" className="flex items-center gap-2">
          {!inThread && !onSearch && (
          <Link
            to={viewPath("search")}
            className={`flex flex-1 min-h-12 items-center gap-2.5 rounded-full border-[1.5px] border-line bg-paper px-4.5 text-[15px] text-ink-soft transition-colors hover:border-line-strong ${FOCUS_RING}`}
          >
            <SearchIcon c="currentColor" />
            Szukaj rzeczy i spotkań
          </Link>
        )}
          <Link to={viewPath("meetings")} aria-label="Spotkania" className={HEADER_BUTTON}>
            <CalendarIcon c="currentColor" />
          </Link>
          {token ? <NotificationBell /> : <LoginBell />}
        </nav> 
      </header>
      <main tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <Outlet />
      </main>
      {!inThread && <BottomNav />}
      {token && <PendingActionsHost />}
    </div>
  );
}

/** The bell for anonymous visitors: same place and look as NotificationBell,
 * but it sends them to log in (and back here afterwards). */
function LoginBell() {
  const { pathname, search } = useLocation();
  const returnTo = pathname === "/" || pathname === "/login" ? null : pathname + search;
  return (
    <Link to={authPath("login", returnTo)} aria-label="Powiadomienia" className={HEADER_BUTTON}>
      <BellIcon c="currentColor" />
    </Link>
  );
}
