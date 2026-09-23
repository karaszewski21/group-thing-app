import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProductListPage } from "./pages/ProductListPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { CategoryListPage } from "./pages/CategoryListPage";
import { CategoryFormPage } from "./pages/CategoryFormPage";
import { ModerationPage } from "./pages/ModerationPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { PluginListPage } from "./pages/PluginListPage";
import { PluginDetailPage } from "./pages/PluginDetailPage";
import { PluginFormPage } from "./pages/PluginFormPage";
import { PluginPageRoute } from "./pages/PluginPageRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { OAuth2AuthorizePage } from "./pages/OAuth2AuthorizePage";
import { TermPage } from "./pages/krag/TermPage";
import { PanelPage } from "./pages/panel/PanelPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { OrganizationPage } from "./pages/OrganizationPage";
import { PublicOrganizationPage } from "./pages/PublicOrganizationPage";
import { AuthGuard } from "./auth/AuthGuard";
import { useAuth } from "./auth/AuthContext";
import { PluginProvider } from "./plugins/PluginContext";

function Layout() {
  return (
    <PluginProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </PluginProvider>
  );
}

/** Index route for "/": sends back-office roles (ADMIN / PLUGIN_MANAGEMENT —
 * the permissions gating the Categories/Plugins Sidebar links) to the
 * AppShell's own back-office pages instead of the Guest/Organizer Panel,
 * so logging in as an admin account lands where its Sidebar links actually
 * are, rather than requiring a manual URL edit. */
function HomeRedirect() {
  const { permissions } = useAuth();
  const isBackOffice = permissions.includes("ADMIN") || permissions.includes("PLUGIN_MANAGEMENT");
  return <Navigate to={isBackOffice ? "/products" : "/panel"} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <AuthGuard requireAuth={false}><LoginPage /></AuthGuard>,
  },
  {
    path: "/register",
    element: <AuthGuard requireAuth={false} authenticatedRedirect="/onboarding"><RegisterPage /></AuthGuard>,
  },
  {
    path: "/oauth2/authorize",
    element: <AuthGuard><OAuth2AuthorizePage /></AuthGuard>,
  },
  {
    // Role-aware landing for Guest/Organizer accounts — same standalone,
    // Tailwind phone-frame pattern as /krag above. `/panel/:view` is a
    // second, identical route (not a child route) so each Panel section
    // (spotkania/rzeczy/podarki/profil/ustawienia/rodzina) has its own real
    // URL and survives a refresh instead of always resetting to "home" —
    // see PanelDataContext.tsx, which derives `view` from this param.
    path: "/panel",
    element: <AuthGuard><PanelPage /></AuthGuard>,
  },
  {
    path: "/panel/:view",
    element: <AuthGuard><PanelPage /></AuthGuard>,
  },
  {
    // Skippable post-registration wizard, entered right after
    // RegisterPage's success handler — standalone chrome (own card, not
    // PhoneFrame), same pattern as /login/register above.
    path: "/onboarding",
    element: <AuthGuard><OnboardingPage /></AuthGuard>,
  },
  {
    // Organization profile (name + custom colors) — same standalone
    // pattern as /onboarding above, reachable from the Panel hamburger
    // menu ("Moja organizacja", organizer-only).
    path: "/organization",
    element: <AuthGuard><OrganizationPage /></AuthGuard>,
  },
  {
    path: "/",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: "products", element: <ProductListPage /> },
      { path: "products/new", element: <ProductFormPage /> },
      { path: "products/:id", element: <ProductDetailPage /> },
      { path: "products/:id/edit", element: <ProductFormPage /> },
      { path: "categories", element: <CategoryListPage /> },
      { path: "categories/new", element: <CategoryFormPage /> },
      { path: "categories/:id/edit", element: <CategoryFormPage /> },
      { path: "moderation", element: <ModerationPage /> },
      { path: "plugins", element: <PluginListPage /> },
      { path: "plugins/new", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/detail", element: <PluginDetailPage /> },
      { path: "plugins/:pluginId/edit", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/*", element: <PluginPageRoute /> },
    ],
  },
  {
    // The SOLE group/circle screen route (former separate `/krag/:groupId`
    // + `/krag` entry-resolver were removed — this address now serves both
    // audiences). No `AuthGuard`: `TermPage` itself branches on auth
    // presence, rendering the full private member experience for a logged-in
    // visitor and the anonymous-safe public view otherwise (see that
    // component's own doc comment). `:organizationSlug` is cosmetic (echoed
    // into redirect targets, never validated / never sent to the backend).
    // Multi-segment, so React Router route-ranking keeps it ahead of the
    // single-segment `/:organizationSlug` catch-all below regardless of
    // declaration order — no RESERVED_SLUGS change needed.
    path: "/:organizationSlug/grupa/:groupId/term/:termId",
    element: <TermPage />,
  },
  {
    // Public organizer page (`domena.pl/<slug>`) — deliberately declared
    // LAST as a single-segment catch-all, and deliberately unauthenticated
    // (no AuthGuard). The backend's reserved-slug whitelist
    // (app/organizations/slugs.py's RESERVED_SLUGS) guarantees a slug can
    // never collide with any of the fixed paths above, so this can never
    // shadow a real route.
    path: "/:organizationSlug",
    element: <PublicOrganizationPage />,
  },
]);
