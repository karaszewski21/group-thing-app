import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Link, MemoryRouter } from "react-router-dom";
import { AttendeeList } from "../pages/krag/components/AttendeeList";
import type { ListingRowVM } from "../pages/krag/components/termSectionTypes";

function renderRow(thumbUrl?: string | null) {
  const row: ListingRowVM = {
    key: "9",
    title: (
      <Link to="/ania/rzecz/9">
        <strong>Kask rowerowy</strong>
      </Link>
    ),
    actions: [],
    ...(thumbUrl !== undefined && { thumbUrl }),
  };
  render(
    <MemoryRouter>
      <AttendeeList attendees={[{ partyId: "21", name: "Ola Nowak", listings: [row] }]} activePartyId={null} />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Kask rowerowy" });
  const rowEl = link.closest(".kg-bring-item") as HTMLElement;
  return { link, rowEl };
}

describe("Term page listing thumbnail", () => {
  it("renders a decorative image in a 48px tile left of the item link when thumb_url is set", () => {
    const { link, rowEl } = renderRow("https://cdn.example.com/kask.jpg");

    const img = rowEl.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/kask.jpg");
    const tile = rowEl.firstElementChild as HTMLElement;
    expect(tile).toContainElement(img);
    expect(tile).toHaveClass("size-12", "shrink-0", "rounded-xl", "bg-cream");
    expect(link).not.toContainElement(img);
    expect(rowEl).toHaveClass("gap-3");
  });

  it("renders the PhotoPlaceholder tile when thumb_url is null", () => {
    const { link, rowEl } = renderRow(null);

    expect(rowEl.querySelector("img")).toBeNull();
    const tile = rowEl.firstElementChild as HTMLElement;
    expect(tile).toHaveClass("size-12", "bg-cream");
    expect(tile.querySelector("svg")).not.toBeNull();
    expect(tile).not.toContainElement(link);
  });

  it("renders no tile for a row without thumbUrl (private term page)", () => {
    const { rowEl } = renderRow(undefined);

    expect(rowEl.querySelector("img")).toBeNull();
    expect(rowEl.querySelector("svg")).toBeNull();
    expect(rowEl.querySelector(".size-12")).toBeNull();
    expect(rowEl).not.toHaveClass("gap-3");
  });
});
