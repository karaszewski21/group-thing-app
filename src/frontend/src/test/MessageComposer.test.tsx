import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { MessageComposer } from "../pages/messages/MessageComposer";

function typeInto(text: string) {
  fireEvent.change(screen.getByLabelText("Wiadomość"), { target: { value: text } });
}

describe("MessageComposer", () => {
  it("counter_showsLength_andSendDisabledWhenEmptyBlankOrTooLong", () => {
    render(<MessageComposer send={vi.fn()} />);
    const sendButton = screen.getByRole("button", { name: "Wyślij" });

    expect(screen.getByText("0 / 1000")).toBeInTheDocument();
    expect(screen.getByText("Enter — nowa linia")).toBeInTheDocument();
    expect(screen.getByLabelText("Wiadomość")).toHaveAttribute("placeholder", "Napisz wiadomość…");
    expect(sendButton).toBeDisabled();

    typeInto("   \n ");
    expect(sendButton).toBeDisabled();

    typeInto("x".repeat(1001));
    expect(screen.getByText("1001 / 1000")).toBeInTheDocument();
    expect(sendButton).toBeDisabled();

    typeInto("A jeszcze jedno…");
    expect(screen.getByText("16 / 1000")).toBeInTheDocument();
    expect(sendButton).toBeEnabled();
  });

  it("mount_focusesTextarea", () => {
    render(<MessageComposer send={vi.fn()} />);

    expect(screen.getByLabelText("Wiadomość")).toHaveFocus();
  });

  it("send_success_returnsFocusToTextarea", async () => {
    render(<MessageComposer send={vi.fn().mockResolvedValue(undefined)} />);
    typeInto("Do środy!");
    const sendButton = screen.getByRole("button", { name: "Wyślij" });
    sendButton.focus();

    fireEvent.click(sendButton);

    expect(await screen.findByText("0 / 1000")).toBeInTheDocument();
    expect(screen.getByLabelText("Wiadomość")).toHaveFocus();
  });

  it("send_failure_keepsTextAndFocusInTextarea", async () => {
    render(<MessageComposer send={vi.fn().mockRejectedValue(new Error("Nie udało się wysłać — spróbuj ponownie"))} />);
    typeInto("A jeszcze jedno…");
    const sendButton = screen.getByRole("button", { name: "Wyślij" });
    sendButton.focus();

    fireEvent.click(sendButton);

    await screen.findByRole("alert");
    const field = screen.getByLabelText("Wiadomość");
    expect(field).toHaveValue("A jeszcze jedno…");
    expect(field).toHaveFocus();
  });

  it("send_success_sendsTrimmedTextAndClearsField", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    render(<MessageComposer send={send} />);

    typeInto("  Do środy!  ");
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    expect(await screen.findByText("0 / 1000")).toBeInTheDocument();
    expect(send).toHaveBeenCalledWith("Do środy!");
    expect(screen.getByLabelText("Wiadomość")).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    [
      "429 keeps the server's Polish text",
      new ApiError(429, "Too Many Requests", { message: "Za dużo wiadomości — spróbuj ponownie za chwilę." }),
      "Za dużo wiadomości — spróbuj ponownie za chwilę.",
    ],
    ["403", new ApiError(403, "Forbidden", { message: "Access denied" }), "Nie masz dostępu do tego czatu."],
    [
      "generic error",
      new ApiError(500, "Internal Server Error", { message: "boom" }),
      "Nie udało się wysłać — spróbuj ponownie",
    ],
    [
      "error already mapped by useThread",
      new Error("Czat jest tylko do odczytu"),
      "Czat jest tylko do odczytu",
    ],
  ])("send_failure_%s_showsAlertAndKeepsText", async (_label, err, expected) => {
    render(<MessageComposer send={vi.fn().mockRejectedValue(err)} />);

    typeInto("A jeszcze jedno…");
    fireEvent.click(screen.getByRole("button", { name: "Wyślij" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(expected);
    const field = screen.getByLabelText("Wiadomość");
    expect(field).toHaveValue("A jeszcze jedno…");
    expect(field).toHaveAttribute("aria-describedby", alert.id);
  });
});
