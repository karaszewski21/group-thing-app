import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");

function readSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

/** Every `--color-<name>: #rrggbb` declared in app/globals.css `@theme` blocks. */
function themeTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of readSource("app/globals.css").matchAll(/--color-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) {
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

describe("in-scope public pages use theme tokens, not literal colors", () => {
  const IN_SCOPE_FILES = [
    "features/terms/components/TermFooter.tsx",
    "features/terms/components/termLabels.ts",
    "features/terms/views/PublicTermView.tsx",
    "features/terms/views/PrivateTermView.tsx",
    "features/terms/components/GroupVisualization.tsx",
    "features/auth/AuthSheet.tsx",
    "features/terms/modals/JoinByCodeSheet.tsx",
    "features/terms/components/CodeDigitsInput.tsx",
    "components/shared/ModalSheet.tsx",
    "components/shared/PhoneFrame.tsx",
    "features/product/blocks/ItemStatus.tsx",
    "features/owner-page/PublicOrganizationPage.tsx",
    "features/owner-page/layouts/types.ts",
    "features/owner-page/layouts/registry.ts",
    "features/owner-page/LayoutRenderer.tsx",
    "features/owner-page/blocks/HeroBlock.tsx",
    "features/owner-page/blocks/ShareButton.tsx",
    "features/owner-page/blocks/ShareBlock.tsx",
    "features/owner-page/blocks/LinkStackBlock.tsx",
    "features/owner-page/blocks/FooterBlock.tsx",
    "features/owner-page/blocks/GhostBlock.tsx",
    "features/owner-page/OrganizationAppearancePage.tsx",
    "features/owner-page/editor/LayoutTab.tsx",
    "features/owner-page/editor/UnsavedChangesDialog.tsx",
    "features/owner-page/editor/ColorsTab.tsx",
    "features/owner-page/editor/PreviewCards.tsx",
    "features/owner-page/blocks/StatsBlock.tsx",
    "features/owner-page/blocks/UpcomingTermsBlock.tsx",
    "features/owner-page/blocks/NextTermCtaBlock.tsx",
    "features/owner-page/blocks/AgendaBlock.tsx",
    "features/owner-page/blocks/AgendaList.tsx",
    "features/owner-page/blocks/CircleFilterChips.tsx",
    "features/owner-page/blocks/CirclesGridBlock.tsx",
    "features/owner-page/blocks/CircleVisualMini.tsx",
    "features/owner-page/blocks/ExchangeCountsBlock.tsx",
    "features/owner-page/blocks/ExchangeBoardBlock.tsx",
    "features/owner-page/blocks/ExchangeItemCard.tsx",
    "features/owner-page/blocks/NeededItemsBlock.tsx",
    "features/owner-page/blocks/EmptyStateBlock.tsx",
    "features/owner-page/blocks/BlockSkeleton.tsx",
    "features/owner-page/blocks/nearestTerm.ts",
    "features/owner-page/PageFrame.tsx",
    "features/owner-page/OrganizerTermsPage.tsx",
  ];
  // Illustration colors that deliberately stay outside the theme (pitch grass, table wood).
  const FIXED_ILLUSTRATION_COLORS = new Set(["#4e9a5f", "#3e8a4e", "#e7cfa8"]);

  it.each(IN_SCOPE_FILES)("%s has no literal hex colors", (file) => {
    const literals = (readSource(file).match(/#[0-9a-fA-F]{6}\b/g) ?? []).filter(
      (hex) => !FIXED_ILLUSTRATION_COLORS.has(hex.toLowerCase()),
    );
    expect(literals).toEqual([]);
  });

  it.each(IN_SCOPE_FILES)("%s reads no unprefixed theme variables", (file) => {
    expect(readSource(file)).not.toMatch(/var\(--(cream|paper|ink|ink-soft|mint|mint-soft|sage|sage-soft|teal|teal-soft|lime|line|danger)\)/);
  });
});
