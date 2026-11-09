import { screen } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { describe, expect, it } from "vitest";
import type { PublicCircleResponse, PublicItemListingResponse } from "../api/groups";
import { ParticipantList } from "../components/shared/ParticipantList";
import { buildAttendees } from "../features/terms/termViewModel";

function listing(thumbUrl: string | null): PublicItemListingResponse {
  return {
    id: "9",
    item_id: "9",
    product_name: "Kask rowerowy",
    condition: "GOOD",
    offered_types: ["GIFT"],
    lister_party_id: "21",
    lister_display_name: "Ola Nowak",
    thumb_url: thumbUrl,
    added_at: "2026-10-30T09:00:00",
    reservation: null,
  };
}

function renderRow(thumbUrl: string | null) {
  renderWithRoute(
    <ParticipantList
      label="Zapisani na zajęcia"
      rows={buildAttendees({
        guardians: [{ party_id: "21", display_name: "Ola Nowak" }],
        term: { item_listings: [listing(thumbUrl)] },
      } as unknown as PublicCircleResponse)}
    />,
    { url: "/" },
  );
  const link = screen.getByRole("link", { name: /Kask rowerowy/ });
  const tile = link.firstElementChild as HTMLElement;
  return { link, tile };
}

describe("Term page listing thumbnail", () => {
  it("renders a decorative image in a 48px tile at the start of the item link when thumb_url is set", () => {
    const { link, tile } = renderRow("https://cdn.example.com/kask.jpg");

    const img = link.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/kask.jpg");
    expect(tile).toContainElement(img);
    expect(tile).toHaveClass("size-12", "shrink-0", "rounded-xl", "bg-cream");
    expect(link).toHaveAttribute("href", "/21/product/9");
  });

  it("renders the PhotoPlaceholder tile when thumb_url is null", () => {
    const { link, tile } = renderRow(null);

    expect(link.querySelector("img")).toBeNull();
    expect(tile).toHaveClass("size-12", "bg-cream");
    expect(tile.querySelector("svg")).not.toBeNull();
  });
});
