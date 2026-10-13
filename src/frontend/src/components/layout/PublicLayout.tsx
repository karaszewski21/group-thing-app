import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyOrganizationSlug } from "../../hooks/useMyOrganizationSlug";
import { AccountMenu } from "../shared/AccountMenu";
import { NotificationBell } from "../shared/NotificationBell";
import { PendingActionsHost } from "../pending/PendingActionsHost";

/** Layout route for the panel and the public pages (term page, public
 * organization page): a logged-in visitor gets a slim bar with the Krąg grupy
 * mark (back to the panel) and their notifications and account menu, plus the
 * app-wide pending-actions prompt. Anonymous visitors see the page alone. */
export function PublicLayout() {
  const { token } = useAuth();
  const organizationSlug = useMyOrganizationSlug();

  return (
    <>
      {token && (
        <nav
          aria-label="Menu konta"
          className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-paper px-3 py-2"
        >
          <Link
            to="/panel"
            className="mr-auto flex min-h-10 items-center gap-2 rounded-xl pr-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary font-serif text-[15px] font-extrabold text-on-primary"
            >
              KG
            </span>
            <span className="font-serif text-[17px] font-extrabold tracking-tight text-ink">Krąg grupy</span>
          </Link>
          <NotificationBell />
          <AccountMenu organizationSlug={organizationSlug} showPanelHome />
        </nav>
      )}
      <main tabIndex={-1} className="outline-none">
        <Outlet />
      </main>
      {token && <PendingActionsHost />}
    </>
  );
}
