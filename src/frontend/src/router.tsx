import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { PublicLayout } from "./components/layout/PublicLayout";
import { ProductListPage } from "./pages/ProductListPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { CategoryListPage } from "./pages/CategoryListPage";
import { CategoryFormPage } from "./pages/CategoryFormPage";
import { AdminGroupsPage } from "./pages/AdminGroupsPage";
import { AdminTermsPage } from "./pages/AdminTermsPage";
import { PhotoModerationPage } from "./pages/PhotoModerationPage";
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
import { TermAttendeesPage } from "./pages/panel/TermAttendeesPage";
import { ItemCreatePage } from "./pages/product/ItemCreatePage";
import { ItemDetailPage } from "./pages/product/ItemDetailPage";
import { ItemEditPage } from "./pages/product/ItemEditPage";
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

/** "/" — the post-login landing (LoginPage navigates to "/" when there is no
 * `?returnTo=`): sends back-office roles (ADMIN / PLUGIN_MANAGEMENT — the
 * permissions gating the Categories/Plugins Sidebar links) straight to
 * `/admin/products`, everyone else to the Guest/Organizer `/panel`. */
function HomeRedirect() {
  const { permissions } = useAuth();
  const isBackOffice = permissions.includes("ADMIN") || permissions.includes("PLUGIN_MANAGEMENT");
  return <Navigate to={isBackOffice ? "/admin/products" : "/panel"} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: <AuthGuard requireAuth={false}><LoginPage /></AuthGuard>,
  },
  {
    path: "/register",
    element: <AuthGuard requireAuth={false} authenticatedRedirect="/onboarding" forwardReturnTo><RegisterPage /></AuthGuard>,
  },
  {
    path: "/oauth2/authorize",
    element: <AuthGuard><OAuth2AuthorizePage /></AuthGuard>,
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
    // Pathless layout route for the public pages below: a logged-in
    // visitor gets the account menu bar above them (see PublicLayout).
    element: <PublicLayout />,
    children: [
      {
        path: "/",
        element: <AuthGuard><HomeRedirect /></AuthGuard>,
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
        // Organizer-only attendee list for one term — an explicit route,
        // since `/panel/:view` matches a single segment only. Standalone
        // (no PanelDataProvider): the page resolves the group from the term.
        path: "/panel/terminy/:termId",
        element: <AuthGuard><TermAttendeesPage /></AuthGuard>,
      },
      {
        // Item pages; "product" is in the backend's RESERVED_SLUGS.
        path: "/product/new",
        element: <AuthGuard><ItemCreatePage /></AuthGuard>,
      },
      {
        path: "/product/:id",
        element: <AuthGuard><ItemDetailPage /></AuthGuard>,
      },
      {
        path: "/product/:id/edit",
        element: <AuthGuard><ItemEditPage /></AuthGuard>,
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
    ],
  },
  {
    path: "/admin",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    // Child paths are relative to "/admin" — "products" resolves to
    // "/admin/products".
    children: [
      { index: true, element: <Navigate to="products" replace /> },
      { path: "products", element: <ProductListPage /> },
      { path: "products/new", element: <ProductFormPage /> },
      { path: "products/:id", element: <ProductDetailPage /> },
      { path: "products/:id/edit", element: <ProductFormPage /> },
      { path: "categories", element: <CategoryListPage /> },
      { path: "categories/new", element: <CategoryFormPage /> },
      { path: "categories/:id/edit", element: <CategoryFormPage /> },
      { path: "groups", element: <AdminGroupsPage /> },
      { path: "terms", element: <AdminTermsPage /> },
      { path: "photos", element: <PhotoModerationPage /> },
      { path: "plugins", element: <PluginListPage /> },
      { path: "plugins/new", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/detail", element: <PluginDetailPage /> },
      { path: "plugins/:pluginId/edit", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/*", element: <PluginPageRoute /> },
    ],
  },
]);
