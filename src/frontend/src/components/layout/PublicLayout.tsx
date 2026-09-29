import { Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyOrganizationSlug } from "../../hooks/useMyOrganizationSlug";
import { AccountMenu } from "../shared/AccountMenu";
import { NotificationBell } from "../shared/NotificationBell";

/** Layout route for the public, unauthenticated pages (term page, public
 * organization page): a logged-in visitor gets a slim bar with their
 * account menu above the page, so they can get back to their Panel.
 * Anonymous visitors see the page alone. */
export function PublicLayout() {
  const { token } = useAuth();
  const organizationSlug = useMyOrganizationSlug();

  return (
    <>
     {token && <nav aria-label="Menu konta" className="sticky top-0 z-20 flex justify-end gap-2 border-t border-line bg-paper px-2.5 py-2 shadow-[0_-10px_30px_-22px_rgba(30,46,39,0.7)]">  
        <NotificationBell />
        <AccountMenu organizationSlug={organizationSlug} showPanelHome />
      </nav>
     }
      <main>
        <Outlet />
      </main>
    </>
  );
}