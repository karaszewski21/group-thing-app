import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { PublicLayout } from "./components/layout/PublicLayout";
import { ProductListPage } from "./features/admin/ProductListPage";
import { ProductFormPage } from "./features/admin/ProductFormPage";
import { CategoryListPage } from "./features/admin/CategoryListPage";
import { CategoryFormPage } from "./features/admin/CategoryFormPage";
import { AdminGroupsPage } from "./features/admin/AdminGroupsPage";
import { AdminTermsPage } from "./features/admin/AdminTermsPage";
import { PhotoModerationPage } from "./features/admin/PhotoModerationPage";
import { ProductDetailPage } from "./features/admin/ProductDetailPage";
import { PluginListPage } from "./features/admin/PluginListPage";
import { PluginDetailPage } from "./features/admin/PluginDetailPage";
import { PluginFormPage } from "./features/admin/PluginFormPage";
import { PluginPageRoute } from "./features/admin/PluginPageRoute";
import { LoginPage } from "./features/auth/LoginPage";
import { OAuth2AuthorizePage } from "./features/auth/OAuth2AuthorizePage";
import { TermPage } from "./features/terms/TermPage";
import { AppPage } from "./features/panel/AppPage";
import { TermAttendeesPage } from "./features/meetings/TermAttendeesPage";
import { GroupDetailsPage } from "./features/groups/GroupDetailsPage";
import { EventPage } from "./features/events/EventPage";
import { InboxPage } from "./features/messages/InboxPage";
import { ThreadPage } from "./features/messages/ThreadPage";
import { ItemDetailBody, ItemDetailPage } from "./features/items/product/ItemDetailPage";
import { OrganizerItemLayout } from "./features/items/product/OrganizerItemLayout";
import { OnboardingPage } from "./features/auth/OnboardingPage";
import { LandingPage } from "./features/landing/LandingPage";
import { PublicAddView } from "./features/add/AddView";
import { PhoneFrame } from "./components/shared/PhoneFrame";
import { OrganizationPage } from "./features/owner-page/OrganizationPage";
import { OrganizerTermsPage } from "./features/owner-page/OrganizerTermsPage";
import { OwnerItemsPage } from "./features/owner-page/OwnerItemsPage";
import { OwnerMeetingsPage } from "./features/owner-page/OwnerMeetingsPage";
import { OwnerPage } from "./features/owner-page/OwnerPage";
import { AuthGuard } from "./auth/AuthGuard";
import { useAuth } from "./auth/AuthContext";
import { PluginProvider } from "./plugins/host/PluginHost";
import { viewPath, type ID_PATH_VIEWS, type View } from "./utils/appHelpers";
import { INBOX_PATH } from "./routing/messagesPaths";

// The ID_PATH_VIEWS have their own routes below: their paths carry an id.
const PANEL_VIEWS: readonly Exclude<View, "home" | (typeof ID_PATH_VIEWS)[number]>[] = [
  "meetings",
  "groups",
  "groups/new",
  "items",
  "profile",
  "settings",
  "places",
  "places/new",
  "family",
  "family/new",
  "family/edit",
  "family/members/new",
  "account",
  "search",
  "wanted",
  "add",
  "add/product",
  "add/term",
  "add/event",
  "add/hunting",
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
 * anonymous visitor gets the LandingPage at "/", the "Co dodajesz?" tiles at
 * /add (each leading to the login page) and the login page elsewhere. */
function AppRoute() {
  const { token } = useAuth();
  const { pathname } = useLocation();
  if (!token && pathname === "/") return <LandingPage />;
  if (!token && pathname === viewPath("add")) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <PublicAddView />
        </div>
      </PhoneFrame>
    );
  }
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
      // The panel's sections, one top-level URL each (`/items`, `/account`, …)
      // so a refresh or a shared link lands on the same section — see
      // AppDataContext.tsx, which derives `view` from the pathname. Static
      // segments, so they rank above the `/:organizationSlug` catch-all; every
      // one is in the backend's RESERVED_SLUGS.
      ...PANEL_VIEWS.map((view) => ({
        path: viewPath(view),
        element: <AppRoute />,
      })),
      {
        path: "/groups/:groupId/edit",
        element: <AppRoute />,
      },
      {
        path: "/places/:locationId/edit",
        element: <AppRoute />,
      },
      {
        path: "/family/members/:familyMembershipId/edit",
        element: <AppRoute />,
      },
      {
        // Editing stays under "/events" (in the backend's RESERVED_SLUGS);
        // the event page itself lives under the author's slug, below.
        path: "/events/:eventId/edit",
        element: <AppRoute />,
      },
      {
        path: "/terms/:termId/edit",
        element: <AppRoute />,
      },
      {
        // Organizer-only attendee list for one term. Standalone (no
        // AppDataProvider): the page resolves the group from the term.
        path: "/terms/:termId",
        element: <AuthGuard><TermAttendeesPage /></AuthGuard>,
      },
      {
        // Group details + standing member list, reached from the group
        // tiles on /groups ("Moje grupy").
        path: "/groups/:groupId",
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
        // Item pages — public, no AuthGuard: listed items read anonymously;
        // a non-public item sends an anonymous visitor to login (ItemDetailBody).
        // "product" is in the backend's RESERVED_SLUGS.
        path: "/product/:id",
        element: <ItemDetailPage />,
      },
      {
        // Former edit subpage: editing now happens in place on the item page.
        path: "/product/:id/edit",
        element: <Navigate to="..?edit=1" relative="path" replace />,
      },
      {
        // The bare organizer product prefix has no page of its own: back to
        // the organizer. A sibling, not a layout child, so the layout below
        // only ever mounts with an item id.
        path: "/:organizationSlug/product",
        element: <Navigate to=".." relative="path" replace />,
      },
      {
        // Item pages reached from an organizer's term page: the same bodies
        // as /product/:id, in the organizer's palette and without the
        // panel nav (see OrganizerItemLayout). "product" and "group" are in
        // the backend's RESERVED_SLUGS.
        path: "/:organizationSlug/product/:id",
        element: <OrganizerItemLayout />,
        children: [
          { index: true, element: <ItemDetailBody /> },
          { path: "edit", element: <Navigate to="..?edit=1" relative="path" replace /> },
        ],
      },
      {
        path: "/:organizationSlug/group/:groupId/term/:termId",
        element: <TermPage />,
      },
      {
        // The public event page — no AuthGuard; the author gets edit/delete.
        // "event" is in the backend's RESERVED_SLUGS.
        path: "/:organizationSlug/event/:eventId",
        element: <EventPage />,
      },
      {
        // The organizer's full agenda — public, no AuthGuard. Two segments, so
        // the single-segment `/:organizationSlug` catch-all below never matches
        // it. "terms" is in the backend's RESERVED_SLUGS only so a slug never
        // reads like this path segment (as with "group").
        path: "/:organizationSlug/terms",
        element: <OrganizerTermsPage />,
      },
      {
        // The owner's listed items — public, no AuthGuard. A UUID-shaped first
        // segment is a party id (any person), otherwise an Organization slug.
        path: "/:organizationSlug/items",
        element: <OwnerItemsPage />,
      },
      {
        // The owner's upcoming public terms and events — public, no
        // AuthGuard. A UUID-shaped first segment is a party id, otherwise an
        // Organization slug ("meetings" is in the backend's RESERVED_SLUGS).
        path: "/:organizationSlug/meetings",
        element: <OwnerMeetingsPage />,
      },
      {
        // A UUID-shaped segment is a person's profile, otherwise an
        // Organization's page (see OwnerPage).
        path: "/:organizationSlug",
        element: <OwnerPage />,
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
