import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TermPage } from "../pages/krag/TermPage";
import type { UseKragGrupyResult } from "../hooks/useKragGrupy";
import type * as usePublicKragGrupyModule from "../hooks/usePublicKragGrupy";
import * as groupsApi from "../api/groups";
import type { GroupAccessResponse, PublicCircleResponse } from "../api/groups";

/** Merged-route branching (`/:organizationSlug/grupa/:groupId/term/:termId`,
 * the sole group-screen URL after the former `/krag/:groupId` + `/krag`
 * routes were removed): `TermAccessBoundary` decides Private / Public /
 * Denied from `getGroupAccess`'s server-resolved `is_member`/`is_organizer`
 * — NOT from raw `token` presence (the previous heuristic this replaced).
 * This file exercises only that branch — the three views' own full behavior
 * is covered by `TermPage.test.tsx` (private), `PublicTermPage.test.tsx`
 * (public), and `PrivateGroupAccessDenied`'s own assertions below. */

let mockToken: string | null = null;

vi.mock("../api/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/groups")>();
  return { ...actual, getGroupAccess: vi.fn() };
});

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return {
    ...actual,
    useAuth: () => ({
      token: mockToken,
      username: null,
      displayName: null,
      permissions: [],
      registeredRole: null,
      login: vi.fn(),
      register: vi.fn(),
      applyExternalToken: vi.fn(),
      logout: vi.fn(),
    }),
  };
});

const privateHookValue: UseKragGrupyResult = {
  loading: false,
  error: null,
  group: { id: 1, name: "Prywatny widok grupy", organizer_party_id: 7, layout_mode: "CIRCLE" } as never,
  organizer: { party_id: 7, display_name: "Ola" } as never,
  families: [],
  myPartyId: 42,
  currentTerm: null,
  neededItems: [],
  myAvailableItems: [],
  mySwapAvailableItems: [],
  myAttendanceForCurrentTerm: null,
  myItemListings: [],
  browseListings: [],
  pledgeFamilyName: () => "",
  pledge: vi.fn(),
  withdraw: vi.fn(),
  fulfillPledgeItem: vi.fn(),
  confirmPledgeReceipt: vi.fn(),
  takeListing: vi.fn(),
  proposeSwap: vi.fn(),
  withdrawMyAttendance: vi.fn(),
  confirmListingReceipt: vi.fn(),
  activeFamilyExchangeOffers: [],
  loadingExchangeOffers: false,
  exchangeOffersError: null,
  loadExchangeOffersForFamily: vi.fn(),
  setGroupLayoutMode: vi.fn(),
  takeOrProposeExchange: vi.fn(),
  refetch: vi.fn(),
};

vi.mock("../hooks/useKragGrupy", () => ({
  useKragGrupy: () => privateHookValue,
}));

const publicCircle: PublicCircleResponse = {
  id: 7,
  name: "Publiczny widok grupy",
  organizer_display_name: "Ania Kowalska",
  organizer_slug: "ania-kowalska",
  visibility: "PUBLIC",
  next_term: null,
  guardians: [],
};

const publicHookValue: ReturnType<typeof usePublicKragGrupyModule.usePublicKragGrupy> = {
  loading: false,
  error: null,
  circle: publicCircle,
  refetch: vi.fn(),
};

vi.mock("../hooks/usePublicKragGrupy", () => ({
  usePublicKragGrupy: () => publicHookValue,
}));

vi.mock("../api/reservations", () => ({ getReservation: vi.fn() }));
vi.mock("../api/termItemListings", () => ({
  getMyTakenTermItemListings: vi.fn().mockResolvedValue([]),
  getBrowseTermItemListings: vi.fn().mockResolvedValue([]),
  takeTermItemListing: vi.fn(),
  proposeSwap: vi.fn(),
}));
vi.mock("../api/people", () => ({ getMyProfile: vi.fn().mockRejectedValue(new Error("anonymous")) }));

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:organizationSlug/grupa/:groupId/term/:termId" element={<TermPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function mockAccess(overrides: Partial<GroupAccessResponse["access"]>, group: PublicCircleResponse) {
  const response: GroupAccessResponse = {
    group,
    access: {
      is_member: false,
      is_organizer: false,
      can_view_content: group.visibility === "PUBLIC",
      can_join: group.visibility === "PRIVATE",
      ...overrides,
    },
  };
  vi.mocked(groupsApi.getGroupAccess).mockResolvedValue(response);
}

describe("TermAccessBoundary — routes on server-resolved access, not token presence", () => {
  it("renders the private (member) view when the caller is a member", async () => {
    mockToken = "test-token";
    mockAccess({ is_member: true, can_view_content: true }, publicCircle);
    renderAt("/org/grupa/1/term/9");

    expect(
      await screen.findByRole("heading", { name: "Prywatny widok grupy", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the private (member) view when the caller is the organizer", async () => {
    mockToken = "test-token";
    mockAccess({ is_organizer: true, can_view_content: true }, publicCircle);
    renderAt("/org/grupa/1/term/9");

    expect(
      await screen.findByRole("heading", { name: "Prywatny widok grupy", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the public (anonymous-safe) view for a PUBLIC group the caller doesn't belong to", async () => {
    mockToken = null;
    mockAccess({}, publicCircle);
    renderAt("/org/grupa/7/term/101");

    expect(
      await screen.findByRole("heading", { name: "Publiczny widok grupy", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders the public (anonymous-safe) view for a PUBLIC group even when a token is present but the caller isn't a member", async () => {
    // Regression case: the previous `token ? Private : Public` heuristic
    // routed ANY logged-in visitor to the private/member view regardless of
    // actual membership — this is the case that broke.
    mockToken = "test-token";
    mockAccess({}, publicCircle);
    renderAt("/org/grupa/7/term/101");

    expect(
      await screen.findByRole("heading", { name: "Publiczny widok grupy", level: 1 }),
    ).toBeInTheDocument();
  });

  it("renders PrivateGroupAccessDenied for a PRIVATE group the caller doesn't belong to", async () => {
    mockToken = "test-token";
    const privateCircle: PublicCircleResponse = {
      ...publicCircle,
      name: "Prywatna grupa bez dostępu",
      visibility: "PRIVATE",
    };
    mockAccess({ can_join: true }, privateCircle);
    renderAt("/org/grupa/7/term/101");

    expect(
      await screen.findByText("Ta grupa jest prywatna — mogą się do niej zapisać tylko stali członkowie."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Prywatny widok grupy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Publiczny widok grupy" })).not.toBeInTheDocument();
    // Regression: PrivateGroupAccessDenied previously rendered with no
    // <style>{CSS}</style> tag at all — every .kg-* class was undefined,
    // so this screen (often the very first thing a shared PRIVATE-group
    // link's visitor ever sees) rendered as unstyled plain text.
    expect(document.querySelector("style")).not.toBeNull();
    expect(document.querySelector(".kg-app")).not.toBeNull();
  });
});
