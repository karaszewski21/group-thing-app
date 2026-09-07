import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { ProductListPage } from "./pages/ProductListPage";
import { ProductFormPage } from "./pages/ProductFormPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ProductFootprintPage } from "./pages/ProductFootprintPage";
import { FootprintComparisonPage } from "./pages/FootprintComparisonPage";
import { CarbonFootprintLandingPage } from "./pages/CarbonFootprintLandingPage";
import { PluginListPage } from "./pages/PluginListPage";
import { PluginDetailPage } from "./pages/PluginDetailPage";
import { PluginFormPage } from "./pages/PluginFormPage";
import { PluginPageRoute } from "./pages/PluginPageRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { OAuth2AuthorizePage } from "./pages/OAuth2AuthorizePage";
import { KragGrupyPage } from "./pages/krag/KragGrupyPage";
import { KragEntryPage } from "./pages/krag/KragEntryPage";
import { PanelPage } from "./pages/panel/PanelPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { AuthGuard } from "./auth/AuthGuard";
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
    // Standalone mobile-style page (own phone-frame chrome) — deliberately
    // outside the admin AppShell/Sidebar layout, same pattern as /login and
    // /oauth2/authorize above.
    path: "/krag/:groupId",
    element: <AuthGuard><KragGrupyPage /></AuthGuard>,
  },
  {
    // Resolves the current guardian's own Circle and redirects — the entry
    // point linked from the Sidebar, since /krag/:groupId itself needs an id.
    path: "/krag",
    element: <AuthGuard><KragEntryPage /></AuthGuard>,
  },
  {
    // Role-aware landing for Guest/Organizer accounts — same standalone,
    // Tailwind phone-frame pattern as /krag above.
    path: "/panel",
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
    path: "/",
    element: (
      <AuthGuard>
        <Layout />
      </AuthGuard>
    ),
    children: [
      { index: true, element: <Navigate to="/panel" replace /> },
      { path: "products", element: <ProductListPage /> },
      { path: "products/new", element: <ProductFormPage /> },
      { path: "products/:id", element: <ProductDetailPage /> },
      { path: "products/:id/edit", element: <ProductFormPage /> },
      { path: "products/:id/footprint", element: <ProductFootprintPage /> },
      { path: "products/:id/footprint/compare", element: <FootprintComparisonPage /> },
      { path: "carbon-footprint", element: <CarbonFootprintLandingPage /> },
      { path: "plugins", element: <PluginListPage /> },
      { path: "plugins/new", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/detail", element: <PluginDetailPage /> },
      { path: "plugins/:pluginId/edit", element: <PluginFormPage /> },
      { path: "plugins/:pluginId/*", element: <PluginPageRoute /> },
    ],
  },
]);
