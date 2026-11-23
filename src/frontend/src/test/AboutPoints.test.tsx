import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutPointsView } from "../features/points/AboutPointsView";
import { TermCard } from "../features/terms/components/TermCard";
import { renderWithRoute } from "./renderWithRoute";

describe("AboutPointsView", () => {
  it("explains earning, the rules and spending, and links to the owner's points", () => {
    renderWithRoute(<AboutPointsView />, { url: "/about/points" });

    expect(screen.getByRole("heading", { level: 1, name: "Punkty i reputacja" })).toBeInTheDocument();
    for (const name of ["Co to są punkty?", "Jak je zdobyć?", "Kiedy punktów nie ma?", "Co można z nimi zrobić?"]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Zobacz swoje punkty" })).toHaveAttribute("href", "/points");
  });
});

describe("TermCard points badge", () => {
  it("shows the attendance points with a link to /about/points", () => {
    renderWithRoute(<TermCard date="2026-11-25T18:00:00" capacity={null} attendancePoints={20} />, { url: "/" });

    expect(screen.getByText("+20 pkt za obecność")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Co to są punkty?" })).toHaveAttribute("href", "/about/points");
  });

  it("shows no badge for a term without points", () => {
    renderWithRoute(<TermCard date="2026-11-25T18:00:00" capacity={null} attendancePoints={0} />, { url: "/" });

    expect(screen.queryByText(/pkt za obecność/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Co to są punkty?" })).not.toBeInTheDocument();
  });
});
