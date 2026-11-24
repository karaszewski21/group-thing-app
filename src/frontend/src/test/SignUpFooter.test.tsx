import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignUpFooter } from "../components/shared/SignUpFooter";
import { formatPrice } from "../utils/appHelpers";

// Queries normalize the DOM's no-break space, not the expected string.
const PRICE = formatPrice("25.50").replace(/\s/g, " ");

describe("SignUpFooter", () => {
  it("runs onSignUp for a logged-in viewer and stays disabled until it settles", async () => {
    let settle: () => void = () => {};
    const onSignUp = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(<SignUpFooter variant="signUp" isLoggedIn authMessage="Konto potrzebne." onSignUp={onSignUp} />);

    const button = screen.getByRole("button", { name: "＋ Zapisz się" });
    fireEvent.click(button);
    expect(onSignUp).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();

    await act(async () => settle());
    expect(button).toBeEnabled();
  });

  it("renders the withdraw and disabled ended variants", () => {
    const onWithdraw = vi.fn();
    const { rerender } = render(<SignUpFooter variant="withdraw" onWithdraw={onWithdraw} />);
    fireEvent.click(screen.getByRole("button", { name: "Wypisz się" }));
    expect(onWithdraw).toHaveBeenCalledTimes(1);

    rerender(<SignUpFooter variant="ended" label="Wydarzenie się zakończyło" />);
    expect(screen.getByRole("button", { name: "Wydarzenie się zakończyło" })).toBeDisabled();
  });

  it("renders the unpaid payment link as an external new-tab anchor", () => {
    render(<SignUpFooter variant="payment" price="25.50" paymentUrl="https://pay.example.com/abc" status="UNPAID" />);

    const link = screen.getByRole("link", { name: `Zapłać ${formatPrice("25.50")} (nowa karta)` });
    expect(link).toHaveAttribute("href", "https://pay.example.com/abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent(`Zapłać ${PRICE} ↗`);
  });

  it.each(["http://pay.example.com/abc", "javascript:alert(1)", "https:pay.example.com", "https://a@evil.tld"])(
    "renders a stored link that is not a valid https URL (%s) as the on-site due note, never as an href",
    (paymentUrl) => {
      render(<SignUpFooter variant="payment" price="25.50" paymentUrl={paymentUrl} status="UNPAID" />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByText(`Do zapłaty: ${PRICE} (na miejscu)`)).toBeInTheDocument();
    },
  );

  it("styles Opłacone with the same role tokens as the RSVP card badge", () => {
    render(<SignUpFooter variant="payment" price="25.50" paymentUrl={null} status="PAID" />);
    expect(screen.getByText("Opłacone")).toHaveClass("bg-primary-soft", "text-primary-fg");
  });

  it("renders the on-site due note without a link and the paid state", () => {
    const { rerender } = render(<SignUpFooter variant="payment" price="25.50" paymentUrl={null} status="UNPAID" />);
    expect(screen.getByText(`Do zapłaty: ${PRICE} (na miejscu)`)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    rerender(<SignUpFooter variant="payment" price="25.50" paymentUrl="https://pay.example.com/abc" status="PAID" />);
    expect(screen.getByText("Opłacone")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/Do zapłaty/)).not.toBeInTheDocument();
  });
});
