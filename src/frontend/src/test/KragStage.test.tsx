import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KragStage } from "../pages/krag/components/KragStage";

function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  expect(match, `${selector} rule not found`).not.toBeNull();
  return match![1];
}

function declarations(body: string): string[] {
  return body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("KragStage", () => {
  it("reads only --color-* theme tokens", () => {
    render(<KragStage>term</KragStage>);
    const vars = injectedCss().match(/var\(--[a-z-]+\)/g) ?? [];
    expect(vars.length).toBeGreaterThan(0);
    expect(vars.filter((v) => !v.startsWith("var(--color-"))).toEqual([]);
  });

  it("no longer ships the dead .kg-stage / .kg-app wrapper rules", () => {
    render(<KragStage>term</KragStage>);
    expect(injectedCss()).not.toMatch(/\.kg-(stage|app)\b/);
  });

  it("colors markers and the primary button from theme roles", () => {
    render(<KragStage>term</KragStage>);
    const css = injectedCss();
    const shares = declarations(ruleBody(css, ".kg-mark-shares"));
    expect(shares).toContain("background:var(--color-primary)");
    expect(shares).toContain("color:var(--color-on-primary)");
    const brings = declarations(ruleBody(css, ".kg-mark-brings"));
    expect(brings).toContain("background:var(--color-teal)");
    expect(brings).toContain("color:var(--color-ink)");
    const button = declarations(ruleBody(css, ".kg-btn-primary"));
    expect(button).toContain("background:var(--color-primary)");
    expect(button).toContain("color:var(--color-on-primary)");
    expect(declarations(ruleBody(css, ".kg-center-av"))).toContain("color:var(--color-on-ink)");
    expect(ruleBody(css, ".kg-mark")).not.toMatch(/(^|;)\s*color:/);
  });
});
