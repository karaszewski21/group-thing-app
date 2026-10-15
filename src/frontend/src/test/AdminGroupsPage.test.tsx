import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { ModerationGroupResponse } from "../api/groups";
import * as groupsApi from "../api/groups";
import { AdminGroupsPage } from "../pages/AdminGroupsPage";
import { system } from "../theme";
import { pageOf } from "./page";
import { createQueryWrapper } from "./queryClient";

/** `deleted_at` arrives as naive UTC; the row shows it in the viewer's zone.
 * Built with the native Date so the expectation is independent of dayjs. */
function localWallClock(utcIso: string): string {
  const d = new Date(utcIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

vi.mock("../api/groups", () => ({
  getGroupsForModeration: vi.fn(),
  restoreGroup: vi.fn(),
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
    deleted_at: null,
    deleted_by_name: null,
  },
  {
    id: "2",
    name: "Krąg Bez Lidera",
    created_at: "2026-02-01T00:00:00Z",
    organizer_name: null,
    organizer_email: null,
    member_count: 0,
    term_count: 0,
    deleted_at: null,
    deleted_by_name: null,
  },
];

const deletedGroup: ModerationGroupResponse = {
  ...mockGroups[0],
  deleted_at: "2026-10-14T09:12:00",
  deleted_by_name: "Anna Nowak",
};

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
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(pageOf(mockGroups));

    renderPage();

    expect(await screen.findByText("Krąg Sportowy")).toBeInTheDocument();
    expect(screen.getByText("Jan Kowalski")).toBeInTheDocument();
    expect(screen.getByText("(jan@example.com)")).toBeInTheDocument();
    expect(screen.getByText("Krąg Bez Lidera")).toBeInTheDocument();
    expect(screen.getByText("No organizer")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 circles")).toBeInTheDocument();
    expect(groupsApi.getGroupsForModeration).toHaveBeenCalledWith(1, false);
    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("pages through circles with Next", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(pageOf(mockGroups, 45));

    renderPage();

    expect(await screen.findByText("Page 1 of 3 · 45 total")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(groupsApi.getGroupsForModeration).toHaveBeenLastCalledWith(2, false));
    expect(await screen.findByText("Page 2 of 3 · 45 total")).toBeInTheDocument();
  });

  it("renders EmptyState when there are no circles", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(pageOf([]));

    renderPage();

    expect(await screen.findByText("No circles found")).toBeInTheDocument();
  });

  it("shows the backend error message when the request fails", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockRejectedValue(new Error("Network error — check connection"));

    renderPage();

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it("toggling to Deleted requests getGroupsForModeration(1, true) and shows Deleted at / Deleted by / Actions columns", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockImplementation(async (_page, deleted) =>
      deleted ? pageOf([deletedGroup, { ...mockGroups[1], deleted_at: "2026-10-13T18:40:00" }]) : pageOf(mockGroups),
    );

    renderPage();

    expect(await screen.findByText("Krąg Sportowy")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Deleted" }));

    await waitFor(() => expect(groupsApi.getGroupsForModeration).toHaveBeenLastCalledWith(1, true));
    expect(await screen.findByRole("columnheader", { name: "Deleted at" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Deleted by" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deleted" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(localWallClock("2026-10-14T09:12:00Z"))).toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 deleted circles")).toBeInTheDocument();
  });

  it("toggling while the next listing loads shows Loading... instead of the previous view's rows", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockImplementation((_page, deleted) =>
      deleted ? new Promise(() => {}) : Promise.resolve(pageOf(mockGroups)),
    );

    renderPage();
    expect(await screen.findByText("Krąg Sportowy")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deleted" }));

    expect(await screen.findByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Krąg Sportowy")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restore/ })).not.toBeInTheDocument();
  });

  it("Restore calls restoreGroup and refetches", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockImplementation(async (_page, deleted) =>
      deleted ? pageOf([deletedGroup]) : pageOf(mockGroups),
    );
    vi.mocked(groupsApi.restoreGroup).mockResolvedValue(undefined);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Deleted" }));
    const restoreButton = await screen.findByRole("button", { name: "Restore Krąg Sportowy" });
    const callsBefore = vi.mocked(groupsApi.getGroupsForModeration).mock.calls.length;

    vi.mocked(groupsApi.getGroupsForModeration).mockImplementation(async (_page, deleted) =>
      deleted ? pageOf([]) : pageOf(mockGroups),
    );
    fireEvent.click(restoreButton);

    expect(groupsApi.restoreGroup).toHaveBeenCalledWith("1");
    expect(await screen.findByText("No deleted circles")).toBeInTheDocument();
    expect(vi.mocked(groupsApi.getGroupsForModeration).mock.calls.length).toBeGreaterThan(callsBefore);
    expect(screen.getByRole("button", { name: "Deleted" })).toHaveFocus();
  });

  it("restore error shows role=alert in the row", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockResolvedValue(pageOf([deletedGroup]));
    vi.mocked(groupsApi.restoreGroup).mockRejectedValue(
      new ApiError(409, "Conflict", { type: "about:blank", title: "Conflict", status: 409, detail: "Group is not deleted." }),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Deleted" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore Krąg Sportowy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Group is not deleted.");
    expect(screen.getByRole("button", { name: "Restore Krąg Sportowy" })).toBeEnabled();
  });

  it("Deleted empty state shows No deleted circles", async () => {
    vi.mocked(groupsApi.getGroupsForModeration).mockImplementation(async (_page, deleted) =>
      deleted ? pageOf([]) : pageOf(mockGroups),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Deleted" }));

    expect(await screen.findByText("No deleted circles")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Group status" })).toBeInTheDocument();
  });
});
