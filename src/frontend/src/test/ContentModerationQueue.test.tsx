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
  description: null,
  photo_url: "https://origin.example/p/w1600.webp?signed",
  status: "NEEDS_REVIEW",
  model_id: "Falconsai/nsfw_image_detection",
  scores: { normal: 0.3, nsfw: 0.7 },
  submitted_at: "2026-10-02T08:00:00",
};

const TEXT: ModerationQueueEntry = {
  ...PHOTO,
  subject_type: "PRODUCT_TEXT",
  subject_id: "product-1",
  description: "Rozmiar 62",
  photo_url: null,
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

  it("lists flagged photos and texts with their scores", async () => {
    vi.mocked(moderationApi.getModerationQueue).mockResolvedValue([PHOTO, TEXT]);
    renderQueue();

    expect(await screen.findByAltText("Photo of Body niemowlęce")).toHaveAttribute("src", PHOTO.photo_url);
    expect(screen.getByText("Rozmiar 62")).toBeInTheDocument();
    expect(screen.getByText(/nsfw 0\.70 · normal 0\.30/)).toBeInTheDocument();
    expect(screen.getByText(/No model score/)).toBeInTheDocument();
    expect(moderationApi.getModerationQueue).toHaveBeenCalledWith("NEEDS_REVIEW");
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
