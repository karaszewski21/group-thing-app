import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as eventsApi from "../api/events";
import type { EventDetailResponse } from "../api/events";
import { ApiError } from "../api/client";
import { EventPage } from "../pages/events/EventPage";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/events", () => ({
  getEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));
let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

const EVENT_ID = "ev-1";
const HAS_ATTENDEES = "Nie można usunąć wydarzenia, na które ktoś się zapisał.";

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: EVENT_ID,
    name: "Piknik w parku",
    description: "Kocyki i lemoniada",
    starts_at: "2026-11-02T14:00:00",
    ends_at: "2026-11-02T18:00:00",
    location: {
      id: "loc-1",
      name: "Park Skaryszewski",
      formatted_address: "al. Zieleniecka, Warszawa",
      google_place_id: null,
      notes: null,
      deleted_at: null,
    },
    created_at: "",
    updated_at: "",
    banner_url: "https://cdn.test/events/ev-1/b/w1600.webp",
    attendee_count: 0,
    is_author: false,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/events/${EVENT_ID}`]}>
      <Routes>
        <Route path="/events/:eventId" element={<EventPage />} />
        <Route path="/meetings" element={<p>Strona spotkań</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: null };
});

describe("EventPage", () => {
  it("shows the event to anyone, without the author's controls", async () => {
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
    renderPage();

    expect(await screen.findByRole("heading", { name: "Piknik w parku", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Baner wydarzenia Piknik w parku" })).toHaveAttribute(
      "src",
      "https://cdn.test/events/ev-1/b/w1600.webp",
    );
    expect(screen.getByText(/godz\. 14:00–18:00/)).toBeInTheDocument();
    expect(screen.getByText("Park Skaryszewski")).toBeInTheDocument();
    expect(screen.getByText("Kocyki i lemoniada")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edytuj/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuń/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Spotkania/ })).not.toBeInTheDocument();
  });

  it("an unknown event shows a not-found note", async () => {
    vi.mocked(eventsApi.getEvent).mockRejectedValue(
      new ApiError(404, "Not Found", { message: "Nie znaleziono wydarzenia." }),
    );
    renderPage();

    expect(await screen.findByText("Nie znaleziono wydarzenia.")).toBeInTheDocument();
  });

  it("the author edits from the page and deletes after confirming, landing on Spotkania", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ is_author: true }));
    vi.mocked(eventsApi.deleteEvent).mockResolvedValue(undefined);
    renderPage();

    expect(await screen.findByRole("link", { name: /Edytuj/ })).toHaveAttribute("href", `/events/${EVENT_ID}/edit`);
    fireEvent.click(screen.getByRole("button", { name: /Usuń/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Usunąć wydarzenie?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń wydarzenie" }));

    await waitFor(() => expect(eventsApi.deleteEvent).toHaveBeenCalledWith(EVENT_ID));
    expect(await screen.findByText("Strona spotkań")).toBeInTheDocument();
  });

  it("with someone signed up, delete is blocked with a hint and opens no dialog", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ is_author: true, attendee_count: 2 }));
    renderPage();

    const remove = await screen.findByRole("button", { name: /Usuń/ });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(remove).toHaveAccessibleDescription("Nie można usunąć — zapisało się już 2 osoby.");
    fireEvent.click(remove);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(eventsApi.deleteEvent).not.toHaveBeenCalled();
  });

  it("a rejected delete stays in the dialog with the server message", async () => {
    mockAuth = { token: "t" };
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ is_author: true }));
    vi.mocked(eventsApi.deleteEvent).mockRejectedValue(new ApiError(409, "Conflict", { message: HAS_ATTENDEES }));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Usuń/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Usunąć wydarzenie?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Usuń wydarzenie" }));

    expect(await within(dialog).findByText(HAS_ATTENDEES)).toBeInTheDocument();
  });
});
