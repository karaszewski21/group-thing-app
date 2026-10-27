import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { PublicLayout } from "./components/layout/PublicLayout";
import { ProductListPage } from "./pages/admin/ProductListPage";
import { ProductFormPage } from "./pages/admin/ProductFormPage";
import { CategoryListPage } from "./pages/admin/CategoryListPage";
import { CategoryFormPage } from "./pages/admin/CategoryFormPage";
import { AdminGroupsPage } from "./pages/admin/AdminGroupsPage";
import { AdminTermsPage } from "./pages/admin/AdminTermsPage";
import { PhotoModerationPage } from "./pages/admin/PhotoModerationPage";
import { ProductDetailPage } from "./pages/admin/ProductDetailPage";
import { PluginListPage } from "./pages/admin/PluginListPage";
import { PluginDetailPage } from "./pages/admin/PluginDetailPage";
import { PluginFormPage } from "./pages/admin/PluginFormPage";
import { PluginPageRoute } from "./pages/admin/PluginPageRoute";
import { LoginPage } from "./pages/auth/LoginPage";
import { OAuth2AuthorizePage } from "./pages/auth/OAuth2AuthorizePage";
import { TermPage } from "./pages/term/TermPage";
import { AppPage } from "./pages/home/AppPage";
import { TermAttendeesPage } from "./pages/meetings/TermAttendeesPage";
import { GroupDetailsPage } from "./pages/meetings/GroupDetailsPage";
import { InboxPage } from "./pages/messages/InboxPage";
import { ThreadPage } from "./pages/messages/ThreadPage";
import { ItemCreatePage } from "./pages/product/ItemCreatePage";
import { ItemDetailBody, ItemDetailPage } from "./pages/product/ItemDetailPage";
import { ItemEditBody, ItemEditPage } from "./pages/product/ItemEditPage";
import { OrganizerItemLayout } from "./pages/product/OrganizerItemLayout";
import { OnboardingPage } from "./pages/auth/OnboardingPage";
import { LandingPage } from "./pages/home/LandingPage";
import { OrganizationPage } from "./pages/organizer/OrganizationPage";
import { OrganizerTermsPage } from "./pages/organizer/OrganizerTermsPage";
import { PublicOrganizationPage } from "./pages/organizer/PublicOrganizationPage";
import { AuthGuard } from "./auth/AuthGuard";
import { useAuth } from "./auth/AuthContext";
import { PluginProvider } from "./plugins/PluginContext";
import { viewPath, type View } from "./utils/appHelpers";
import { INBOX_PATH } from "./utils/messagesPaths";

const PANEL_VIEWS: readonly Exclude<View, "home">[] = [
  "spotkania",
  "rzeczy",
  "profil",
  "ustawienia",
  "miejsca",
  "rodzina",
  "konto",
  "szukaj",
  "szukam",
  "dodaj",
  "wydarzenie",
];

function Layout() {
  return (
    <PluginProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </PluginProvider>
  );
}

/** Every panel section, "/" included: one element type for all of them, so
 * switching sections keeps AppPage (and its loaded data) mounted. An
 * anonymous visitor gets the LandingPage at "/" and the login page elsewhere. */
function AppRoute() {
  const { token } = useAuth();
  const { pathname } = useLocation();
  if (!token && pathname === "/") return <LandingPage />;
  return <AuthGuard><AppPage /></AuthGuard>;
}

export const routes: RouteObject[] = [
  {
    path: "/oauth2/authorize",
    element: <AuthGuard><OAuth2AuthorizePage /></AuthGuard>,
  },
  {
    // Skippable post-registration wizard, entered right after
    // RegisterForm's success handler — standalone chrome (own card, not
    // PhoneFrame).
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
    // Pathless layout route for every page below: the global top bar and
    // bottom tab bar (see PublicLayout).
    element: <PublicLayout />,
    children: [
      {
        path: "/",
        element: <AppRoute />,
      },
      {
        // Logging in and registering, as two tabs of one page; LoginPage
        // wraps itself in the right `requireAuth={false}` AuthGuard per tab.
        path: "/login",
        element: <LoginPage />,
      },
      // The panel's sections, one top-level URL each (`/rzeczy`, `/konto`, …)
      // so a refresh or a shared link lands on the same section — see
      // AppDataContext.tsx, which derives `view` from the pathname. Static
      // segments, so they rank above the `/:organizationSlug` catch-all; every
      // one is in the backend's RESERVED_SLUGS.
      ...PANEL_VIEWS.map((view) => ({
        path: viewPath(view),
        element: <AppRoute />,
      })),
      {
        // Organizer-only attendee list for one term. Standalone (no
        // AppDataProvider): the page resolves the group from the term.
        path: "/terminy/:termId",
        element: <AuthGuard><TermAttendeesPage /></AuthGuard>,
      },
      {
        // Group details + standing member list, reached from the "Prowadzę"
        // tiles.
        path: "/grupy/:groupId",
        element: <AuthGuard><GroupDetailsPage /></AuthGuard>,
      },
      {
        path: INBOX_PATH,
        element: <AuthGuard><InboxPage /></AuthGuard>,
      },
      {
        path: `${INBOX_PATH}/:conversationId`,
        element: <AuthGuard><ThreadPage /></AuthGuard>,
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
        // The bare organizer product prefix has no page of its own: back to
        // the organizer. A sibling, not a layout child, so the layout below
        // only ever mounts with an item id.
        path: "/:organizationSlug/produkt",
        element: <Navigate to=".." relative="path" replace />,
      },
      {
        // Item pages reached from an organizer's term page: the same bodies
        // as /product/:id[/edit], in the organizer's palette and without the
        // panel nav (see OrganizerItemLayout). "produkt" and "grupa" are in
        // the backend's RESERVED_SLUGS.
        path: "/:organizationSlug/produkt/:id",
        element: <AuthGuard><OrganizerItemLayout /></AuthGuard>,
        children: [
          { index: true, element: <ItemDetailBody /> },
          { path: "edit", element: <ItemEditBody /> },
        ],
      },
      {
        path: "/:organizationSlug/grupa/:groupId/term/:termId",
        element: <TermPage />,
      },
      {
        // The organizer's full agenda — public, no AuthGuard. Two segments, so
        // the single-segment `/:organizationSlug` catch-all below never matches
        // it. "terminy" is in the backend's RESERVED_SLUGS only so a slug never
        // reads like this path segment (as with "grupa").
        path: "/:organizationSlug/terminy",
        element: <OrganizerTermsPage />,
      },
      {
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
];

export const router = createBrowserRouter(routes);
