import { useAppSearchParams } from "../../routing/navigation";
import { AuthGuard } from "../../auth/AuthGuard";
import { AUTH_TAB_PARAM, REGISTER_TAB_VALUE, type AuthTab } from "../../auth/authPaths";
import { AuthLayout } from "./AuthLayout";
import { AuthTabs } from "./AuthTabs";

const HEADINGS: Record<AuthTab, { title: string; subtitle: string }> = {
  login: { title: "Witaj w kręgu", subtitle: "Zaloguj się, żeby zobaczyć swoje rzeczy i spotkania." },
  register: { title: "Dołącz do kręgu", subtitle: "Załóż konto — zajmie to minutę." },
};

/** `/login`: logging in and registering on one page, as two tabs. The tab
 * lives in `?mode=register` so links (and a refresh) can open "Załóż
 * konto" directly; `?returnTo=` survives switching tabs. A logged-in visitor
 * is sent on by AuthGuard: to `returnTo`, or to their role's home. */
export function LoginPage() {
  const [searchParams, setSearchParams] = useAppSearchParams();
  const tab: AuthTab = searchParams.get(AUTH_TAB_PARAM) === REGISTER_TAB_VALUE ? "register" : "login";

  function selectTab(next: AuthTab) {
    setSearchParams(
      (params) => {
        if (next === "register") params.set(AUTH_TAB_PARAM, REGISTER_TAB_VALUE);
        else params.delete(AUTH_TAB_PARAM);
        return params;
      },
      { replace: true },
    );
  }

  return (
    <AuthGuard requireAuth={false}>
      <AuthLayout title={HEADINGS[tab].title} subtitle={HEADINGS[tab].subtitle}>
        <AuthTabs tab={tab} onSelect={selectTab} />
      </AuthLayout>
    </AuthGuard>
  );
}
