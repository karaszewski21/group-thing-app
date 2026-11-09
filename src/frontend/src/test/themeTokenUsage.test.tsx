import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVisualization } from "../features/terms/components/visualization/GroupVisualization";
import { JoinByCodeSheet } from "../features/terms/modals/JoinByCodeSheet";

const SRC = resolve(process.cwd(), "src");

function readSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

afterEach(() => {
  cleanup();
});

describe("organizer-themed files use role tokens", () => {
  const ORGANIZER_PAGE_FILES = [
    "features/owner-page/layouts/types.ts",
    "features/owner-page/layouts/registry.ts",
    "features/owner-page/LayoutRenderer.tsx",
    "features/owner-page/blocks/HeroBlock.tsx",
    "features/owner-page/blocks/ShareButton.tsx",
    "features/owner-page/blocks/ShareBlock.tsx",
    "features/owner-page/blocks/LinkStackBlock.tsx",
    "features/owner-page/blocks/FooterBlock.tsx",
    "features/owner-page/blocks/GhostBlock.tsx",
    "features/owner-page/blocks/GalleryBlock.tsx",
    "features/owner-page/editor/PhotosTab.tsx",
    "features/owner-page/PublicOrganizationPage.tsx",
    "features/owner-page/editor/draft.ts",
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
    "features/owner-page/blocks/RecentItemsBlock.tsx",
    "features/owner-page/blocks/NeededItemsBlock.tsx",
    "features/owner-page/blocks/EmptyStateBlock.tsx",
    "features/owner-page/blocks/BlockSkeleton.tsx",
    "features/owner-page/blocks/nearestTerm.ts",
    "features/owner-page/PageFrame.tsx",
    "features/owner-page/OrganizerTermsPage.tsx",
  ];

  const NO_HEX_FILES = [
    "features/product/itemPageShared.ts",
    "features/product/ItemGallery.tsx",
    "features/product/ItemGalleryEditor.tsx",
    "components/shared/PhotoGalleryField.tsx",
    "features/product/ItemEditForm.tsx",
    "components/shared/AddToCalendarButton.tsx",
    "components/shared/PhotoViewer.tsx",
    "components/layout/pending/PendingActionsHost.tsx",
    "features/product/TakeSuccessSheet.tsx",
    "features/items/SwapAcceptSuccessSheet.tsx",
    "features/messages/InboxPage.tsx",
    "features/messages/ThreadPage.tsx",
    "features/messages/MessageBubble.tsx",
    "features/messages/MessageComposer.tsx",
    ...ORGANIZER_PAGE_FILES,
  ];

  const NO_LEGACY_UTILITY_FILES = [
    "features/terms/components/visualization/GroupVisualization.tsx",
    "features/terms/components/visualization/CircleLayout.tsx",
    "features/terms/components/visualization/PitchLayout.tsx",
    "features/terms/components/visualization/TableLayout.tsx",
    "features/terms/components/visualization/FamilySlot.tsx",
    "features/terms/components/visualization/GhostSeat.tsx",
    "features/terms/components/visualization/OrganizerAvatar.tsx",
    "features/terms/views/PrivateTermView.tsx",
    "features/terms/blocks/TermChats.tsx",
    "features/terms/blocks/TermDescription.tsx",
    "features/terms/blocks/TermLocation.tsx",
    "features/terms/blocks/TermVisualization.tsx",
    "features/terms/TermPage.tsx",
    "components/shared/SignUpFooter.tsx",
    "features/terms/components/termLabels.ts",
    "features/terms/modals/JoinByCodeSheet.tsx",
    "features/terms/components/CodeDigitsInput.tsx",
    "components/shared/ModalSheet.tsx",
    "features/auth/AuthSheet.tsx",
    "components/shared/PhoneFrame.tsx",
    "components/shared/AddToCalendarButton.tsx",
    "components/shared/PhotoViewer.tsx",
    "components/layout/pending/PendingActionsHost.tsx",
    "features/product/TakeSuccessSheet.tsx",
    "features/items/SwapAcceptSuccessSheet.tsx",
    "features/product/blocks/ItemStatus.tsx",
    "features/product/itemPageShared.ts",
    "features/product/ItemGallery.tsx",
    "features/product/ItemGalleryEditor.tsx",
    "components/shared/PhotoGalleryField.tsx",
    "features/product/ItemEditForm.tsx",
    "features/product/ItemPage.tsx",
    "features/product/blocks/ItemChatButton.tsx",
    "features/product/blocks/ItemDescription.tsx",
    "features/product/blocks/ItemHeader.tsx",
    "features/product/blocks/ItemHero.tsx",
    "features/product/blocks/ItemLocation.tsx",
    "features/product/blocks/ItemOwner.tsx",
    "features/product/blocks/ItemPickupActions.tsx",
    "features/product/blocks/ItemPickupPlaces.tsx",
    ...ORGANIZER_PAGE_FILES,
  ];

  it.each(NO_HEX_FILES)("%s has no literal hex colors", (file) => {
    expect(readSource(file).match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
  });

  it.each(NO_LEGACY_UTILITY_FILES)("%s uses no mint/lime utilities", (file) => {
    const source = readSource(file);
    expect(source).not.toMatch(/\b(bg|text|ring|border|stroke|fill)-(mint|lime)/);
    expect(source).not.toMatch(/\[var\(--(mint|lime)/);
  });
});

describe("GroupVisualization exchange colors", () => {
  function renderCircle() {
    return render(
      <GroupVisualization
        layoutMode="CIRCLE"
        organizerName="Kasia Wójcik"
        families={[
          { familyId: "1", name: "Rodzina Wiśniewskich" },
          { familyId: "2", name: "Rodzina Kowalskich" },
        ]}
        activeFamilyId="1"
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
  }

  it("spokes use role stroke classes, not literal stroke attributes", () => {
    const { container } = renderCircle();
    const spokes = Array.from(container.querySelectorAll("line"));
    expect(spokes).toHaveLength(2);
    expect(spokes.map((line) => line.getAttribute("class"))).toEqual(["stroke-primary", "stroke-line-strong"]);
    for (const line of spokes) expect(line.hasAttribute("stroke")).toBe(false);
  });

  it("legend 'udostępnia' chip is accent and 'przynosi' chip is teal with ink icon", () => {
    renderCircle();
    const legend = screen.getByTestId("exchange-legend");
    const [shares, brings] = Array.from(legend.querySelectorAll(":scope > span > span"));
    expect(shares).toHaveClass("bg-accent", "text-ink");
    expect(brings).toHaveClass("bg-teal", "text-ink");
    expect(brings).not.toHaveClass("text-white");
  });
});

describe("JoinByCodeSheet", () => {
  it("renders without the dead kg-modal-overlay class", () => {
    const { container } = render(
      <JoinByCodeSheet initialCode="" autoSubmit={false} onSubmit={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(container.querySelector(".kg-modal-overlay")).toBeNull();
  });
});
