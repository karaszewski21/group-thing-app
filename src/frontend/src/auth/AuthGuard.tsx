import { Navigate, useAppPathname, useAppSearch, useAppSearchParams } from "../routing/navigation";
import { useAuth } from "./AuthContext";
import { authPath } from "./authPaths";
import { homePath } from "./homePath";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { hasTokenExpired } from "./session";
import { isSafeReturnPath } from "../utils/url";

interface AuthGuardProps {
  children: ReactNode;
  requireAuth?: boolean;
}

/** `requireAuth` pages send a visitor without a session to the login page.
 * A `requireAuth={false}` page (/login's two tabs) sends a logged-in user on
 * to a safe `?returnTo=`, else to `homePath(permissions)`: back-office roles
 * to `/admin/products`, everyone else to the panel's Start at "/". */
export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
  const { token: currentToken, permissions, expireSession } = useAuth();
  const pathname = useAppPathname();
  // A token that expired while the tab was open counts as signed out.
  const stale = currentToken !== null && hasTokenExpired(currentToken);
  const token = stale ? null : currentToken;
  useEffect(() => {
    if (stale) expireSession();
  }, [stale, expireSession]);

  const search = useAppSearch();
  const [searchParams] = useAppSearchParams();

  if (requireAuth && !token) {
    const returnTo = pathname + search;
    return <Navigate to={authPath("login", returnTo)} replace />;
  }

  if (!requireAuth && token) {
    const requested = searchParams.get("returnTo");
    return <Navigate to={isSafeReturnPath(requested) ? requested : homePath(permissions)} replace />;
  }

  return <>{children}</>;
}
