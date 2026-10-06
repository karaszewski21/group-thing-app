import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModerationGroupResponse } from "../api/groups";
import * as groupsApi from "../api/groups";
import { AdminGroupsPage } from "../pages/AdminGroupsPage";
import { system } from "../theme";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  getGroupsForModeration: vi.fn(),
}));

const mockGroups: ModerationGroupResponse[] = [
  {
    id: "1",
    name: "Krąg Sportowy",
    created_at: "2026-01-01T00:00:00Z",
    organizer_name: "Jan Kowalski",
    organizer_email: "jan@example.com",
    member_count: 4,
    term_count: 2,
  },
  {
    id: "2",
    name: "Krąg Bez Lidera",
    created_at: "2026-02-01T00:00:00Z",
    organizer_name: null,
    organizer_email: null,
    member_count: 0,
    term_count: 0,
  },
];

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <AdminGroupsPage />
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}

describe("AdminGroupsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders one row per circle with organizer, member count, and term count", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(mockGroups);

    renderPage();

    expect(await screen.findByText("Krąg Sportowy")).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("(jan@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Krąg Bez Lidera")).toBeInTheDocument();
    expect(screen.getByText("No organizer")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 circles")).toBeInTheDocument();
  });

  it("renders EmptyState when there are no circles", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No circles found")).toBeInTheDocument();
  });

  it("shows the backend error message when the request fails", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockRejectedValue(new Error("Network error — check connection"));

    renderPage();

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });
});
