import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getOpenSheetCount } from "../components/shared/openSheets";
import { PhotoViewer } from "../components/shared/PhotoViewer";
import { ItemGallery } from "../pages/product/ItemGallery";
import type { ProductPhotoResponse } from "../api/products";

const URLS = ["https://cdn.test/1.webp", "https://cdn.test/2.webp", "https://cdn.test/3.webp"];

afterEach(() => {
  cleanup();
});

function viewerImage() {
  return within(screen.getByRole("dialog", { name: "Rower — galeria" })).getByRole("img");
}

describe("PhotoViewer", () => {
  it("starts at the given photo and steps with arrow keys and buttons without wrapping", () => {
    render(<PhotoViewer name="Rower" urls={URLS} startIndex={1} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Rower — galeria" });
    expect(dialog).toHaveFocus();
    expect(viewerImage()).toHaveAttribute("src", URLS[1]);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(viewerImage()).toHaveAttribute("src", URLS[2]);
    expect(screen.getByRole("button", { name: "Następne zdjęcie" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Następne zdjęcie" }));
    expect(viewerImage()).toHaveAttribute("src", URLS[2]);

    fireEvent.click(screen.getByRole("button", { name: "Poprzednie zdjęcie" }));
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(viewerImage()).toHaveAttribute("src", URLS[0]);
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("moves between photos on a horizontal swipe", () => {
    render(<PhotoViewer name="Rower" urls={URLS} startIndex={0} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");

    fireEvent.touchStart(dialog, { touches: [{ clientX: 300 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 200 }] });
    expect(viewerImage()).toHaveAttribute("src", URLS[1]);

    fireEvent.touchStart(dialog, { touches: [{ clientX: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 220 }] });
    expect(viewerImage()).toHaveAttribute("src", URLS[1]);
  });

  it("closes on Esc, the close button and the backdrop, but not on the photo", () => {
    const onClose = vi.fn();
    render(<PhotoViewer name="Rower" urls={URLS} startIndex={0} onClose={onClose} />);

    fireEvent.click(viewerImage());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Zamknij galerię" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("hides the step buttons for a single photo and counts as an open sheet while mounted", () => {
    const { unmount } = render(<PhotoViewer name="Rower" urls={[URLS[0]]} startIndex={0} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Następne zdjęcie" })).toBeNull();
    expect(getOpenSheetCount()).toBe(1);
    unmount();
    expect(getOpenSheetCount()).toBe(0);
  });
});

describe("ItemGallery viewer", () => {
  function photo(url: string, index: number): ProductPhotoResponse {
    return { id: `p${index}`, url, thumb_url: url, status: "APPROVED", sort_order: index };
  }

  it("opens the viewer at the shown photo and returns focus to it on close", () => {
    render(<ItemGallery name="Rower" photos={URLS.map(photo)} productPhotoUrl={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Zdjęcie 3 z 3" }));
    const opener = screen.getByRole("button", { name: "Powiększ zdjęcie 3 z 3" });
    opener.focus();
    fireEvent.click(opener);

    expect(viewerImage()).toHaveAttribute("src", URLS[2]);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("offers no viewer when there is no photo", () => {
    render(<ItemGallery name="Rower" photos={[]} productPhotoUrl={null} />);
    expect(screen.queryByRole("button", { name: /Powiększ/ })).toBeNull();
  });
});
