import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrganizerThemeScope } from "../theme/OrganizerThemeScope";
import { buildOrgThemeVars, DEFAULT_THEME_VARS, THEME_ROLES } from "../theme/orgPalette";

afterEach(() => {
  cleanup();
});

function scopeOf(child: HTMLElement): HTMLElement {
  const scope = child.closest<HTMLElement>("[data-organizer-theme]");
  if (!scope) throw new Error("no scope element");
  return scope;
}

describe("OrganizerThemeScope", () => {
  it("sets all 13 generated vars inline for an organizer theme", () => {
    render(
      <OrganizerThemeScope theme={{ primary_color: "#7a2a4f", accent_color: null }}>
        <span>term</span>
      </OrganizerThemeScope>,
    );
    const scope = scopeOf(screen.getByText("term"));
    const expected = buildOrgThemeVars("#7a2a4f");

    expect(scope.tagName).toBe("DIV");
    expect(scope).toHaveAttribute("data-organizer-theme", "custom");
    expect(scope.style.getPropertyValue("--color-primary")).toBe("#7a2a4f");
    for (const role of THEME_ROLES) {
      expect(scope.style.getPropertyValue(`--color-${role}`)).toBe(expected[`--color-${role}`]);
    }
  });

  it("sets the default vars inline when there is no theme", () => {
    render(
      <OrganizerThemeScope theme={null}>
        <span>term</span>
      </OrganizerThemeScope>,
    );
    const scope = scopeOf(screen.getByText("term"));

    expect(scope).toHaveAttribute("data-organizer-theme", "default");
    for (const role of THEME_ROLES) {
      expect(scope.style.getPropertyValue(`--color-${role}`)).toBe(DEFAULT_THEME_VARS[`--color-${role}`]);
    }
  });

  it("never creates a containing block or carries a className", () => {
    render(
      <OrganizerThemeScope theme={{ primary_color: "#3498db", accent_color: "#f39c12" }}>
        <span>term</span>
      </OrganizerThemeScope>,
    );
    const scope = scopeOf(screen.getByText("term"));

    expect(scope.getAttribute("class")).toBeNull();
    expect(scope.getAttribute("style")).not.toMatch(/transform|filter|perspective|contain|will-change/);
  });
});
