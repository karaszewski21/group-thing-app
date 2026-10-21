import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Link, MemoryRouter } from "react-router-dom";
import { AttendeeList } from "../pages/term/components/AttendeeList";
import type { ListingRowVM } from "../pages/term/components/termSectionTypes";

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
  const rowEl = link.closest("[data-listing-row]") as HTMLElement;
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

describe("Term page attendee items", () => {
  function listing(index: number): ListingRowVM {
    return { key: String(index), title: <strong>{`Rzecz ${index}`}</strong>, actions: [], thumbUrl: null };
  }

  it("shows three items, then lets the visitor expand and collapse the rest", () => {
    render(
      <MemoryRouter>
        <AttendeeList
          attendees={[{ partyId: "21", name: "Ola Nowak", listings: [1, 2, 3, 4, 5].map(listing) }]}
          activePartyId={null}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Rzecz 3")).toBeInTheDocument();
    expect(screen.queryByText("Rzecz 4")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Pokaż wszystkie (5)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(screen.getByText("Rzecz 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zwiń" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Zwiń" }));
    expect(screen.queryByText("Rzecz 4")).not.toBeInTheDocument();
  });

  it("offers no toggle for three items or fewer", () => {
    render(
      <MemoryRouter>
        <AttendeeList
          attendees={[{ partyId: "21", name: "Ola Nowak", listings: [1, 2, 3].map(listing) }]}
          activePartyId={null}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: /Pokaż wszystkie/ })).not.toBeInTheDocument();
  });
});
