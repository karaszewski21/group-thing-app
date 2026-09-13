import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";

/**
 * Task Group 9 gap (9.2): `Sidebar.test.tsx` gates its ADMIN assertions
 * against a fully mocked `useAuth()` returning a hand-written `string[]`
 * literal — it never exercises the real `AuthContext` JWT-decode pipeline
 * (`decodeJwtPayload` -> `payload.permissions ?? []`) that produces that
 * array in production. This file wires the REAL `AuthProvider`/`useAuth`
 * to a real base64url JWT payload and renders the real `Sidebar`, so a
 * mismatch between what `Sidebar` expects (a `permissions` array) and
 * what the login-token JWT shape actually carries would be caught here
 * even if `Sidebar.test.tsx`'s mock stayed green.
 *
 * `usePluginContext` alone is mocked (empty menu, per
 * `standards/testing/frontend-testing.md`'s module-mocking convention) —
 * it is unrelated to this gap and a real `PluginProvider` would need its
 * own API mocking, which would only add noise here.
 *
 * `AuthContext` module state (`initialAuth`) is computed once at import
 * time from `localStorage`, so each test sets `localStorage` and then
 * dynamically imports both `AuthContext` and `Sidebar` after
 * `vi.resetModules()` — forcing a fresh module evaluation that picks up
 * the token, mirroring the dynamic-import-after-setup pattern already
 * used in `CategoryFormPage.test.tsx`.
 */
vi.mock("../plugins/PluginContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plugins/PluginContext")>();
  return {
    ...actual,
    usePluginContext: () => ({
      plugins: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      getMenuItems: () => [],
      getProductDetailTabs: () => [],
      getProductListFilters: () => [],
      getProductDetailInfo: () => [],
    }),
  };
});

function setRealJwt(permissions: string[]): void {
  const payload = btoa(
    JSON.stringify({ sub: "integration-test", permissions, exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  localStorage.setItem("auth_token", `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`);
}

async function renderSidebarWithRealAuth() {
  const { AuthProvider } = await import("../auth/AuthContext");
  const { Sidebar } = await import("../components/layout/Sidebar");
  return render(
    <ChakraProvider value={system}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/panel"]}>
          <Sidebar />
        </MemoryRouter>
      </AuthProvider>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("Sidebar x AuthContext integration — real JWT-decoded permissions, not a mocked array", () => {
  it("shows Categories when the real JWT payload carries permissions:[\"ADMIN\"]", async () => {
    setRealJwt(["ADMIN"]);

    await renderSidebarWithRealAuth();

    expect(await screen.findByText("Categories")).toBeInTheDocument();
  });

  it("hides Categories when the real JWT payload carries READ+EDIT only (no ADMIN)", async () => {
    setRealJwt(["READ", "EDIT"]);

    await renderSidebarWithRealAuth();

    // Sanity: Sidebar did render (not just an empty/error tree) before
    // asserting on the absence of Categories.
    expect(await screen.findByText("Products")).toBeInTheDocument();
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
  });
});
