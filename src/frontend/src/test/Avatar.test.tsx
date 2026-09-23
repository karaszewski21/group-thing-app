import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar } from "../components/shared/Avatar";

describe("Avatar", () => {
  it("renders 2-letter initials from a family name, stripping the 'Rodzina' prefix", () => {
    render(<Avatar name="Rodzina Wiśniewskich" />);
    expect(screen.getByText("WI")).toBeInTheDocument();
  });

  it("renders a deterministic color for the same name across renders", () => {
    const { container: first } = render(<Avatar name="Rodzina Kowalskich" />);
    const { container: second } = render(<Avatar name="Rodzina Kowalskich" />);
    const firstBg = (first.firstChild as HTMLElement).style.background;
    const secondBg = (second.firstChild as HTMLElement).style.background;
    expect(firstBg).toBe(secondBg);
    expect(firstBg).not.toBe("");
  });

  it("does not render the shares marker when showsSharesIcon is false or omitted", () => {
    render(<Avatar name="Rodzina Nowak" />);
    expect(screen.queryByLabelText("Udostępnia rzecz")).not.toBeInTheDocument();
  });

  it("renders the shares marker only when showsSharesIcon=true", () => {
    render(<Avatar name="Rodzina Nowak" showsSharesIcon />);
    expect(screen.getByLabelText("Udostępnia rzecz")).toBeInTheDocument();
  });

  it("renders the brings marker only when showsBringsIcon=true", () => {
    render(<Avatar name="Rodzina Nowak" showsBringsIcon />);
    expect(screen.getByLabelText("Przynosi na zajęcia")).toBeInTheDocument();
    expect(screen.queryByLabelText("Udostępnia rzecz")).not.toBeInTheDocument();
  });

  it("renders both markers simultaneously when both props are true", () => {
    render(<Avatar name="Rodzina Nowak" showsSharesIcon showsBringsIcon />);
    expect(screen.getByLabelText("Udostępnia rzecz")).toBeInTheDocument();
    expect(screen.getByLabelText("Przynosi na zajęcia")).toBeInTheDocument();
  });
});
