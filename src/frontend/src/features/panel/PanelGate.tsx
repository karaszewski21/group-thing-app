import { useEffect, type ReactNode } from "react";
import { AuthGuard } from "../../auth/AuthGuard";
import { useAuth } from "../../auth/AuthContext";
import { authPath } from "../../auth/authPaths";
import { clearSession } from "../../auth/session";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { Link, useAppPathname, useAppSearch } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { PublicAddView } from "../add/AddView";
import { LandingPage } from "../landing/LandingPage";
import { SearchView } from "../search/SearchView";
import { AppPage } from "./AppPage";

/** The panel layout's gate around the section page (`children`): logged in,
 * AppPage's frame and panel data, kept mounted while switching sections. An
 * anonymous visitor gets the LandingPage at "/" (a stale session cookie that
 * led here is cleared), the "Co dodajesz?" tiles at /add (each leading to the
 * login page), the search at /search (everywhere, with „Zaloguj się”) and
 * the login page elsewhere. */
export function PanelGate({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const pathname = useAppPathname();
  const anonymousHome = !token && pathname === viewPath("home");

  useEffect(() => {
    if (anonymousHome) clearSession();
  }, [anonymousHome]);

  if (anonymousHome) return <LandingPage />;
  if (!token && pathname === viewPath("add")) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <PublicAddView />
        </div>
      </PhoneFrame>
    );
  }
  if (!token && pathname === viewPath("search")) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <GuestSearchHeader />
          <SearchView />
        </div>
      </PhoneFrame>
    );
  }
  return (
    <AuthGuard>
      <AppPage>{children}</AppPage>
    </AuthGuard>
  );
}

/** A guest's search: logging in adds „Moje grupy” and brings them back here. */
function GuestSearchHeader() {
  const search = useAppSearch();
  return (
    <div className="mb-3 flex justify-end">
      <Link
        to={authPath("login", viewPath("search") + search)}
        className="flex min-h-11 items-center rounded-full px-3 text-sm font-extrabold text-primary-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        Zaloguj się
      </Link>
    </div>
  );
}
