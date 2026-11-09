import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProfileRouteError from "../app/(site)/(panel)/profile/error";
import ProfileRouteLoading from "../app/(site)/(panel)/profile/loading";
import ProfileRouteNotFound from "../app/(site)/(panel)/profile/not-found";
import { createTestQueryClient, withQueryClient } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

describe("Konto sub-page route states", () => {
  it("loading shows a busy skeleton", () => {
    render(<ProfileRouteLoading />);

    expect(screen.getByText("Wczytywanie…").parentElement).toHaveAttribute("aria-busy", "true");
  });

  it("not-found links back to Konto", () => {
    renderWithRoute(<ProfileRouteNotFound />, { url: "/profile", pattern: "/profile" });

    expect(screen.getByText("Nie znaleziono tej strony.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do konta" })).toHaveAttribute("href", "/account");
  });

  it("error retry resets the failed reads before re-rendering", async () => {
    const client = createTestQueryClient();
    await client.prefetchQuery({ queryKey: ["failed"], queryFn: () => Promise.reject(new Error("boom")) });
    await client.prefetchQuery({ queryKey: ["fine"], queryFn: () => "ok" });
    const reset = vi.fn();
    render(withQueryClient(<ProfileRouteError error={new Error("boom")} reset={reset} />, client));

    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się wyświetlić tej strony.");
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(["failed"])?.status).toBe("pending");
    expect(client.getQueryData(["fine"])).toBe("ok");
  });
});
