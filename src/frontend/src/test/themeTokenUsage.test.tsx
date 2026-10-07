import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVisualization } from "../pages/krag/GroupVisualization";
import { RequestAccessDialog } from "../components/krag/RequestAccessDialog";

vi.mock("../api/groups", () => ({
  createJoinRequest: vi.fn(),
}));

const SRC = resolve(process.cwd(), "src");

function readSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), "utf8");
}

afterEach(() => {
  cleanup();
});

describe("organizer-themed files use role tokens", () => {
  const NO_HEX_FILES = [
    "pages/product/itemPageShared.ts",
    "pages/product/ItemGallery.tsx",
    "pages/product/ItemGalleryEditor.tsx",
    "pages/product/ItemEditPage.tsx",
  ];

  const NO_LEGACY_UTILITY_FILES = [
    "pages/krag/GroupVisualization.tsx",
    "pages/krag/PrivateGroupGate.tsx",
    "pages/krag/PublicTermView.tsx",
    "pages/krag/components/TermFooter.tsx",
    "components/krag/AccountMergeForm.tsx",
    "components/krag/RequestAccessDialog.tsx",
    "components/krag/ModalSheet.tsx",
    "components/krag/AuthGateSheet.tsx",
    "components/shared/PhoneFrame.tsx",
    "pages/product/ItemTimeline.tsx",
    "pages/product/itemPageShared.ts",
    "pages/product/ItemGallery.tsx",
    "pages/product/ItemGalleryEditor.tsx",
    "pages/product/ItemEditPage.tsx",
    "pages/product/ItemDetailPage.tsx",
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
        neededItemRows={[]}
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

  it("legend 'udostępnia' chip is primary and 'przynosi' chip is teal with ink icon", () => {
    renderCircle();
    const legend = screen.getByTestId("exchange-legend");
    const [shares, brings] = Array.from(legend.querySelectorAll(":scope > span > span"));
    expect(shares).toHaveClass("bg-primary", "text-on-primary");
    expect(brings).toHaveClass("bg-teal", "text-ink");
    expect(brings).not.toHaveClass("text-white");
  });
});

describe("RequestAccessDialog", () => {
  it("renders without the dead kg-modal-overlay class", () => {
    const { container } = render(
      <RequestAccessDialog
        groupId="1"
        groupName="Taniec dla maluchów"
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
        onConflict={vi.fn()}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(container.querySelector(".kg-modal-overlay")).toBeNull();
  });
});
