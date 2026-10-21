import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDeleteDialog } from "../components/shared/ConfirmDeleteDialog";

function renderDialog(extra: { tone?: "danger" | "primary"; busyLabel?: string } = {}) {
  return render(
    <ConfirmDeleteDialog
      title="Na pewno?"
      body="Opis"
      confirmLabel="Potwierdź"
      fallbackError="Błąd"
      onConfirm={() => new Promise<void>(() => {})}
      onClose={vi.fn()}
      {...extra}
    />,
  );
}

describe("ConfirmDeleteDialog", () => {
  it("keeps the danger tone and Usuwanie… by default, and applies tone=primary with a custom busy label", () => {
    const { unmount } = renderDialog();
    const danger = screen.getByRole("button", { name: "Potwierdź" });
    expect(danger).toHaveClass("bg-danger");
    fireEvent.click(danger);
    expect(screen.getByRole("button", { name: "Usuwanie…" })).toBeDisabled();
    unmount();

    renderDialog({ tone: "primary", busyLabel: "Generowanie…" });
    const primary = screen.getByRole("button", { name: "Potwierdź" });
    expect(primary).toHaveClass("bg-primary");
    expect(primary).not.toHaveClass("bg-danger");
    fireEvent.click(primary);
    expect(screen.getByRole("button", { name: "Generowanie…" })).toBeDisabled();
    expect(screen.queryByText("Usuwanie…")).not.toBeInTheDocument();
  });
});
