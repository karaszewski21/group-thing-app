import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ItemActionsMenu } from "../features/items/ItemActionsMenu";
import { renderWithRoute } from "./renderWithRoute";

function renderMenu(onDelete = vi.fn()) {
  renderWithRoute(<ItemActionsMenu itemName="Rowerek" editPath="/items/7/edit" onDelete={onDelete} />, {
    url: "/items",
  });
  return onDelete;
}

describe("ItemActionsMenu", () => {
  it("opens Edytuj and Usuń with the focus on the first item, and Esc closes it back onto the button", () => {
    renderMenu();
    const button = screen.getByRole("button", { name: "Więcej działań: Rowerek" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const edit = screen.getByRole("menuitem", { name: "Edytuj rzecz Rowerek" });
    expect(edit).toHaveAttribute("href", "/items/7/edit");
    expect(edit).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("Usuń closes the menu and deletes", () => {
    const onDelete = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Więcej działań: Rowerek" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "Usuń rzecz Rowerek" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
