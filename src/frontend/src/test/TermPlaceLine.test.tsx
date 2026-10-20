import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TermPlaceLine } from "../components/shared/TermPlaceLine";

const GOOGLE_PLACE = {
  name: "Świetlica na Polnej",
  formatted_address: "ul. Polna 12, Poznań",
  google_place_id: "ChIJ-polna",
  notes: "wejście od podwórza",
};

describe("TermPlaceLine", () => {
  it("links to Google Maps with the place id, and without it for a MANUAL place", () => {
    const { rerender } = render(<TermPlaceLine location={GOOGLE_PLACE} capacity={null} withMapLink />);
    expect(screen.getByText("Świetlica na Polnej")).toBeInTheDocument();
    expect(screen.getByText("wejście od podwórza")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Otwórz Świetlica na Polnej w Google Maps (nowa karta)" });
    expect(link).toHaveTextContent("Otwórz w Google Maps");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=ul.%20Polna%2012%2C%20Pozna%C5%84&query_place_id=ChIJ-polna",
    );

    rerender(
      <TermPlaceLine location={{ ...GOOGLE_PLACE, google_place_id: null }} capacity={null} withMapLink />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=ul.%20Polna%2012%2C%20Pozna%C5%84",
    );
  });

  it("shows 'X/Y miejsc' with a count, 'Y miejsc' with capacity only, nothing without capacity", () => {
    const { rerender } = render(
      <TermPlaceLine location={null} capacity={10} attendeeCount={8} withMapLink={false} />,
    );
    expect(screen.getByText("8/10 miejsc")).toBeInTheDocument();

    rerender(<TermPlaceLine location={null} capacity={10} withMapLink={false} />);
    expect(screen.getByText("10 miejsc")).toBeInTheDocument();

    rerender(<TermPlaceLine location={GOOGLE_PLACE} capacity={null} attendeeCount={3} withMapLink={false} />);
    expect(screen.queryByText(/miejsc$/)).not.toBeInTheDocument();
  });

  it("renders nothing when both location and capacity are null", () => {
    const { container } = render(<TermPlaceLine location={null} capacity={null} withMapLink />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders no anchor when withMapLink is false", () => {
    render(<TermPlaceLine location={GOOGLE_PLACE} capacity={12} withMapLink={false} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("ul. Polna 12, Poznań")).toBeInTheDocument();
  });
});
