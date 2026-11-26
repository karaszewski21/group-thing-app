import { act, fireEvent, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import type { AuthTab } from "../auth/authPaths";
import { AuthTabs } from "../features/auth/AuthTabs";
import { SocialAuthButtons } from "../features/auth/SocialAuthButtons";
import * as googleIdentity from "../lib/googleIdentity";
import type { GoogleCredentialResponse, GoogleIdApi } from "../lib/googleIdentity";
import { renderWithRoute } from "./renderWithRoute";

const loginWithGoogle = vi.fn<(credential: string) => Promise<{ created: boolean }>>();

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ loginWithGoogle, login: vi.fn(), register: vi.fn() }),
}));
vi.mock("../api/auth", () => ({ getGoogleNonce: vi.fn() }));
vi.mock("../lib/googleIdentity", () => ({ isGoogleLoginConfigured: vi.fn(), loadGoogleIdentity: vi.fn() }));

const GENERIC = "Nie udało się zalogować przez Google. Spróbuj ponownie.";
const CONFLICT = "Konto z tym adresem już istnieje — zaloguj się hasłem.";
const UNVERIFIED = "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem.";
const UNAVAILABLE = "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później.";
const NINE_MINUTES = 9 * 60 * 1000;

interface FakeGoogle {
  api: GoogleIdApi;
  initialize: ReturnType<typeof vi.fn<GoogleIdApi["initialize"]>>;
  renderButton: ReturnType<typeof vi.fn<GoogleIdApi["renderButton"]>>;
}

function fakeGoogle(): FakeGoogle {
  const initialize = vi.fn<GoogleIdApi["initialize"]>();
  const renderButton = vi.fn<GoogleIdApi["renderButton"]>();
  return { api: { initialize, renderButton }, initialize, renderButton };
}

let google: FakeGoogle;

function lastCallback(): (response: GoogleCredentialResponse) => void {
  const config = google.initialize.mock.lastCall?.[0];
  if (!config) throw new Error("initialize was not called");
  return config.callback;
}

function conflict(message: string): ApiError {
  return new ApiError(409, "Conflict", { status: 409, error: "Conflict", message });
}

/** Lets mocked promises and React updates settle without real timers. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function TabsHost({ initial }: { initial: AuthTab }) {
  const [tab, setTab] = useState<AuthTab>(initial);
  return <AuthTabs tab={tab} onSelect={setTab} />;
}

function renderButtons(tab: AuthTab = "login", onSwitchToLogin = vi.fn()) {
  return renderWithRoute(<SocialAuthButtons tab={tab} onSwitchToLogin={onSwitchToLogin} />, { url: "/login" });
}

beforeEach(() => {
  vi.resetAllMocks();
  google = fakeGoogle();
  vi.mocked(googleIdentity.isGoogleLoginConfigured).mockReturnValue(true);
  vi.mocked(googleIdentity.loadGoogleIdentity).mockResolvedValue(google.api);
  vi.mocked(authApi.getGoogleNonce).mockResolvedValue("nonce-1");
  vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "client-1.apps.googleusercontent.com");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SocialAuthButtons", () => {
  it("renders nothing without a client ID or on a nonce 503, and never loads the script", async () => {
    vi.mocked(googleIdentity.isGoogleLoginConfigured).mockReturnValue(false);
    const { container, unmount } = renderButtons();
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(authApi.getGoogleNonce).not.toHaveBeenCalled();
    expect(googleIdentity.loadGoogleIdentity).not.toHaveBeenCalled();
    unmount();

    vi.mocked(googleIdentity.isGoogleLoginConfigured).mockReturnValue(true);
    vi.mocked(authApi.getGoogleNonce).mockResolvedValue(null);
    const second = renderButtons();
    await settle();
    expect(second.container).toBeEmptyDOMElement();
    expect(screen.queryByText("lub emailem")).not.toBeInTheDocument();
    expect(googleIdentity.loadGoogleIdentity).not.toHaveBeenCalled();
  });

  it("shows the skeleton, the empty status line and the divider while loading", async () => {
    vi.mocked(authApi.getGoogleNonce).mockReturnValue(new Promise(() => {}));
    const { container } = renderButtons();

    const skeleton = container.querySelector('[aria-hidden="true"]');
    expect(skeleton).toHaveClass("h-11", "max-w-[400px]", "animate-pulse", "rounded-full", "bg-line");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByText("lub emailem")).toBeInTheDocument();
    expect(screen.queryByText(/Facebook|wkrótce/)).not.toBeInTheDocument();
    await settle();
  });

  it("initializes GIS and renders the pill button per tab, re-rendering on a tab change", async () => {
    renderWithRoute(<TabsHost initial="login" />, { url: "/login" });
    await settle();

    expect(google.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1.apps.googleusercontent.com",
        nonce: "nonce-1",
        ux_mode: "popup",
        auto_select: false,
      }),
    );
    expect(google.renderButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), {
      type: "standard",
      theme: "outline",
      shape: "pill",
      size: "large",
      logo_alignment: "left",
      locale: "pl",
      text: "signin_with",
      width: 200,
    });
    expect(screen.queryByText(/Facebook|wkrótce/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Załóż konto" }));
    await settle();
    expect(google.renderButton).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ text: "signup_with", width: 200 }),
    );
  });

  it("posts the credential once and ignores a second callback while the POST is in flight", async () => {
    let resolve: (value: { created: boolean }) => void = () => {};
    loginWithGoogle.mockReturnValue(new Promise((r) => (resolve = r)));
    renderButtons();
    await settle();

    const callback = lastCallback();
    act(() => callback({ credential: "id-token-1" }));
    act(() => callback({ credential: "id-token-2" }));
    expect(loginWithGoogle).toHaveBeenCalledTimes(1);
    expect(loginWithGoogle).toHaveBeenCalledWith("id-token-1");

    resolve({ created: true });
    await settle();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the 409 copy with the login switch on the register tab only and the generic copy for a foreign message", async () => {
    loginWithGoogle
      .mockRejectedValueOnce(conflict(CONFLICT))
      .mockRejectedValueOnce(conflict(CONFLICT))
      .mockRejectedValueOnce(conflict("Data integrity violation"));
    renderWithRoute(<TabsHost initial="register" />, { url: "/login" });
    await settle();

    act(() => lastCallback()({ credential: "id-token" }));
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(CONFLICT);
    expect(alert).toHaveClass("mt-2", "rounded-2xl", "bg-danger-soft", "px-3.5", "py-2.5", "text-sm", "text-danger");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Zaloguj się" }));
    expect(screen.getByRole("tab", { name: "Zaloguj się" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => lastCallback()({ credential: "id-token" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(CONFLICT);
    expect(screen.getByRole("alert").querySelector("button")).toBeNull();

    act(() => lastCallback()({ credential: "id-token" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC);
    expect(screen.getByRole("alert").querySelector("button")).toBeNull();
  });

  it.each([
    ["the 403 copy", new ApiError(403, "Forbidden", { status: 403, error: "Forbidden", message: UNVERIFIED }), UNVERIFIED],
    [
      "the 503 copy",
      new ApiError(503, "Service Unavailable", { status: 503, error: "Service Unavailable", message: UNAVAILABLE }),
      UNAVAILABLE,
    ],
    ["the generic copy for a 403 with a foreign message", new ApiError(403, "Forbidden", { message: "Forbidden" }), GENERIC],
    ["the generic copy for a network error", new TypeError("Failed to fetch"), GENERIC],
  ])("shows %s on the register tab without the login switch", async (_label, failure, copy) => {
    loginWithGoogle.mockRejectedValue(failure);
    renderButtons("register");
    await settle();

    act(() => lastCallback()({ credential: "id-token" }));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("alert").querySelector("button")).toBeNull();
  });

  it("re-fetches the nonce after a failure and keeps only the alert when that re-fetch fails", async () => {
    loginWithGoogle.mockRejectedValue(new ApiError(500, "Internal Server Error", null));
    vi.mocked(authApi.getGoogleNonce).mockResolvedValueOnce("nonce-1").mockResolvedValueOnce("nonce-2");
    renderButtons();
    await settle();

    act(() => lastCallback()({ credential: "id-token" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC);
    expect(google.initialize).toHaveBeenCalledTimes(2);
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: "nonce-2" }));
    expect(google.renderButton).toHaveBeenCalledTimes(2);
    expect(loginWithGoogle).toHaveBeenCalledTimes(1);

    vi.mocked(authApi.getGoogleNonce).mockRejectedValue(new ApiError(500, "Internal Server Error", null));
    act(() => lastCallback()({ credential: "id-token" }));
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("lub emailem")).not.toBeInTheDocument();
    expect(google.renderButton).toHaveBeenCalledTimes(2);
  });

  it("shares one pending nonce request between StrictMode's double mount and overlapping refreshes", async () => {
    let resolveNonce: (nonce: string) => void = () => {};
    vi.mocked(authApi.getGoogleNonce).mockReturnValueOnce(new Promise((r) => (resolveNonce = r)));
    renderWithRoute(
      <StrictMode>
        <SocialAuthButtons tab="login" onSwitchToLogin={vi.fn()} />
      </StrictMode>,
      { url: "/login" },
    );
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(1);
    resolveNonce("nonce-1");
    await settle();
    expect(google.initialize).toHaveBeenCalled();
    expect(google.initialize.mock.calls.every(([config]) => config.nonce === "nonce-1")).toBe(true);

    loginWithGoogle.mockRejectedValue(new ApiError(401, "Unauthorized", { message: GENERIC }));
    vi.mocked(authApi.getGoogleNonce).mockReturnValueOnce(new Promise((r) => (resolveNonce = r)));
    const staleCallback = lastCallback();
    act(() => staleCallback({ credential: "id-token-1" }));
    await settle();
    act(() => staleCallback({ credential: "id-token-2" }));
    await settle();
    expect(loginWithGoogle).toHaveBeenCalledTimes(2);
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);

    resolveNonce("nonce-2");
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: "nonce-2" }));
  });

  it("ignores a popup credential that arrives after unmount", async () => {
    const { unmount } = renderButtons();
    await settle();
    const callback = lastCallback();

    unmount();
    act(() => callback({ credential: "id-token" }));
    await settle();
    expect(loginWithGoogle).not.toHaveBeenCalled();
  });

  it("refreshes the nonce after 9 minutes, only marking it stale while the tab is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(authApi.getGoogleNonce)
      .mockResolvedValueOnce("nonce-1")
      .mockResolvedValueOnce("nonce-2")
      .mockResolvedValueOnce("nonce-3");
    renderButtons();
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NINE_MINUTES);
    });
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: "nonce-2" }));

    visibility.mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NINE_MINUTES);
    });
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(3);
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: "nonce-3" }));
    expect(hasFocus).toHaveBeenCalled();
  });

  it("only marks the nonce stale while the popup holds focus, then refreshes on focus and stops on unmount", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(authApi.getGoogleNonce).mockResolvedValueOnce("nonce-1").mockResolvedValueOnce("nonce-2");
    const { unmount } = renderButtons();
    await settle();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NINE_MINUTES);
    });
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(1);

    hasFocus.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: "nonce-2" }));

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NINE_MINUTES);
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);
  });

  it("does not refresh while a POST is in flight, then refreshes on focus", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    let reject: (reason: unknown) => void = () => {};
    loginWithGoogle.mockReturnValue(new Promise((_, r) => (reject = r)));
    renderButtons();
    await settle();

    act(() => lastCallback()({ credential: "id-token" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NINE_MINUTES);
    });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(1);

    reject(new ApiError(401, "Unauthorized", { message: GENERIC }));
    await settle();
    expect(authApi.getGoogleNonce).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC);
  });
});
