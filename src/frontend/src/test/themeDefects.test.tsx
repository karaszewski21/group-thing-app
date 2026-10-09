import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KragStage } from "../pages/krag/components/KragStage";

const SRC = resolve(process.cwd(), "src");

function readSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

/** Every `--color-<name>: #rrggbb` declared in index.css `@theme` blocks. */
function themeTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of readSource("index.css").matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]] = match[2];
  }
  return tokens;
}

function relativeLuminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

afterEach(() => {
  cleanup();
});

describe("default organizer palette contrast (WCAG AA)", () => {
  // Text/background role pairs used on the organizer, term and product pages.
  const TEXT_PAIRS: [foreground: string, background: string][] = [
    ["primary-fg", "cream"],
    ["primary-fg", "paper"],
    ["on-primary", "primary"],
    ["ink-soft", "primary-soft"],
    ["ink-soft", "cream"],
    ["accent-fg", "accent-soft"],
  ];

  it.each(TEXT_PAIRS)("%s on %s reaches 4.5:1", (foreground, background) => {
    const tokens = themeTokens();
    expect(tokens[foreground], `--color-${foreground} is not declared`).toBeDefined();
    expect(tokens[background], `--color-${background} is not declared`).toBeDefined();
    expect(contrastRatio(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
  });

  it("focus-ring on cream reaches 3:1", () => {
    const tokens = themeTokens();
    expect(tokens["focus-ring"], "--color-focus-ring is not declared").toBeDefined();
    expect(contrastRatio(tokens["focus-ring"], tokens.cream)).toBeGreaterThanOrEqual(3);
  });
});

describe("KragStage stylesheet", () => {
  function injectedCss(): string {
    return Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
  }

  it("does not declare variables on the global :root", () => {
    render(<KragStage>term</KragStage>);
    expect(injectedCss()).not.toMatch(/:root\s*\{/);
  });

  it("does not inject a global universal-selector rule", () => {
    render(<KragStage>term</KragStage>);
    expect(injectedCss()).not.toMatch(/(^|\})\s*\*\s*[,{]/m);
  });
});

describe("in-scope public pages use theme tokens, not literal colors", () => {
  const IN_SCOPE_FILES = [
    "pages/krag/components/KragStage.tsx",
    "pages/krag/components/TermFooter.tsx",
    "pages/krag/components/termLabels.ts",
    "pages/krag/PublicTermView.tsx",
    "pages/krag/PrivateGroupGate.tsx",
    "pages/krag/GroupVisualization.tsx",
    "components/krag/AccountMergeForm.tsx",
    "components/krag/RequestAccessDialog.tsx",
    "components/krag/ModalSheet.tsx",
    "components/shared/PhoneFrame.tsx",
    "pages/product/ItemTimeline.tsx",
    "pages/organizer/PublicOrganizationPage.tsx",
    "pages/organizer/layouts/types.ts",
    "pages/organizer/layouts/registry.ts",
    "pages/organizer/LayoutRenderer.tsx",
    "pages/organizer/blocks/HeroBlock.tsx",
    "pages/organizer/blocks/ShareButton.tsx",
    "pages/organizer/blocks/ShareBlock.tsx",
    "pages/organizer/blocks/LinkStackBlock.tsx",
    "pages/organizer/blocks/FooterBlock.tsx",
    "pages/organizer/blocks/GhostBlock.tsx",
    "pages/organizer/editor/EditorSheet.tsx",
    "pages/organizer/editor/LayoutTab.tsx",
    "pages/organizer/editor/UnsavedChangesDialog.tsx",
    "pages/organizer/editor/ColorsTab.tsx",
    "pages/organizer/editor/CustomColorPicker.tsx",
    "pages/organizer/editor/PreviewCards.tsx",
    "pages/organizer/blocks/StatsBlock.tsx",
    "pages/organizer/blocks/UpcomingTermsBlock.tsx",
    "pages/organizer/blocks/NextTermCtaBlock.tsx",
    "pages/organizer/blocks/AgendaBlock.tsx",
    "pages/organizer/blocks/AgendaList.tsx",
    "pages/organizer/blocks/CircleFilterChips.tsx",
    "pages/organizer/blocks/CirclesGridBlock.tsx",
    "pages/organizer/blocks/CircleVisualMini.tsx",
    "pages/organizer/blocks/ExchangeCountsBlock.tsx",
    "pages/organizer/blocks/ExchangeBoardBlock.tsx",
    "pages/organizer/blocks/ExchangeItemCard.tsx",
    "pages/organizer/blocks/NeededItemsBlock.tsx",
    "pages/organizer/blocks/EmptyStateBlock.tsx",
    "pages/organizer/blocks/BlockSkeleton.tsx",
    "pages/organizer/blocks/nearestTerm.ts",
    "pages/organizer/PageFrame.tsx",
    "pages/organizer/OrganizerTermsPage.tsx",
  ];
  // Illustration colors that deliberately stay outside the theme (pitch grass, table wood).
  const FIXED_ILLUSTRATION_COLORS = new Set(["#4e9a5f", "#3e8a4e", "#e7cfa8"]);

  it.each(IN_SCOPE_FILES)("%s has no literal hex colors", (file) => {
    const literals = (readSource(file).match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter(
      (hex) => !FIXED_ILLUSTRATION_COLORS.has(hex.toLowerCase()),
    );
    expect(literals).toEqual([]);
  });

  it.each(IN_SCOPE_FILES)("%s reads no unprefixed KragStage variables", (file) => {
    expect(readSource(file)).not.toMatch(/var\(--(cream|paper|ink|ink-soft|mint|mint-soft|sage|sage-soft|teal|teal-soft|lime|line|danger)\)/);
  });
});
