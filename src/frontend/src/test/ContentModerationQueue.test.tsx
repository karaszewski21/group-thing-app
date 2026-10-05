import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as moderationApi from "../api/moderation";
import type { ModerationQueueEntry } from "../api/moderation";
import { ContentModerationQueue } from "../pages/ContentModerationQueue";
import { system } from "../theme";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/moderation", () => ({
  getModerationQueue: vi.fn(),
  decideModeration: vi.fn(),
}));

const PHOTO: ModerationQueueEntry = {
  subject_type: "PHOTO",
  subject_id: "photo-1",
  product_id: "product-1",
  product_name: "Body niemowlęce",
  photo_url: "https://origin.example/p/w1600.webp?signed",
  status: "NEEDS_REVIEW",
  model_id: "google/shieldgemma-2-4b-it",
  scores: { sexual: 0.03, violence: 0.71, weapons: 0.4, dangerous: 0.12 },
  submitted_at: "2026-10-02T08:00:00",
};

/** VPS B failed after every retry: NEEDS_REVIEW with no AI decision. */
const UNSCORED: ModerationQueueEntry = {
  ...PHOTO,
  subject_id: "photo-2",
  product_name: "Rower 16\"",
  photo_url: "https://origin.example/q/w1600.webp?signed",
  scores: null,
  model_id: null,
};

function renderQueue() {
  return render(
    <ChakraProvider value={system}>
      <ContentModerationQueue />
    </ChakraProvider>,
    { wrapper: createQueryWrapper() },
  );
}

describe("ContentModerationQueue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("queue_rendersPhotoEntriesOnly_withCategoryScores", async () => {
    vi.mocked(moderationApi.getModerationQueue).mockResolvedValue([PHOTO]);
    renderQueue();

    expect(await screen.findByAltText("Photo of Body niemowlęce")).toHaveAttribute("src", PHOTO.photo_url);
    expect(screen.getByRole("heading", { name: "Photo review" })).toBeInTheDocument();
    expect(screen.getByText("Photo")).toBeInTheDocument();
    expect(screen.queryByText("Name + description")).not.toBeInTheDocument();
    expect(
      screen.getByText(/violence 0\.71 · weapons 0\.40 · dangerous 0\.12 · sexual 0\.03 \(google\/shieldgemma-2-4b-it\)/),
    ).toBeInTheDocument();
    expect(moderationApi.getModerationQueue).toHaveBeenCalledWith("NEEDS_REVIEW");
  });

  it("queue_nullScores_showsNoModelScore", async () => {
    vi.mocked(moderationApi.getModerationQueue).mockResolvedValue([UNSCORED]);
    renderQueue();

    expect(await screen.findByAltText('Photo of Rower 16"')).toHaveAttribute("src", UNSCORED.photo_url);
    expect(screen.getByText(/No model score · /)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("approves an entry and reloads the queue", async () => {
    vi.mocked(moderationApi.getModerationQueue).mockResolvedValueOnce([PHOTO]).mockResolvedValue([]);
    vi.mocked(moderationApi.decideModeration).mockResolvedValue(undefined);
    renderQueue();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(moderationApi.decideModeration).toHaveBeenCalledWith({
        subject_type: "PHOTO",
        subject_id: "photo-1",
        outcome: "APPROVED",
      }),
    );
    expect(await screen.findByText("Nothing to review")).toBeInTheDocument();
  });

  it("switches to the rejected queue", async () => {
    vi.mocked(moderationApi.getModerationQueue).mockResolvedValue([]);
    renderQueue();

    fireEvent.click(await screen.findByRole("button", { name: "Rejected" }));

    await waitFor(() => expect(moderationApi.getModerationQueue).toHaveBeenCalledWith("REJECTED"));
  });
});
