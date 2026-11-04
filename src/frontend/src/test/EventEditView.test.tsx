import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as eventsApi from "../api/events";
import * as locationsApi from "../api/locations";
import type { EventDetailResponse, EventResponse } from "../api/events";
import { EventEditView } from "../features/events/EventEditView";
import { EventForm } from "../features/events/EventForm";
import { EMPTY_EVENT_DRAFT } from "../features/events/eventDraft";
import { makeLocationRef, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { getTestRouter, renderWithRoute } from "./renderWithRoute";

/** A stand-in for the panel's AppDataContext: `eventEdit` lives outside the
 * page. A clear renders at once, before the page's leave navigation lands —
 * as in the browser — so a page that re-seeds a cleared draft while still
 * mounted is caught. */
const panel = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  return {
    reset(initial: Record<string, unknown>) {
      state = initial;
    },
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(key: string, next: unknown) {
      state = { ...state, [key]: next };
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../features/panel/appDataStore", async () => {
  const { useSyncExternalStore } = await import("react");
  const { flushSync } = await import("react-dom");
  const setEventEdit = (next: unknown) => {
    if (next === null) flushSync(() => panel.set("eventEdit", next));
    else panel.set("eventEdit", next);
  };
  return {
    useAppData: () => ({ ...useSyncExternalStore(panel.subscribe, panel.get), setEventEdit }),
  };
});

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/events", () => ({ getEvent: vi.fn(), updateEvent: vi.fn() }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

const EVENT_ID = "ev-1";
const EDIT_URL = `/events/${EVENT_ID}/edit`;
const LOCATION = makeLocationResponse();

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: EVENT_ID,
    name: "Piknik w parku",
    description: "Kocyki i lemoniada",
    starts_at: "2027-05-10T14:00:00",
    ends_at: "2027-05-10T18:00:00",
    location: makeLocationRef(),
    created_at: "",
    updated_at: "",
    author_slug: "zielony-krag",
    banner_url: null,
    attendee_count: 0,
    is_author: true,
    author_display_name: "Fundacja Zielony Krąg",
    organization: null,
    participants: [],
    is_attending: false,
    has_ended: false,
    open_reservations: null,
    ...overrides,
  };
}

function saved(name: string): EventResponse {
  const { id, description, starts_at, ends_at, location, created_at, updated_at, author_slug } = event();
  return { id, name, description, starts_at, ends_at, location, created_at, updated_at, author_slug };
}

function renderEditPage() {
  return renderWithRoute(<EventEditView />, {
    url: EDIT_URL,
    pattern: "/events/:eventId/edit",
    routes: { "/:slug/event/:eventId": <p>Strona wydarzenia</p> },
    wrapper: createQueryWrapper(),
  });
}

async function nameInput() {
  return screen.findByLabelText("Nazwa");
}

beforeEach(() => {
  vi.resetAllMocks();
  panel.reset({ eventEdit: null });
  vi.mocked(eventsApi.getEvent).mockResolvedValue(event());
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([LOCATION]);
});

describe("EventEditView", () => {
  it("saving clears the kept draft for good and goes to the event page", async () => {
    vi.mocked(eventsApi.updateEvent).mockResolvedValue(saved("Piknik jesienny"));
    renderEditPage();
    fireEvent.change(await nameInput(), { target: { value: "Piknik jesienny" } });
    expect(panel.get().eventEdit).toMatchObject({ eventId: EVENT_ID, draft: { name: "Piknik jesienny" } });

    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));

    expect(await screen.findByText("Strona wydarzenia")).toBeInTheDocument();
    expect(eventsApi.updateEvent).toHaveBeenCalledWith(EVENT_ID, expect.objectContaining({ name: "Piknik jesienny" }));
    expect(panel.get().eventEdit).toBeNull();
    expect(getTestRouter().calls.at(-1)).toMatchObject({ method: "push", url: `/zielony-krag/event/${EVENT_ID}` });
  });

  it("a visit after saving seeds a fresh draft from the saved event, once", async () => {
    vi.mocked(eventsApi.updateEvent).mockImplementation(async () => {
      vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ name: "Piknik jesienny" }));
      return saved("Piknik jesienny");
    });
    renderEditPage();
    fireEvent.change(await nameInput(), { target: { value: "Piknik jesienny" } });
    fireEvent.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    await screen.findByText("Strona wydarzenia");

    act(() => getTestRouter().navigate(EDIT_URL));

    expect(await nameInput()).toHaveValue("Piknik jesienny");
    expect(panel.get().eventEdit).toMatchObject({ eventId: EVENT_ID, draft: { name: "Piknik jesienny" } });
  });
});

describe("EventForm", () => {
  it("gives a kept banner a fresh, unrevoked preview when the page's effects re-run (back from /places/new)", async () => {
    let preview = 0;
    URL.createObjectURL = vi.fn(() => `blob:banner-${(preview += 1)}`);
    URL.revokeObjectURL = vi.fn();
    const banner = { value: new File(["b"], "b.jpg", { type: "image/jpeg" }), onChange: vi.fn() };
    const page = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <EventForm
          draft={EMPTY_EVENT_DRAFT}
          onDraftChange={vi.fn()}
          banner={banner}
          placeIdPrefix="event"
          submitLabel="Utwórz wydarzenie"
          showErrors={false}
          onInvalidSubmit={vi.fn()}
          busy={false}
          error={null}
          onSubmit={vi.fn()}
        />
      </Activity>
    );
    const view = renderWithRoute(page("visible"), { url: "/add/event", wrapper: createQueryWrapper() });
    await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());

    // Hiding runs the effect cleanups (revoking the preview) but keeps the state, as a remount in dev does.
    view.rerender(page("hidden"));
    view.rerender(page("visible"));

    await waitFor(() => {
      const src = view.container.querySelector("img")?.getAttribute("src");
      expect(src).toMatch(/^blob:banner-/);
      expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).not.toContain(src);
    });
  });
});
