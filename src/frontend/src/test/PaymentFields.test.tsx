import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PaymentUrlField, PriceField } from "../components/shared/appComponents";
import { PAYMENT_URL_ERROR, PAYMENT_URL_REQUIRES_PRICE_ERROR, PRICE_ERROR } from "../utils/appHelpers";

function Price() {
  const [value, setValue] = useState("");
  return <PriceField label="Cena domyślna (zł)" value={value} onChange={setValue} hint="Puste = zajęcia bezpłatne." />;
}

describe("Payment fields", () => {
  it("PriceField shows the inline alert and aria-invalid for an invalid amount", () => {
    render(<Price />);
    const input = screen.getByLabelText("Cena domyślna (zł)");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Puste = zajęcia bezpłatne.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "abc" } });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(PRICE_ERROR);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);

    fireEvent.change(input, { target: { value: "25,50" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("PaymentUrlField shows the format error, then the requires-price error", () => {
    const { rerender } = render(
      <PaymentUrlField label="Link do płatności (opcjonalnie)" value="http://x.pl" onChange={() => {}} priceMissing={false} />,
    );
    const input = screen.getByLabelText("Link do płatności (opcjonalnie)");
    expect(input).toHaveAttribute("inputmode", "url");
    expect(input).toHaveAttribute("placeholder", "https://");
    expect(screen.getByRole("alert")).toHaveTextContent(PAYMENT_URL_ERROR);
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(
      <PaymentUrlField label="Link do płatności (opcjonalnie)" value="https://x.pl" onChange={() => {}} priceMissing />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(PAYMENT_URL_REQUIRES_PRICE_ERROR);
    expect(input).toHaveAttribute("aria-invalid", "true");

    rerender(
      <PaymentUrlField label="Link do płatności (opcjonalnie)" value="https://x.pl" onChange={() => {}} priceMissing={false} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
