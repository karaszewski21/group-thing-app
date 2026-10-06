import { ChakraProvider } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "../components/shared/Pagination";
import { system } from "../theme";

function renderPager(page: number, total: number, onPageChange = vi.fn()) {
  render(
    <ChakraProvider value={system}>
      <Pagination page={page} size={20} total={total} onPageChange={onPageChange} />
    </ChakraProvider>,
  );
  return onPageChange;
}

describe("Pagination", () => {
  it("renders nothing when everything fits on one page", () => {
    renderPager(1, 20);

    expect(screen.queryByRole("navigation", { name: "Pagination" })).not.toBeInTheDocument();
  });

  it("disables Previous on the first page and moves forward with Next", () => {
    const onPageChange = renderPager(1, 41);

    expect(screen.getByText("Page 1 of 3 · 41 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("disables Next on the last page and moves back with Previous", () => {
    const onPageChange = renderPager(3, 41);

    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("steps back to the last page when the current one no longer exists", () => {
    const onPageChange = renderPager(3, 25);

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
