import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrganizerTheme } from "../api/groups";
import { OrganizerThemeScope } from "../theme/OrganizerThemeScope";
import { resolveOrgTheme, THEME_ROLES } from "../theme/orgPalette";
import { ServerThemeProvider } from "../theme/ServerThemeProvider";

const INITIAL: OrganizerTheme = { primary_color: "#7a2a4f", accent_color: null, palette_preset: null };
const LIVE: OrganizerTheme = { primary_color: "#2a4f7a", accent_color: "#c2a94f", palette_preset: null };

afterEach(() => {
  cleanup();
});

function expectVars(element: HTMLElement, theme: OrganizerTheme) {
  const expected = resolveOrgTheme(theme);
  for (const role of THEME_ROLES) {
    expect(element.style.getPropertyValue(`--color-${role}`)).toBe(expected[`--color-${role}`]);
  }
}

describe("ServerThemeProvider", () => {
  it("renders the initial theme's resolveOrgTheme vars inline, also inside a scope without data yet", () => {
    const { container } = render(
      <ServerThemeProvider initialTheme={INITIAL}>
        <OrganizerThemeScope theme={undefined}>
          <span>page</span>
        </OrganizerThemeScope>
      </ServerThemeProvider>,
    );
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.display).toBe("contents");
    expectVars(wrapper, INITIAL);
    expectVars(screen.getByText("page").closest<HTMLElement>("[data-organizer-theme]")!, INITIAL);
  });

  it("lets the page's live theme override the initial theme", () => {
    render(
      <ServerThemeProvider initialTheme={INITIAL}>
        <OrganizerThemeScope theme={LIVE}>
          <span>page</span>
        </OrganizerThemeScope>
      </ServerThemeProvider>,
    );

    expectVars(screen.getByText("page").closest<HTMLElement>("[data-organizer-theme]")!, LIVE);
  });
});
