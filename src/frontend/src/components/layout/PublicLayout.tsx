import { Outlet } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { useMyOrganizationSlug } from "../../hooks/useMyOrganizationSlug";
import { AccountMenu } from "../shared/AccountMenu";

/** Layout route for the public, unauthenticated pages (term page, public
 * organization page): a logged-in visitor gets a slim bar with their
 * account menu above the page, so they can get back to their Panel.
 * Anonymous visitors see the page alone. */
export function PublicLayout() {
  return (
    <>
      <PublicAccountBar />
      <Outlet />
    </>
  );
}

function PublicAccountBar() {
  const { token } = useAuth();
  const organizationSlug = useMyOrganizationSlug();
  if (token === null) return null;
  return (
    <nav aria-label="Menu konta" className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-[430px] justify-end px-[18px] py-2">
        <AccountMenu organizationSlug={organizationSlug} showPanelHome />
      </div>
    </nav>
  );
}
