import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsView } from "../features/account/SettingsView";
import * as appDataStore from "../features/panel/appDataStore";
import type { AppDataContextValue } from "../features/panel/AppDataContext";

vi.mock("../features/panel/appDataStore", async () => {
  const actual = await vi.importActual<typeof import("../features/panel/appDataStore")>(
    "../features/panel/appDataStore",
  );
  return { ...actual, useAppData: vi.fn() };
});

const setSettings = vi.fn();
const logout = vi.fn();

function renderView() {
  vi.mocked(appDataStore.useAppData).mockReturnValue({
    settings: { publicProfile: true },
    setSettings,
    logout,
  } as unknown as AppDataContextValue);
  return render(<SettingsView />);
}

describe("SettingsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("has no notification settings card or e-mail/SMS toggles", () => {
    renderView();

    expect(screen.queryByRole("heading", { name: "Powiadomienia" })).not.toBeInTheDocument();
    expect(screen.queryByText("Powiadomienia e-mail")).not.toBeInTheDocument();
    expect(screen.queryByText("Powiadomienia SMS")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(1);
  });

  it("keeps the privacy toggle and account logout, and explains in-app notifications", () => {
    renderView();

    expect(screen.getByRole("heading", { name: "Prywatność" })).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Widoczny profil publiczny" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(setSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Wyloguj się/ }));
    expect(logout).toHaveBeenCalledTimes(1);

    expect(
      screen.getByText("Powiadomienia dostajesz w aplikacji (dzwonek u góry ekranu)."),
    ).toBeInTheDocument();
  });
});
