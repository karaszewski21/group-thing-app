import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { LandingPage } from "../pages/home/LandingPage";

describe("LandingPage", () => {
  it("offers sign-up and login and previews items and meetings", () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Załóż konto" })).toHaveAttribute("href", "/login?mode=register");
    expect(screen.getByRole("link", { name: "Mam już konto" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("heading", { name: "Ostatnio dodane" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fotelik 9–18 kg" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spotkania w okolicy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Joga dla rodzin/ })).toBeInTheDocument();
  });
});
