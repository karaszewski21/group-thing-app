import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TermPlaceLine } from "../components/shared/TermPlaceLine";
import type { TermPlaceLocation } from "../utils/appHelpers";
import { makeLocality, makePublicLocation } from "./fixtures/locations";

const POZNAN = makeLocality({ id: "0969400", name: "Poznań", kind: "TOWN", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" });

const GOOGLE_PLACE: TermPlaceLocation = makePublicLocation({
  locality: POZNAN,
  label: "Poznań — ul. Polna 12, Poznań",
  formatted_address: "ul. Polna 12, Poznań",
  google_place_id: "ChIJ-polna",
});

const LOCALITY_ONLY: TermPlaceLocation = makePublicLocation({ locality: POZNAN, label: "Poznań, wielkopolskie" });

describe("TermPlaceLine", () => {
  it("shows the bold locality, then the address, and links to Maps with the place id (none for a typed address)", () => {
    const { rerender } = render(<TermPlaceLine location={GOOGLE_PLACE} capacity={null} withMapLink />);
    const locality = screen.getByText("Poznań");
    expect(locality).toHaveClass("font-bold");
    expect(locality.nextElementSibling).toHaveTextContent("ul. Polna 12, Poznań");
    expect(screen.queryByText(/gm\./)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Otwórz Poznań — ul. Polna 12, Poznań w Google Maps (nowa karta)" });
    expect(link).toHaveTextContent("Otwórz w Google Maps");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=ul.%20Polna%2012%2C%20Pozna%C5%84&query_place_id=ChIJ-polna",
    );

    rerender(<TermPlaceLine location={{ ...GOOGLE_PLACE, google_place_id: null }} capacity={null} withMapLink />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=ul.%20Polna%2012%2C%20Pozna%C5%84",
    );
  });

  it("without an address shows the locality detail line and searches Maps by the locality", () => {
    render(<TermPlaceLine location={LOCALITY_ONLY} capacity={null} withMapLink />);
    expect(screen.getByText("Poznań").nextElementSibling).toHaveTextContent("gm. Poznań, pow. Poznań, wielkopolskie");
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Poznań, gmina Poznań, wielkopolskie, Polska")}`,
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
