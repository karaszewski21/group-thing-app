import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Link } from "../routing/navigation";
import { OrganizerThemeScope } from "../theme/OrganizerThemeScope";
import { renderWithRoute } from "./renderWithRoute";

function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

describe("organizer theme after client-side navigation", () => {
  it("leaves no organizer vars or term-page rules behind once the user moves on to /panel", () => {
    renderWithRoute(
      <OrganizerThemeScope theme={{ primary_color: "#7a2a4f", accent_color: null }}>
        <div>
          <Link to="/">Panel</Link>
        </div>
      </OrganizerThemeScope>,
      {
        url: "/ania/group/g/term/t",
        pattern: "/:organizationSlug/group/:groupId/term/:termId",
        routes: { "/": <h1>Panel</h1> },
      },
    );
    expect(document.querySelector('[data-organizer-theme="custom"]')).not.toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Panel" }));

    expect(screen.getByRole("heading", { name: "Panel" })).toBeInTheDocument();
    expect(document.querySelector("[data-organizer-theme]")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("");
    expect(document.body.style.getPropertyValue("--color-primary")).toBe("");
    const css = injectedCss();
    expect(css).not.toMatch(/:root\s*\{/);
    expect(css).not.toMatch(/(^|\})\s*\*\s*[,{]/);
    expect(css).not.toContain(".kg-");
  });
});
