import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as conversationsApi from "../api/conversations";
import { BottomNav } from "../components/layout/BottomNav";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../api/conversations", () => ({ getUnreadMessageCount: vi.fn(), chatErrorMessage: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "tok", username: "ania" }) }));

function currentTabs(url: string): string[] {
  renderWithRoute(<BottomNav />, { url, wrapper: createQueryWrapper() });
  const nav = screen.getByRole("navigation", { name: "Nawigacja główna" });
  return within(nav)
    .getAllByRole("button")
    .filter((tab) => tab.getAttribute("aria-current") === "true")
    .map((tab) => tab.textContent ?? "");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(conversationsApi.getUnreadMessageCount).mockResolvedValue({ count: 0 });
});

describe("BottomNav", () => {
  it.each([
    "/account",
    "/wanted",
    "/wanted/abc",
    "/wanted/abc/edit",
    "/places/new",
    "/places/7/edit",
    "/groups/5",
    "/family/members/new",
    "/items/reserved",
  ])("highlights Konto on %s", (url) => {
    expect(currentTabs(url)).toEqual(["Konto"]);
  });

  it.each(["/search", "/wantedly", "/skrzaty/items"])("highlights no tab on %s", (url) => {
    expect(currentTabs(url)).toEqual([]);
  });

  it("keeps Moje rzeczy on /items", () => {
    expect(currentTabs("/items")).toEqual(["Moje rzeczy"]);
  });
});
