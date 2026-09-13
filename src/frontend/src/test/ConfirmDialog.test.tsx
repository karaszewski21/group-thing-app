import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";

function renderDialog(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <ChakraProvider value={system}>
      <ConfirmDialog
        open
        onClose={onClose}
        onConfirm={onConfirm}
        title="Delete Category"
        message="Are you sure you want to delete this category? This action cannot be undone."
        {...props}
      />
    </ChakraProvider>,
  );
  return { onClose, onConfirm };
}

describe("ConfirmDialog", () => {
  it("renders the error banner with aria-live=\"polite\" when `error` is set, and does not call onClose itself", () => {
    const { onClose } = renderDialog({
      error: 'Cannot delete "Zabawka": 12 product(s) still use this category.',
    });

    const banner = screen.getByText(
      'Cannot delete "Zabawka": 12 product(s) still use this category.',
    );
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute("aria-live", "polite");
    // Rendering with an error set is a passive state change — the dialog
    // must not proactively close itself.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("existing callers that don't pass `error` (e.g. ProductListPage's delete flow) are unaffected: no banner renders and Cancel still closes the dialog", () => {
    const { onClose } = renderDialog();

    expect(
      screen.queryByText(/product\(s\) still use this category/i),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
