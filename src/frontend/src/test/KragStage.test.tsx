import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BTN_PRIMARY } from "../components/krag/kragStyles";
import { Avatar } from "../components/shared/Avatar";
import { KragStage } from "../pages/krag/components/KragStage";

afterEach(() => {
  cleanup();
});

describe("KragStage", () => {
  it("renders its content and overlay without injecting a stylesheet or fonts", () => {
    render(<KragStage overlay={<p>toast</p>}>term</KragStage>);

    expect(screen.getByText("term")).toBeInTheDocument();
    expect(screen.getByText("toast")).toBeInTheDocument();
    expect(document.querySelector("style")).toBeNull();
    expect(document.querySelector('link[rel="stylesheet"]')).toBeNull();
  });

  it("paints the page from theme tokens", () => {
    const { container } = render(<KragStage>term</KragStage>);
    expect(container.firstElementChild).toHaveClass("bg-cream", "text-ink");
  });

  it("colors the avatar markers and the primary button from theme roles", () => {
    render(<Avatar name="Rodzina Nowak" showsSharesIcon showsBringsIcon />);
    expect(screen.getByLabelText("Udostępnia rzecz")).toHaveClass("bg-accent", "text-ink");
    expect(screen.getByLabelText("Przynosi na zajęcia")).toHaveClass("bg-teal", "text-ink");
    expect(BTN_PRIMARY.split(" ")).toEqual(expect.arrayContaining(["bg-primary", "text-on-primary"]));
  });
});
