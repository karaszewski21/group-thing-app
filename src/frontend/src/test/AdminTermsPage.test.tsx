import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModerationTermResponse } from "../api/terms";
import * as termsApi from "../api/terms";
import { AdminTermsPage } from "../pages/AdminTermsPage";
import { system } from "../theme";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/terms", () => ({
  getTermsForModeration: vi.fn(),
}));

const TERM: ModerationTermResponse = {
  id: "term-1",
  circle_group_id: "group-1",
  group_name: "Muzyczne Skrzaty",
  occurs_on: "2026-11-09T17:30:00",
  description: "Drugie spotkanie",
  created_at: "2026-10-01T08:00:00",
  attendee_count: 3,
  child_count: 5,
};

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <AdminTermsPage />
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}

describe("AdminTermsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders each term with its circle, date, description and signup counts", async () => {
    vi.mocked(termsApi.getTermsForModeration).mockResolvedValue([
      TERM,
      { ...TERM, id: "term-2", description: null, attendee_count: 0, child_count: 0 },
    ]);

    renderPage();

    expect(await screen.findByText("Drugie spotkanie")).toBeInTheDocument();
    expect(screen.getAllByText("Muzyczne Skrzaty")).toHaveLength(2);
    expect(screen.getAllByText("9 lis 2026, 17:30")).toHaveLength(2);
    expect(screen.getByText("No description")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 terms")).toBeInTheDocument();
  });

  it("renders EmptyState when there are no terms", async () => {
    vi.mocked(termsApi.getTermsForModeration).mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No terms found")).toBeInTheDocument();
  });

  it("shows the backend error message when the request fails", async () => {
    vi.mocked(termsApi.getTermsForModeration).mockRejectedValue(new Error("Network error — check connection"));

    renderPage();

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });
});
