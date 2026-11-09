import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignUpFooter } from "../components/shared/SignUpFooter";

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
});
