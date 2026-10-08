import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicOrganizationResponse } from "../api/organizations";
import { LayoutRenderer } from "../pages/organizer/LayoutRenderer";
import { FALLBACK_LAYOUT, LAYOUT_REGISTRY, resolveLayout } from "../pages/organizer/layouts/registry";
import type { OrganizerPageData } from "../pages/organizer/layouts/types";

const organization: PublicOrganizationResponse = {
  slug: "rodzinny-grajdolek",
  name: "Rodzinny Grajdołek",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
};
const data: OrganizerPageData = { organization };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LayoutRenderer", () => {
  it("renders CLASSIC for a visitor with hero, share and footer but no ghost", () => {
    render(<LayoutRenderer layout={resolveLayout("CLASSIC")} data={data} mode="visitor" />);

    expect(screen.getByRole("heading", { level: 1, name: "Rodzinny Grajdołek" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Udostępnij" })).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();
    expect(screen.queryByText("Opis — wkrótce")).not.toBeInTheDocument();
  });

  it("renders a non-interactive ghost for the owner", () => {
    render(<LayoutRenderer layout={resolveLayout("CLASSIC")} data={data} mode="owner-edit" />);

    const title = screen.getByText("Opis — wkrótce");
    expect(screen.getByText("Tu pojawi się opis Twojej organizacji. Widzisz to tylko Ty.")).toBeInTheDocument();
    const ghost = title.closest("[data-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost).not.toHaveAttribute("tabindex");
    expect(ghost).not.toHaveAttribute("role");
    expect(ghost!.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("renders LINKS with the full-width share button in the centered frame", () => {
    const { container } = render(<LayoutRenderer layout={resolveLayout("LINKS")} data={data} mode="visitor" />);

    expect(screen.getByRole("button", { name: "Udostępnij stronę" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("data-frame", "centered");
    expect(container.firstElementChild).toHaveClass("flex-1", "justify-center");
  });

  it("falls back to CLASSIC for unknown or missing keys", () => {
    expect(resolveLayout("custom:x").key).toBe("CLASSIC");
    expect(resolveLayout(undefined).key).toBe("CLASSIC");
    expect(resolveLayout(null).key).toBe(FALLBACK_LAYOUT);
    expect(resolveLayout("LINKS").key).toBe("LINKS");
  });

  it("keeps the registry invariant: unique keys and exactly one primary slot per layout", () => {
    const layouts = Object.entries(LAYOUT_REGISTRY);
    expect(layouts.map(([key]) => key)).toEqual(["CLASSIC", "LINKS"]);
    for (const [key, layout] of layouts) {
      expect(layout.key).toBe(key);
      expect(layout.blocks.filter((slot) => slot.primary)).toHaveLength(1);
    }
    expect(layouts.filter(([, layout]) => layout.recommended).map(([key]) => key)).toEqual(["LINKS"]);
  });

  it("copies origin/slug without the edit param when navigator.share is missing", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    window.history.pushState({}, "", "/rodzinny-grajdolek?edit=1");

    render(<LayoutRenderer layout={resolveLayout("CLASSIC")} data={data} mode="owner-edit" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Udostępnij" }));
    });

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/rodzinny-grajdolek`);
    expect(screen.getByRole("status")).toHaveTextContent("Skopiowano link");
    window.history.pushState({}, "", "/");
  });
});
