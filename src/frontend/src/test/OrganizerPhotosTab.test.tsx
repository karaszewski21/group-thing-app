import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as mediaApi from "../api/media";
import type { MediaOwner, OwnerMedia } from "../api/media";
import { PhotosTab } from "../features/editor/PhotosTab";
import { useMediaActions } from "../hooks/useMediaActions";
import { createQueryWrapper } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/media", () => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  reorderGallery: vi.fn(),
}));

const ORGANIZATION: MediaOwner = { kind: "organization", organizationId: "7" };

function row(id: string, kind: OwnerMedia["kind"], status: OwnerMedia["status"], sortOrder = 0): OwnerMedia {
  return { id, kind, status, url: `https://cdn/${id}`, thumb_url: `https://cdn/${id}-t`, sort_order: sortOrder };
}

/** The tab as an editor mounts it: the owner's media plus its real actions. */
function Harness({ media }: { media: OwnerMedia[] }) {
  const actions = useMediaActions(ORGANIZATION);
  return <PhotosTab media={media} actions={actions} initials="MS" />;
}

function renderTab(media: OwnerMedia[]) {
  const view = render(<Harness media={media} />, { wrapper: createQueryWrapper() });
  return {
    /** Re-renders with the media a re-read would return. */
    updateMedia: (next: OwnerMedia[]) => view.rerender(<Harness media={next} />),
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
  it("shows the avatar, banner, logo and gallery sections in that order", () => {
    renderTab([]);

    expect(screen.getByText("Zdjęcia zapisują się od razu.")).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(["Awatar", "Baner", "Logo", "Galeria"]);
    expect(section("Awatar").getByText("MS")).toBeInTheDocument();
    expect(section("Awatar").getByText("Brak awatara — na stronie widać inicjały.")).toBeInTheDocument();
    expect(section("Baner").getByText("Widoczny u góry strony.")).toBeInTheDocument();
    expect(section("Logo").getByText("Brak logo.")).toBeInTheDocument();
  });

  it("shows a first pending logo with change and cancel", () => {
    renderTab([row("l1", "LOGO", "PENDING")]);

    const logo = section("Logo");
    expect(logo.getByText("W weryfikacji")).toBeInTheDocument();
    expect(logo.getByText("Odwiedzający zobaczą je po sprawdzeniu.")).toBeInTheDocument();
    expect(logo.getByLabelText("Zmień logo")).toBeInTheDocument();
    expect(logo.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();
  });

  it("shows the approved avatar above the pending replacement", () => {
    renderTab([row("a1", "AVATAR", "APPROVED"), row("a2", "AVATAR", "NEEDS_REVIEW")]);

    const avatar = section("Awatar");
    expect(avatar.getByText("Na stronie teraz")).toBeInTheDocument();
    expect(avatar.getByRole("button", { name: "Usuń ze strony" })).toBeInTheDocument();
    expect(avatar.getByRole("separator")).toBeInTheDocument();
    expect(avatar.getByText("Nowe")).toBeInTheDocument();
    expect(avatar.getByText("Zastąpi obecne po sprawdzeniu.")).toBeInTheDocument();
    expect(avatar.getByLabelText("Zmień")).toBeInTheDocument();
  });

  it("lists every rejected logo newest first, each removable, with one add picker", async () => {
    vi.mocked(mediaApi.deleteMedia).mockResolvedValue(undefined);
    renderTab([row("old", "LOGO", "REJECTED"), row("new", "LOGO", "REJECTED")]);

    const logo = section("Logo");
    expect(logo.getAllByText("Odrzucone")).toHaveLength(2);
    expect(logo.getAllByText("Odrzucone przez moderację — dodaj inne zdjęcie.")).toHaveLength(2);
    expect(logo.getAllByLabelText("Dodaj logo")).toHaveLength(1);
    const removes = logo.getAllByRole("button", { name: "Usuń" });
    expect(removes).toHaveLength(2);

    fireEvent.click(removes[0]);
    await waitFor(() => expect(mediaApi.deleteMedia).toHaveBeenCalledWith(ORGANIZATION, "new"));
    await waitFor(() => expect(logo.getByLabelText("Dodaj logo")).toHaveFocus());
  });

  it("replaces an approved banner and shows the uploading state meanwhile", async () => {
    vi.mocked(mediaApi.uploadMedia).mockReturnValue(new Promise(() => {}));
    renderTab([row("c1", "COVER", "APPROVED")]);

    const cover = section("Baner");
    expect(cover.getByText("Na stronie")).toBeInTheDocument();
    pick(cover.getByLabelText("Zmień baner"), JPEG);

    expect(await cover.findByText("Wysyłanie…")).toBeInTheDocument();
    expect(cover.getByLabelText("Dodaj baner")).toBeDisabled();
    expect(mediaApi.uploadMedia).toHaveBeenCalledWith(ORGANIZATION, "COVER", JPEG);
  });

  it("uploads a valid file with its kind and rejects an invalid one without a call", async () => {
    vi.mocked(mediaApi.uploadMedia).mockResolvedValue(row("a1", "AVATAR", "PENDING"));
    renderTab([]);

    const logo = section("Logo");
    pick(logo.getByLabelText("Dodaj logo"), new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(logo.getByRole("alert")).toHaveTextContent("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP");
    expect(mediaApi.uploadMedia).not.toHaveBeenCalled();

    pick(section("Awatar").getByLabelText("Dodaj awatar"), JPEG);
    await waitFor(() => expect(mediaApi.uploadMedia).toHaveBeenCalledWith(ORGANIZATION, "AVATAR", JPEG));
  });

  it("disables the gallery picker at 3/3 and keeps rejected photos out of the count and order", () => {
    renderTab([
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
    vi.mocked(mediaApi.reorderGallery).mockReturnValue(
      new Promise((resolve) => {
        finishReorder = resolve;
      }),
    );
    const view = renderTab(media);

    fireEvent.click(section("Galeria").getByRole("button", { name: "Przesuń zdjęcie 1 w dół" }));
    expect(mediaApi.reorderGallery).toHaveBeenCalledWith(ORGANIZATION, ["g2", "g1"]);
    expect(screen.getByRole("region", { name: "Galeria" })).toHaveAttribute("aria-busy", "true");

    view.updateMedia([{ ...media[1], sort_order: 0 }, { ...media[0], sort_order: 1 }, media[2]]);
    finishReorder([]);
    await waitFor(() =>
      expect(section("Galeria").getByRole("button", { name: "Przesuń zdjęcie 2 w górę" })).toHaveFocus(),
    );
  });

  it("shows a server conflict verbatim in the gallery's alert line", async () => {
    vi.mocked(mediaApi.uploadMedia).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, message: "To zdjęcie jest już w galerii." }),
    );
    renderTab([]);

    const gallery = section("Galeria");
    pick(gallery.getByLabelText("Dodaj zdjęcie"), JPEG);
    expect(await gallery.findByRole("alert")).toHaveTextContent("To zdjęcie jest już w galerii.");
  });
});
