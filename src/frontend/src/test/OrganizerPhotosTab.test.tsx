import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import type { MyOrganizationResponse, OwnerMedia } from "../api/organizations";
import { MY_ORGANIZATION_KEY } from "../hooks/useMyOrganization";
import { PhotosTab } from "../pages/organizer/editor/PhotosTab";
import { createTestQueryClient, withQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
  uploadOrganizationMedia: vi.fn(),
  deleteOrganizationMedia: vi.fn(),
  reorderOrganizationGallery: vi.fn(),
}));

function row(id: string, kind: OwnerMedia["kind"], status: OwnerMedia["status"], sortOrder = 0): OwnerMedia {
  return { id, kind, status, url: `https://cdn/${id}`, thumb_url: `https://cdn/${id}-t`, sort_order: sortOrder };
}

function organization(media: OwnerMedia[]): MyOrganizationResponse {
  return {
    id: "7",
    party_id: "11",
    name: "Muzyczne Skrzaty",
    slug: "muzyczne-skrzaty",
    primary_color: null,
    accent_color: null,
    page_layout: "CLASSIC",
    palette_preset: null,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-01T10:00:00Z",
    media,
  };
}

async function renderTab(media: OwnerMedia[]) {
  vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(organization(media));
  const client = createTestQueryClient();
  render(withQueryClient(<PhotosTab organizationId="7" />, client));
  await act(async () => {});
  return {
    /** Replaces the cached organization's media, as a re-read would. */
    updateMedia: (next: OwnerMedia[]) =>
      act(() => {
        vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(organization(next));
        client.setQueryData([MY_ORGANIZATION_KEY, "token-a"], organization(next));
      }),
  };
}

function section(name: string) {
  return within(screen.getByRole("region", { name }));
}

function pick(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

const JPEG = new File(["x"], "logo.jpg", { type: "image/jpeg" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PhotosTab", () => {
  it("shows the intro and a first pending logo with change and cancel", async () => {
    await renderTab([row("l1", "LOGO", "PENDING")]);

    expect(screen.getByText("Zdjęcia zapisują się od razu.")).toBeInTheDocument();
    const logo = section("Logo");
    expect(logo.getByText("W weryfikacji")).toBeInTheDocument();
    expect(logo.getByText("Odwiedzający zobaczą je po sprawdzeniu.")).toBeInTheDocument();
    expect(logo.getByLabelText("Zmień logo")).toBeInTheDocument();
    expect(logo.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("shows the approved logo above the pending replacement", async () => {
    await renderTab([row("l1", "LOGO", "APPROVED"), row("l2", "LOGO", "NEEDS_REVIEW")]);

    const logo = section("Logo");
    expect(logo.getByText("Na stronie teraz")).toBeInTheDocument();
    expect(logo.getByRole("button", { name: "Usuń ze strony" })).toBeInTheDocument();
    expect(logo.getByRole("separator")).toBeInTheDocument();
    expect(logo.getByText("Nowe")).toBeInTheDocument();
    expect(logo.getByText("Zastąpi obecne po sprawdzeniu.")).toBeInTheDocument();
    expect(logo.getByLabelText("Zmień")).toBeInTheDocument();
    expect(logo.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("lists every rejected logo newest first, each removable, with one add picker", async () => {
    vi.mocked(organizationsApi.deleteOrganizationMedia).mockResolvedValue(undefined);
    await renderTab([row("old", "LOGO", "REJECTED"), row("new", "LOGO", "REJECTED")]);

    const logo = section("Logo");
    expect(logo.getAllByText("Odrzucone")).toHaveLength(2);
    expect(logo.getAllByText("Odrzucone przez moderację — dodaj inne zdjęcie.")).toHaveLength(2);
    expect(logo.getAllByLabelText("Dodaj logo")).toHaveLength(1);
    const removes = logo.getAllByRole("button", { name: "Usuń" });
    expect(removes).toHaveLength(2);

    fireEvent.click(removes[0]);
    await waitFor(() => expect(organizationsApi.deleteOrganizationMedia).toHaveBeenCalledWith("7", "new"));
    await waitFor(() => expect(logo.getByLabelText("Dodaj logo")).toHaveFocus());
  });

  it("uses the cover copy for an approved cover and shows the uploading state while it is replaced", async () => {
    vi.mocked(organizationsApi.uploadOrganizationMedia).mockReturnValue(new Promise(() => {}));
    await renderTab([row("c1", "COVER", "APPROVED")]);

    const cover = section("Okładka");
    expect(cover.getByText("Na stronie")).toBeInTheDocument();
    expect(cover.getByRole("button", { name: "Usuń" })).toBeInTheDocument();
    pick(cover.getByLabelText("Zmień okładkę"), JPEG);

    expect(await cover.findByText("Wysyłanie…")).toBeInTheDocument();
    expect(cover.getByLabelText("Dodaj okładkę")).toBeDisabled();
    expect(organizationsApi.uploadOrganizationMedia).toHaveBeenCalledWith("7", "COVER", JPEG);
  });

  it("uploads a valid file with its kind and rejects an invalid one without a call", async () => {
    vi.mocked(organizationsApi.uploadOrganizationMedia).mockResolvedValue(row("c1", "COVER", "PENDING"));
    await renderTab([]);

    const logo = section("Logo");
    expect(logo.getByText("Brak logo — na stronie widać inicjały.")).toBeInTheDocument();
    expect(logo.getByText("MS")).toBeInTheDocument();
    pick(logo.getByLabelText("Dodaj logo"), new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(logo.getByRole("alert")).toHaveTextContent("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP");
    expect(organizationsApi.uploadOrganizationMedia).not.toHaveBeenCalled();

    pick(section("Okładka").getByLabelText("Dodaj okładkę"), JPEG);
    await waitFor(() => expect(organizationsApi.uploadOrganizationMedia).toHaveBeenCalledWith("7", "COVER", JPEG));
  });

  it("disables the gallery picker at 3/3 and keeps rejected photos out of the count and order", async () => {
    await renderTab([
      row("g1", "GALLERY", "APPROVED", 0),
      row("g2", "GALLERY", "PENDING", 1),
      row("g3", "GALLERY", "APPROVED", 2),
      row("gx", "GALLERY", "REJECTED", 3),
    ]);

    const gallery = section("Galeria");
    expect(gallery.getByText("3/3")).toBeInTheDocument();
    expect(gallery.getByLabelText("Dodaj zdjęcie")).toBeDisabled();
    expect(gallery.getByText("Osiągnięto limit 3 zdjęć.")).toBeInTheDocument();
    expect(gallery.getByRole("button", { name: "Przesuń zdjęcie 1 w górę" })).toBeDisabled();
    expect(gallery.getByRole("button", { name: "Przesuń zdjęcie 3 w dół" })).toBeDisabled();
    expect(gallery.getByRole("button", { name: "Usuń odrzucone zdjęcie" })).toBeInTheDocument();
    expect(gallery.queryByRole("button", { name: /Przesuń zdjęcie 4/ })).not.toBeInTheDocument();
  });

  it("moves a photo down with the full non-rejected order and keeps focus on it", async () => {
    const media = [row("g1", "GALLERY", "APPROVED", 0), row("g2", "GALLERY", "APPROVED", 1), row("gx", "GALLERY", "REJECTED", 2)];
    let finishReorder: (value: OwnerMedia[]) => void = () => {};
    vi.mocked(organizationsApi.reorderOrganizationGallery).mockReturnValue(
      new Promise((resolve) => {
        finishReorder = resolve;
      }),
    );
    const view = await renderTab(media);

    fireEvent.click(section("Galeria").getByRole("button", { name: "Przesuń zdjęcie 1 w dół" }));
    expect(organizationsApi.reorderOrganizationGallery).toHaveBeenCalledWith("7", ["g2", "g1"]);
    expect(screen.getByRole("region", { name: "Galeria" })).toHaveAttribute("aria-busy", "true");

    const moved = [{ ...media[1], sort_order: 0 }, { ...media[0], sort_order: 1 }, media[2]];
    view.updateMedia(moved);
    finishReorder([]);
    await waitFor(() =>
      expect(section("Galeria").getByRole("button", { name: "Przesuń zdjęcie 2 w górę" })).toHaveFocus(),
    );
  });

  it("shows a server conflict verbatim in the gallery's alert line", async () => {
    vi.mocked(organizationsApi.uploadOrganizationMedia).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, message: "To zdjęcie jest już w galerii." }),
    );
    await renderTab([]);

    const gallery = section("Galeria");
    pick(gallery.getByLabelText("Dodaj zdjęcie"), JPEG);
    expect(await gallery.findByRole("alert")).toHaveTextContent("To zdjęcie jest już w galerii.");
  });

  it("notes that the cover shows in every layout", async () => {
    await renderTab([]);

    expect(section("Okładka").getByText("Widoczna u góry strony w każdym układzie.")).toBeInTheDocument();
  });
});
