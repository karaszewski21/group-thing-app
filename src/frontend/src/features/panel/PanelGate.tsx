import { useEffect } from "react";
import { AuthGuard } from "../../auth/AuthGuard";
import { useAuth } from "../../auth/AuthContext";
import { clearSession } from "../../auth/session";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useAppPathname } from "../../routing/navigation";
import { viewPath } from "../../routing/paths";
import { PublicAddView } from "../add/AddView";
import { LandingPage } from "../landing/LandingPage";
import { AppPage } from "./AppPage";

/** Every panel section, "/" included, behind one element so switching
 * sections keeps AppPage (and its loaded data) mounted. An anonymous visitor
 * gets the LandingPage at "/" (a stale session cookie that led here is
 * cleared), the "Co dodajesz?" tiles at /add (each leading to the login page)
 * and the login page elsewhere. */
export function PanelGate() {
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
  return (
    <AuthGuard>
      <AppPage />
    </AuthGuard>
  );
}
