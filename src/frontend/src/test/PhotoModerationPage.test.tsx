import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as moderationApi from "../api/moderation";
import type { ModerationQueueEntry } from "../api/moderation";
import { PhotoModerationPage } from "../pages/PhotoModerationPage";
import { system } from "../theme";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/moderation", () => ({
  getModerationPhotos: vi.fn(),
  deleteModerationPhoto: vi.fn(),
  decideModeration: vi.fn(),
}));

const APPROVED: ModerationQueueEntry = {
  subject_type: "PHOTO",
  subject_id: "photo-1",
  product_id: "product-1",
  product_name: "Wózek spacerowy",
  photo_url: "https://cdn.example/p/w1600.webp",
  status: "APPROVED",
  model_id: "google/shieldgemma-2-4b-it",
  scores: { sexual: 0.01, violence: 0.02, weapons: 0.0, dangerous: 0.0 },
  submitted_at: "2026-10-06T08:00:00",
};

function renderPage() {
  return render(
    <ChakraProvider value={system}>
      <PhotoModerationPage />
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}

describe("PhotoModerationPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("photos_defaultFilter_listsEveryStatusWithStatusLabel", async () => {
    vi.mocked(moderationApi.getModerationPhotos).mockResolvedValue([APPROVED]);
    renderPage();

    expect(await screen.findByAltText("Photo of Wózek spacerowy")).toHaveAttribute("src", APPROVED.photo_url);
    expect(moderationApi.getModerationPhotos).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("photos_statusFilter_requestsThatStatus", async () => {
    vi.mocked(moderationApi.getModerationPhotos).mockResolvedValue([]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Rejected" }));

    await waitFor(() => expect(moderationApi.getModerationPhotos).toHaveBeenCalledWith("REJECTED"));
  });

  it("photos_rejectApproved_sendsDecisionAndReloads", async () => {
    vi.mocked(moderationApi.getModerationPhotos)
      .mockResolvedValueOnce([APPROVED])
      .mockResolvedValue([{ ...APPROVED, status: "REJECTED" }]);
    vi.mocked(moderationApi.decideModeration).mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(moderationApi.decideModeration).toHaveBeenCalledWith({
        subject_type: "PHOTO",
        subject_id: "photo-1",
        outcome: "REJECTED",
      }),
    );
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("photos_deleteConfirmed_deletesPhotoAndReloads", async () => {
    vi.mocked(moderationApi.getModerationPhotos).mockResolvedValueOnce([APPROVED]).mockResolvedValue([]);
    vi.mocked(moderationApi.deleteModerationPhoto).mockResolvedValue(undefined);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/This action cannot be undone/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(moderationApi.deleteModerationPhoto).toHaveBeenCalledWith("photo-1"));
    expect(await screen.findByText("No photos")).toBeInTheDocument();
  });

  it("photos_deleteFails_showsErrorInDialog", async () => {
    vi.mocked(moderationApi.getModerationPhotos).mockResolvedValue([APPROVED]);
    vi.mocked(moderationApi.deleteModerationPhoto).mockRejectedValue(
      new ApiError(404, "Not Found", { title: "Not Found", status: 404, detail: "Nie znaleziono zdjęcia" }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByText("Nie znaleziono zdjęcia")).toBeInTheDocument();
  });

  it("photos_deleteCancelled_doesNotDelete", async () => {
    vi.mocked(moderationApi.getModerationPhotos).mockResolvedValue([APPROVED]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(moderationApi.deleteModerationPhoto).not.toHaveBeenCalled();
  });
});
