import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PointsPriceStepper } from "../components/shared/PointsPriceStepper";

const BOUNDS = { min: 20, max: 60, step: 10 };
const ERROR = "Cena musi być od 20 do 60 pkt, co 10.";

function Harness({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return <PointsPriceStepper id="price" value={value} onChange={setValue} bounds={BOUNDS} suggestion={40} />;
}

function input() {
  return screen.getByLabelText("Cena w punktach");
}

describe("PointsPriceStepper", () => {
  it("moves by the step within the bounds and disables each button at its bound", () => {
    render(<Harness initial="40" />);
    const lower = screen.getByRole("button", { name: "Obniż o 10" });
    const raise = screen.getByRole("button", { name: "Podnieś o 10" });
    expect(lower).toHaveAttribute("type", "button");
    expect(raise).toHaveAttribute("type", "button");
    expect(input()).toHaveAttribute("type", "text");
    expect(input()).toHaveAttribute("inputMode", "numeric");
    expect(input()).toHaveAttribute("pattern", "[0-9]*");
    expect(screen.getByText("40 pkt").parentElement).toHaveTextContent("System proponuje 40 pkt");
    expect(input()).toHaveAccessibleDescription("Dozwolone 20–60 pkt, co 10");

    fireEvent.click(lower);
    fireEvent.click(lower);
    expect(input()).toHaveValue("20");
    expect(lower).toBeDisabled();
    expect(raise).toBeEnabled();

    for (let i = 0; i < 4; i += 1) fireEvent.click(raise);
    expect(input()).toHaveValue("60");
    expect(raise).toBeDisabled();
    expect(lower).toBeEnabled();
  });

  it("shows the inline alert with aria-invalid for an off-step value and steps back onto the grid", () => {
    render(<Harness initial="40" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input()).not.toHaveAttribute("aria-invalid");

    fireEvent.change(input(), { target: { value: "55" } });

    expect(input()).toHaveValue("55");
    expect(screen.getByRole("alert")).toHaveTextContent(ERROR);
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveAccessibleDescription(`Dozwolone 20–60 pkt, co 10 ${ERROR}`);

    fireEvent.click(screen.getByRole("button", { name: "Obniż o 10" }));
    expect(input()).toHaveValue("50");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["", "abc", "70"])("treats %j as invalid: marked and described on mount, announced only once edited", (raw) => {
    render(<Harness initial={raw} />);
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(input()).toHaveAccessibleDescription(`Dozwolone 20–60 pkt, co 10 ${ERROR}`);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(input(), { target: { value: `${raw}5` } });

    expect(screen.getByRole("alert")).toHaveTextContent(ERROR);
    expect(input()).toHaveAttribute("aria-invalid", "true");
  });
});
