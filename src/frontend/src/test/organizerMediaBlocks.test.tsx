import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as groupsApi from "../api/groups";
import type { PublicMedia, PublicOrganizationResponse } from "../api/organizations";
import { GalleryBlock } from "../pages/organizer/blocks/GalleryBlock";
import { HeroBlock } from "../pages/organizer/blocks/HeroBlock";
import { LayoutRenderer } from "../pages/organizer/LayoutRenderer";
import { LAYOUT_REGISTRY, resolveLayout } from "../pages/organizer/layouts/registry";
import type { OrganizerPageData, RenderMode } from "../pages/organizer/layouts/types";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/groups")>()),
  getOrganizerTerms: vi.fn(),
}));

const SLUG = "rodzinny-grajdolek";
const NAME = "Rodzinny Grajdołek";

function media(n: number): PublicMedia {
  return { url: `https://cdn.test/org/${n}.webp`, thumb_url: `https://cdn.test/org/${n}-thumb.webp` };
}

function pageData(overrides: Partial<PublicOrganizationResponse> = {}): OrganizerPageData {
  return {
    organization: {
      slug: SLUG,
      name: NAME,
      primary_color: null,
      accent_color: null,
      page_layout: "CLASSIC",
      // SUN resolves `on-primary` to ink: the cover text must not depend on it.
      palette_preset: "SUN",
      description: null,
      logo: null,
      cover: null,
      gallery: [],
      ...overrides,
    },
    directory: {
      circles: [],
      upcoming_terms: [],
      exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 0 }, items: [] },
      needed_items: [],
      stats: { circle_count: 0, upcoming_term_count: 0, family_count: null },
    },
    directoryStatus: "ready",
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return <output data-testid="location">{`${navigationType} ${location.pathname}${location.search}`}</output>;
}

function renderLayout(key: string, data: OrganizerPageData, mode: RenderMode = "visitor") {
  return render(
    <MemoryRouter initialEntries={[`/${SLUG}`]}>
      <Routes>
        <Route
          path="/:slug"
          element={
            <>
              <LayoutRenderer layout={resolveLayout(key)} data={data} mode={mode} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(groupsApi.getOrganizerTerms).mockReturnValue(new Promise(() => {}));
});

afterEach(cleanup);

describe("HeroBlock media", () => {
  it.each([
    ["cover", "h-20"],
    ["compact", "h-14"],
    ["centered", "h-24"],
  ])("shows the logo thumb in the %s variant and falls back to initials on error", (variant, size) => {
    const { container } = render(
      <MemoryRouter>
        <HeroBlock data={pageData({ logo: media(1) })} variant={variant} mode="visitor" />
      </MemoryRouter>,
    );

    const logo = container.querySelector(`img[src="${media(1).thumb_url}"]`) as HTMLImageElement;
    expect(logo).not.toBeNull();
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveClass(size, "rounded-full", "object-cover");
    expect(screen.queryByText("RG")).not.toBeInTheDocument();

    fireEvent.error(logo);
    expect(container.querySelector(`img[src="${media(1).thumb_url}"]`)).toBeNull();
    expect(screen.getByText("RG")).toBeInTheDocument();
  });

  it("renders the cover image in every hero variant", () => {
    for (const [variant, placement] of [
      ["cover", "absolute"],
      ["centered", "absolute"],
      ["compact", "h-30"],
    ]) {
      const { container } = render(
        <MemoryRouter>
          <HeroBlock data={pageData({ cover: media(2) })} variant={variant} mode="visitor" />
        </MemoryRouter>,
      );
      const cover = container.querySelector(`img[src="${media(2).url}"]`);
      expect(cover, variant).toHaveAttribute("alt", "");
      expect(cover, variant).toHaveClass(placement, "object-cover");
      cleanup();
    }
  });

  it("drops the compact cover strip when the cover fails, keeping the top bar", () => {
    const { container } = render(
      <MemoryRouter>
        <HeroBlock data={pageData({ cover: media(2) })} variant="compact" mode="visitor" />
      </MemoryRouter>,
    );

    fireEvent.error(container.querySelector(`img[src="${media(2).url}"]`)!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: NAME })).toHaveClass("text-ink");
  });

  it("puts the centered hero over the cover in the fixed light token, and in on-primary after it fails", () => {
    const { container } = render(
      <MemoryRouter>
        <HeroBlock data={pageData({ cover: media(2) })} variant="centered" mode="visitor" />
      </MemoryRouter>,
    );
    const name = screen.getByRole("heading", { level: 1, name: NAME });
    const address = screen.getByText(`domena.pl/${SLUG}`);
    for (const text of [name, address]) expect(text).toHaveClass("text-on-ink");
    expect(screen.getByText("RG")).toHaveClass("border-on-ink");
    expect(container.querySelector(".via-scrim-strong")).not.toBeNull();

    fireEvent.error(container.querySelector(`img[src="${media(2).url}"]`)!);
    expect(container.querySelector("img")).toBeNull();
    for (const text of [name, address]) expect(text).toHaveClass("text-on-primary");
    expect(screen.getByText("RG")).toHaveClass("border-on-primary");
    expect(container.querySelector(".via-scrim-strong")).toBeNull();
  });

  it("keeps the name, address and logo ring in the fixed light token over a cover, and on-primary after it fails", () => {
    const { container } = render(
      <MemoryRouter>
        <HeroBlock data={pageData({ cover: media(2) })} variant="cover" mode="visitor" />
      </MemoryRouter>,
    );
    const name = screen.getByRole("heading", { level: 1, name: NAME });
    const address = screen.getByText(`domena.pl/${SLUG}`);
    const ring = screen.getByText("RG");
    for (const text of [name, address]) {
      expect(text).toHaveClass("text-on-ink");
      expect(text).not.toHaveClass("text-on-primary");
    }
    expect(ring).toHaveClass("border-on-ink");
    expect(ring).not.toHaveClass("border-on-primary");
    expect(container.querySelector(".to-scrim-strong")).not.toBeNull();

    fireEvent.error(container.querySelector(`img[src="${media(2).url}"]`)!);
    expect(container.querySelector("img")).toBeNull();
    for (const text of [name, address]) {
      expect(text).toHaveClass("text-on-primary");
      expect(text).not.toHaveClass("text-on-ink");
    }
    expect(screen.getByText("RG")).toHaveClass("border-on-primary");
    expect(container.querySelector(".to-scrim-strong")).toBeNull();
  });
});

describe("GalleryBlock", () => {
  it.each([
    [3, "grid-cols-3", "aspect-square", "thumb_url"],
    [2, "grid-cols-2", "aspect-square", "thumb_url"],
    [1, "grid-cols-1", "aspect-[4/3]", "url"],
  ] as const)("lays out %i photo(s) as %s", (count, columns, aspect, rendition) => {
    const gallery = Array.from({ length: count }, (_, i) => media(i + 1));
    render(<GalleryBlock data={pageData({ gallery })} variant="grid" mode="visitor" />);

    const section = screen.getByRole("region", { name: "Galeria" });
    expect(within(section).getByRole("heading", { name: "Galeria" })).toHaveClass("font-serif");
    expect(within(section).getByRole("list")).toHaveClass(columns);
    const images = within(section).getAllByRole("img");
    expect(images.map((img) => img.getAttribute("alt"))).toEqual(
      gallery.map((_, i) => `${NAME} — zdjęcie ${i + 1} z ${count}`),
    );
    expect(images.map((img) => img.getAttribute("src"))).toEqual(gallery.map((photo) => photo[rendition]));
    for (const img of images) expect(img).toHaveClass(aspect);
    expect(within(section).queryByRole("link")).toBeNull();
    expect(within(section).queryByRole("button")).toBeNull();
  });
});

describe("LayoutRenderer gallery slot", () => {
  it("places the gallery directly after about in all five layouts", () => {
    for (const layout of Object.values(LAYOUT_REGISTRY)) {
      const blocks = layout.blocks.map((slot) => slot.block);
      const about = blocks.indexOf("about");
      expect(about, layout.key).toBeGreaterThan(-1);
      // LINKS draws its gallery heading on the primary-colored page.
      const variant = layout.key === "LINKS" ? "on-primary" : "grid";
      expect(layout.blocks[about + 1], layout.key).toEqual({ block: "gallery", variant });
    }
  });

  it("hides an empty gallery from visitors and renders a non-empty one", () => {
    renderLayout("CLASSIC", pageData());
    expect(screen.queryByRole("region", { name: "Galeria" })).not.toBeInTheDocument();
    expect(screen.queryByText("Galeria")).not.toBeInTheDocument();
    cleanup();

    renderLayout("CLASSIC", pageData({ gallery: [media(1), media(2)] }));
    expect(screen.getByRole("region", { name: "Galeria" })).toBeInTheDocument();
  });

  it("shows the owner the gallery ghost while the directory still loads, with a replacing CTA to the photos tab", () => {
    const data: OrganizerPageData = { ...pageData(), directory: null, directoryStatus: "loading" };
    const { container } = renderLayout("CLASSIC", data, "owner-edit");

    const ghost = container.querySelector('[data-ghost="gallery"]') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(within(ghost).getByText("Galeria")).toBeInTheDocument();
    expect(
      within(ghost).getByText("Dodaj do 3 zdjęć — odwiedzający zobaczą je po sprawdzeniu. Widzisz to tylko Ty."),
    ).toBeInTheDocument();
    const cta = within(ghost).getByRole("link", { name: "Dodaj zdjęcia →" });
    expect(cta).toHaveAttribute("href", `/${SLUG}?edit=1&tab=zdjecia`);

    fireEvent.click(cta);
    expect(screen.getByTestId("location")).toHaveTextContent(`REPLACE /${SLUG}?edit=1&tab=zdjecia`);
  });
});
