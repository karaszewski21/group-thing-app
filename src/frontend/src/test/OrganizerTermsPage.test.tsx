import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import type { OrganizerCircle, OrganizerPageResponse, OrganizerTerm } from "../api/groups";
import * as organizationsApi from "../api/organizations";
import type { Page } from "../api/pagination";
import { OrganizerTermsPage } from "../pages/organizer/OrganizerTermsPage";
import { createQueryWrapper } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: null }) }));

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
}));

vi.mock("../api/groups", () => ({
  getOrganizerPage: vi.fn(),
  getOrganizerTerms: vi.fn(),
}));

const SLUG = "akademia-orlik";

const ORGANIZATION = {
  slug: SLUG,
  name: "Akademia Orlik",
  primary_color: "#7a1f3d",
  accent_color: "#d4a017",
  page_layout: "SCHEDULE",
  palette_preset: null,
};

function term(id: string, occursOn: string, overrides: Partial<OrganizerTerm> = {}): OrganizerTerm {
  return {
    term_id: id,
    group_id: "g1",
    group_name: "Orliki 2017",
    occurs_on: occursOn,
    description: null,
    attendee_count: 12,
    ...overrides,
  };
}

function circle(id: string, name: string): OrganizerCircle {
  return {
    id,
    name,
    layout_mode: "CIRCLE",
    next_term: null,
    upcoming_term_count: 0,
  };
}

function directory(circles: OrganizerCircle[]): OrganizerPageResponse {
  return {
    circles,
    upcoming_terms: [],
    exchange: { counts: { GIFT: 0, SWAP: 0, LEND: 0 }, items: [] },
    needed_items: [],
    stats: {
      circle_count: circles.length,
      upcoming_term_count: 0,
      family_count: null,
    },
  };
}

function termsPage(items: OrganizerTerm[], page: number, total: number): Page<OrganizerTerm> {
  return { items, total, page, size: 20 };
}

const TWO_CIRCLES = [circle("g1", "Orliki 2017"), circle("g2", "Młodziki 2015")];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/:organizationSlug/terminy",
        element: (
          <>
            <OrganizerTermsPage />
            <LocationProbe />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />, {
    wrapper: createQueryWrapper(),
  });
}

function location(): string {
  return screen.getByTestId("location").textContent ?? "";
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
  vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(directory(TWO_CIRCLES));
});

describe("OrganizerTermsPage", () => {
  it("renders the back link, heading, count and day-grouped terms in the organizer theme", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(
      termsPage(
        [
          term("t1", "2026-10-14T17:00:00"),
          term("t2", "2026-10-14T18:15:00", {
            group_id: "g2",
            group_name: "Młodziki 2015",
          }),
          term("t3", "2026-10-16T17:00:00"),
        ],
        1,
        3,
      ),
    );

    renderAt(`/${SLUG}/terminy`);

    expect(await screen.findByRole("link", { name: "Akademia Orlik" })).toHaveAttribute("href", `/${SLUG}`);
    const heading = screen.getByRole("heading", { level: 1, name: "Wszystkie terminy" });
    expect(heading.closest("[data-organizer-theme]")).toHaveAttribute("data-organizer-theme", "custom");
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "środa, 14 października",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "piątek, 16 października",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 zaplanowane")).toBeInTheDocument();
    expect(screen.getByText("Strona utworzona w domena.pl")).toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenCalledWith(SLUG, 1, undefined);
  });

  it("refetches with group_id when a chip is selected and records it in the URL", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));

    renderAt(`/${SLUG}/terminy`);

    const group = await screen.findByRole("radiogroup");
    fireEvent.click(within(group).getByRole("radio", { name: "Młodziki 2015" }));

    await waitFor(() => expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 1, "g2"));
    expect(location()).toBe(`/${SLUG}/terminy?group_id=g2`);
    expect(within(group).getByRole("radio", { name: "Młodziki 2015" })).toHaveAttribute("aria-checked", "true");
  });

  it("honors a known group_id only after the directory resolves and drops an unknown one", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));
    let resolveDirectory: (value: OrganizerPageResponse) => void = () => {};
    vi.mocked(groupsApi.getOrganizerPage).mockReturnValue(
      new Promise((resolve) => {
        resolveDirectory = resolve;
      }),
    );

    const { unmount } = renderAt(`/${SLUG}/terminy?group_id=g2`);

    await screen.findByRole("link", { name: "Akademia Orlik" });
    expect(groupsApi.getOrganizerTerms).not.toHaveBeenCalled();
    resolveDirectory(directory(TWO_CIRCLES));
    await waitFor(() => expect(groupsApi.getOrganizerTerms).toHaveBeenCalledWith(SLUG, 1, "g2"));
    expect(screen.getByRole("radio", { name: "Młodziki 2015" })).toHaveAttribute("aria-checked", "true");
    expect(location()).toBe(`/${SLUG}/terminy?group_id=g2`);
    unmount();

    vi.mocked(groupsApi.getOrganizerTerms).mockClear();
    vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(directory(TWO_CIRCLES));
    renderAt(`/${SLUG}/terminy?group_id=not-a-circle`);

    await waitFor(() => expect(location()).toBe(`/${SLUG}/terminy`));
    expect(await screen.findByRole("radio", { name: "Wszystkie" })).toHaveAttribute("aria-checked", "true");
    expect(groupsApi.getOrganizerTerms).toHaveBeenCalledWith(SLUG, 1, undefined);
    expect(groupsApi.getOrganizerTerms).not.toHaveBeenCalledWith(SLUG, 1, "not-a-circle");
  });

  it("keeps group_id in the URL when the directory fails to load", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockRejectedValue(new ApiError(503, "Service Unavailable", null));
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));

    renderAt(`/${SLUG}/terminy?group_id=g2`);

    expect(await screen.findByRole("heading", { level: 2, name: "środa, 14 października" })).toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenCalledWith(SLUG, 1, undefined);
    expect(groupsApi.getOrganizerTerms).not.toHaveBeenCalledWith(SLUG, 1, "g2");
    expect(location()).toBe(`/${SLUG}/terminy?group_id=g2`);
  });

  it("loads the next page on demand, announces the new terms and hides the button at the end", async () => {
    let resolveSecond: (value: Page<OrganizerTerm>) => void = () => {};
    vi.mocked(groupsApi.getOrganizerTerms).mockImplementation((_slug, page) =>
      page === 1
        ? Promise.resolve(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 21))
        : new Promise((resolve) => {
            resolveSecond = resolve;
          }),
    );

    renderAt(`/${SLUG}/terminy`);

    fireEvent.click(await screen.findByRole("button", { name: "Pokaż więcej" }));

    expect(await screen.findByRole("button", { name: "Wczytywanie…" })).toBeDisabled();
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 2, undefined);
    resolveSecond(termsPage([term("t2", "2026-10-18T10:00:00"), term("t3", "2026-10-19T10:00:00")], 2, 21));

    expect(await screen.findByText("Wczytano 2 kolejne terminy")).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "niedziela, 18 października",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pokaż więcej" })).not.toBeInTheDocument();
  });

  it("shows the empty state and resets an active chip with 'Pokaż wszystkie grupy'", async () => {
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([], 1, 0));

    renderAt(`/${SLUG}/terminy?group_id=g1`);

    expect(await screen.findByText("Brak zaplanowanych zajęć")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pokaż wszystkie grupy" }));

    await waitFor(() => expect(location()).toBe(`/${SLUG}/terminy`));
    expect(await screen.findByText("Brak zaplanowanych zajęć")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pokaż wszystkie grupy" })).not.toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenLastCalledWith(SLUG, 1, undefined);
  });

  it("renders the not-found frame for an organization 404 or a terms 404", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    vi.mocked(groupsApi.getOrganizerTerms).mockResolvedValue(termsPage([], 1, 0));

    const { unmount } = renderAt(`/brak/terminy`);
    expect(await screen.findByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument();
    unmount();

    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);
    vi.mocked(groupsApi.getOrganizerTerms).mockRejectedValue(new ApiError(404, "Not Found", null));
    renderAt(`/${SLUG}/terminy`);
    expect(await screen.findByRole("heading", { name: "Nie znaleziono strony" })).toBeInTheDocument();
  });

  it("shows a first-page error and refetches on 'Spróbuj ponownie'", async () => {
    vi.mocked(groupsApi.getOrganizerTerms)
      .mockRejectedValueOnce(new ApiError(503, "Service Unavailable", null))
      .mockResolvedValue(termsPage([term("t1", "2026-10-14T17:00:00")], 1, 1));

    renderAt(`/${SLUG}/terminy`);

    expect(await screen.findByText("Nie udało się wczytać terminów.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Wszystkie terminy" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "środa, 14 października",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Nie udało się wczytać terminów.")).not.toBeInTheDocument();
    expect(groupsApi.getOrganizerTerms).toHaveBeenCalledTimes(2);
  });
});
