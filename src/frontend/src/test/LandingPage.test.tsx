import { screen } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { describe, expect, it } from "vitest";
import { LandingPage } from "../features/landing/LandingPage";

describe("LandingPage", () => {
  it("offers sign-up and login and previews items and meetings", () => {
    renderWithRoute(<LandingPage />, { url: "/" });

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Załóż konto" })).toHaveAttribute("href", "/login?mode=register");
    expect(screen.getByRole("link", { name: "Mam już konto" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("heading", { name: "Ostatnio dodane" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fotelik 9–18 kg" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spotkania w okolicy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Joga dla rodzin/ })).toBeInTheDocument();
  });
});
