import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import type { ModerationGroupResponse } from "../api/groups";
import * as groupsApi from "../api/groups";
import { ModerationPage } from "../pages/ModerationPage";

vi.mock("../api/groups", () => ({
  getGroupsForModeration: vi.fn(),
}));

const mockGroups: ModerationGroupResponse[] = [
  {
    id: 1,
    name: "Krąg Sportowy",
    created_at: "2026-01-01T00:00:00Z",
    organizer_name: "Jan Kowalski",
    organizer_email: "jan@example.com",
    member_count: 4,
    term_count: 2,
  },
  {
    id: 2,
    name: "Krąg Bez Lidera",
    created_at: "2026-02-01T00:00:00Z",
    organizer_name: null,
    organizer_email: null,
    member_count: 0,
    term_count: 0,
  },
];

function renderWithProviders() {
  return render(
    <ChakraProvider value={system}>
      <MemoryRouter initialEntries={["/moderation"]}>
        <ModerationPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ModerationPage", () => {
  it("renders one row per circle with organizer, member count, and term count", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(mockGroups);

    renderWithProviders();

    expect(await screen.findByText("Krąg Sportowy")).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("(jan@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Krąg Bez Lidera")).toBeInTheDocument();
    expect(screen.getByText("No organizer")).toBeInTheDocument();
  });

  it("renders EmptyState when there are no circles", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue([]);

    renderWithProviders();

    expect(await screen.findByText("No circles found")).toBeInTheDocument();
  });

  it("shows the backend error message when the request is forbidden", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockRejectedValue(new Error("Network error — check connection"));

    renderWithProviders();

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });
});
