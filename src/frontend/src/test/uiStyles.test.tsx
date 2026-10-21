import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BTN_PRIMARY, PAGE_SHELL } from "../components/shared/uiStyles";
import { Avatar } from "../components/shared/Avatar";

afterEach(() => {
  cleanup();
});

describe("term page theme roles", () => {
  it("paints the page shell from theme tokens", () => {
    expect(PAGE_SHELL.split(" ")).toEqual(expect.arrayContaining(["bg-cream", "text-ink"]));
  });

  it("colors the avatar markers and the primary button from theme roles", () => {
    render(<Avatar name="Rodzina Nowak" showsSharesIcon showsBringsIcon />);
    expect(screen.getByLabelText("Udostępnia rzecz")).toHaveClass("bg-accent", "text-ink");
    expect(screen.getByLabelText("Przynosi na zajęcia")).toHaveClass("bg-teal", "text-ink");
    expect(BTN_PRIMARY.split(" ")).toEqual(expect.arrayContaining(["bg-primary", "text-on-primary"]));
  });
});
