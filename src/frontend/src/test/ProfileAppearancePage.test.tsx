import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as mediaApi from "../api/media";
import * as peopleApi from "../api/people";
import type { UserProfileResponse } from "../api/people";
import { LAYOUT_REGISTRY } from "../features/organization-public/layouts/registry";
import { findPreset } from "../theme/palettes";
import { appearanceRouteElement } from "./itemRoute";
import { createQueryWrapper } from "./queryClient";
import { getTestLocation, renderWithRoute } from "./renderWithRoute";

let mockAuth: { token: string | null; username: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  updateMyProfileAppearance: vi.fn(),
}));

vi.mock("../api/media", () => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  reorderGallery: vi.fn(),
}));

const PARTY_ID = "0b6f3c1e-9a7d-4c2e-8f1a-2d3e4f5a6b7c";
const OTHER_PARTY_ID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const EDITOR = `/${PARTY_ID}/appearance`;
const ORGANIZATION_LAYOUTS = Object.values(LAYOUT_REGISTRY).map((layout) => layout.label);

const PROFILE: UserProfileResponse = {
  id: "profile-1",
  party_id: PARTY_ID,
  account_user_id: "user-1",
  display_name: "Ania Kowalska",
  email: "ania@example.com",
  bio: "Oddaję ubranka po córce.",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  is_organizer: false,
  page_layout: "BANNER",
  palette_preset: null,
  primary_color: null,
  accent_color: null,
  media: [],
};

async function renderAt(path: string) {
  return renderWithRoute(await appearanceRouteElement(path), {
    url: path,
    pattern: "/:slug/appearance",
    routes: { "/organization": <p>Załóż organizację</p>, "/login": <p>Logowanie</p> },
    wrapper: createQueryWrapper(),
  });
}

function layouts() {
  return within(screen.getByRole("radiogroup", { name: "Układ strony" }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a", username: "ania@example.com" };
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue(PROFILE);
  vi.mocked(peopleApi.updateMyProfileAppearance).mockResolvedValue(PROFILE);
  vi.mocked(peopleApi.updateMyProfile).mockResolvedValue(PROFILE);
});

describe("ProfileAppearancePage", () => {
  it("offers the profile's own layout and every Organization layout locked, with the way to unlock them", async () => {
    await renderAt(`${EDITOR}?tab=layout`);
    await screen.findByRole("radiogroup", { name: "Układ strony" });

    expect(layouts().getByRole("radio", { name: "Baner" })).toHaveAttribute("aria-checked", "true");
    expect(layouts().getByRole("radio", { name: "Baner" })).not.toHaveAttribute("aria-disabled");
    for (const label of ORGANIZATION_LAYOUTS) {
      const card = layouts().getByRole("radio", { name: label });
      expect(card).toHaveAttribute("aria-disabled", "true");
      expect(card).toHaveAttribute("aria-checked", "false");
    }
    expect(layouts().getAllByText("Dla organizacji")).toHaveLength(ORGANIZATION_LAYOUTS.length);
    expect(screen.getByText("Więcej układów masz na stronie organizacji.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Załóż organizację →" })).toHaveAttribute("href", "/organization");
    expect(screen.getByRole("link", { name: "Zobacz stronę →" })).toHaveAttribute("href", `/${PARTY_ID}`);
  });

  it("does not select a locked layout when clicked", async () => {
    await renderAt(`${EDITOR}?tab=layout`);
    await screen.findByRole("radiogroup", { name: "Układ strony" });
    const locked = layouts().getByRole("radio", { name: ORGANIZATION_LAYOUTS[0] });

    fireEvent.click(locked);

    expect(locked).toHaveAttribute("aria-checked", "false");
    expect(layouts().getByRole("radio", { name: "Baner" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });

  it("is not found on someone else's profile", async () => {
    await renderAt(`/${OTHER_PARTY_ID}/appearance`);

    expect(await screen.findByText("Tej strony nie możesz edytować.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("sends a visitor without a session to log in", async () => {
    mockAuth = { token: null, username: null };
    await renderAt(EDITOR);

    expect(await screen.findByText("Logowanie")).toBeInTheDocument();
    expect(new URLSearchParams(getTestLocation().search).get("returnTo")).toBe(EDITOR);
    expect(peopleApi.getMyProfile).not.toHaveBeenCalled();
  });

  it("saves a chosen palette as an appearance change with only the color fields", async () => {
    const ocean = findPreset("OCEAN")!;
    await renderAt(`${EDITOR}?tab=layout`);
    const palettes = within(await screen.findByRole("radiogroup", { name: "Paleta kolorów" }));

    fireEvent.click(palettes.getByRole("radio", { name: "Ocean" }));
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
    expect(peopleApi.updateMyProfileAppearance).toHaveBeenCalledTimes(1);
    expect(peopleApi.updateMyProfileAppearance).toHaveBeenCalledWith({
      palette_preset: "OCEAN",
      primary_color: ocean.vars["--color-primary"],
      accent_color: ocean.vars["--color-accent"],
    });
    expect(peopleApi.updateMyProfile).not.toHaveBeenCalled();
  });

  it("saves a new name with the current bio through the profile details", async () => {
    await renderAt(`${EDITOR}?tab=name`);
    const name = await screen.findByRole("textbox", { name: "Imię i nazwisko" });
    expect(name).toHaveValue("Ania Kowalska");

    fireEvent.change(name, { target: { value: " Ania Nowak " } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
    expect(peopleApi.updateMyProfile).toHaveBeenCalledWith({
      display_name: "Ania Nowak",
      bio: "Oddaję ubranka po córce.",
    });
    expect(peopleApi.updateMyProfileAppearance).not.toHaveBeenCalled();
  });

  it("saves a changed bio as an appearance change and a rename with the new bio", async () => {
    await renderAt(EDITOR);
    fireEvent.change(await screen.findByRole("textbox", { name: "O mnie" }), { target: { value: "  Szukam rowerka. " } });
    fireEvent.click(screen.getByRole("tab", { name: "Nazwa" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Imię i nazwisko" }), { target: { value: "Ania Nowak" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Zapisano");
    expect(peopleApi.updateMyProfileAppearance).toHaveBeenCalledWith({ bio: "Szukam rowerka." });
    expect(peopleApi.updateMyProfile).toHaveBeenCalledWith({ display_name: "Ania Nowak", bio: "Szukam rowerka." });
  });

  it("uploads the avatar to the caller's own media", async () => {
    vi.mocked(mediaApi.uploadMedia).mockResolvedValue({
      id: "m-1",
      kind: "AVATAR",
      status: "PENDING",
      url: "https://cdn/m-1",
      thumb_url: "https://cdn/m-1-t",
      sort_order: 0,
    });
    const file = new File(["x"], "me.jpg", { type: "image/jpeg" });
    await renderAt(EDITOR);
    const avatar = within(await screen.findByRole("region", { name: "Awatar" }));
    expect(avatar.getByText("AK")).toBeInTheDocument();

    fireEvent.change(avatar.getByLabelText("Dodaj awatar"), { target: { files: [file] } });

    await vi.waitFor(() => expect(mediaApi.uploadMedia).toHaveBeenCalledWith({ kind: "me" }, "AVATAR", file));
    expect(screen.getByRole("button", { name: "Zapisz" })).toBeDisabled();
  });
});
