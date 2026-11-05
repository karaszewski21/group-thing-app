import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVisualization } from "../features/terms/components/visualization/GroupVisualization";
import type { GroupLayoutMode, VisualizationFamily } from "../features/terms/components/visualization/visualizationTypes";

const FAMILIES: VisualizationFamily[] = [
  { familyId: "1", name: "Rodzina Wiśniewskich" },
  { familyId: "2", name: "Rodzina Kowalskich" },
  { familyId: "3", name: "Rodzina Nowak" },
];

/** Every family avatar button (excludes the "+" invite slot). */
function familyButtons() {
  return screen.getAllByRole("button").filter((b) => b.getAttribute("aria-label") !== "Zaproś kolejną rodzinę");
}

afterEach(() => {
  cleanup();
});

describe("GroupVisualization", () => {
  it("CIRCLE mode renders one avatar button per family", () => {
    render(
      <GroupVisualization
        layoutMode="CIRCLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(familyButtons()).toHaveLength(FAMILIES.length);
  });

  it("PITCH mode renders one avatar button per family", () => {
    render(
      <GroupVisualization
        layoutMode="PITCH"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(familyButtons()).toHaveLength(FAMILIES.length);
  });

  it("TABLE mode renders one avatar button per family", () => {
    render(
      <GroupVisualization
        layoutMode="TABLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(familyButtons()).toHaveLength(FAMILIES.length);
  });

  it("clicking a family avatar calls onSelectFamily with its familyId", () => {
    const onSelectFamily = vi.fn();
    render(
      <GroupVisualization
        layoutMode="CIRCLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={onSelectFamily}
        groupId="1"
      />,
    );
    fireEvent.click(screen.getByLabelText("Rodzina Kowalskich"));
    expect(onSelectFamily).toHaveBeenCalledWith("2");
  });

  it("PITCH mode renders the organizer's name above the pitch, without a role label", () => {
    render(
      <GroupVisualization
        layoutMode="PITCH"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(screen.getByText("Kasia Wójcik")).toBeInTheDocument();
    expect(screen.queryByText("trenerka")).not.toBeInTheDocument();
    expect(screen.queryByText("prowadzi zajęcia")).not.toBeInTheDocument();
  });

  it("activeFamilyId highlights the correct family in all 3 modes", () => {
    const modes: GroupLayoutMode[] = ["CIRCLE", "PITCH", "TABLE"];
    for (const layoutMode of modes) {
      const { unmount } = render(
        <GroupVisualization
          layoutMode={layoutMode}
          organizerName="Kasia Wójcik"
          families={FAMILIES}
          activeFamilyId="2"
          onSelectFamily={vi.fn()}
          groupId="1"
        />,
      );
      expect(screen.getByLabelText("Rodzina Kowalskich")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Rodzina Wiśniewskich")).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByLabelText("Rodzina Nowak")).toHaveAttribute("aria-pressed", "false");
      unmount();
    }
  });

  it("renders the exchange-legend once beneath the visualization regardless of layoutMode", () => {
    render(
      <GroupVisualization
        layoutMode="TABLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(screen.getAllByTestId("exchange-legend")).toHaveLength(1);
    expect(screen.getByText("udostępnia rzecz")).toBeInTheDocument();
    expect(screen.getByText("przynosi na zajęcia")).toBeInTheDocument();
  });

  it.each([
    ["CIRCLE", 8],
    ["PITCH", 6],
    ["TABLE", 8],
  ] as const)("%s with nobody signed up draws %i dashed seats and says so", (layoutMode, seats) => {
    const { container } = render(
      <GroupVisualization
        layoutMode={layoutMode}
        organizerName="Kasia Wójcik"
        families={[]}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(container.querySelectorAll("[data-ghost-seat]")).toHaveLength(seats);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Nikt się jeszcze nie zapisał")).toBeInTheDocument();
  });

  it("draws no dashed seats and no empty caption once someone signed up", () => {
    const { container } = render(
      <GroupVisualization
        layoutMode="CIRCLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(container.querySelectorAll("[data-ghost-seat]")).toHaveLength(0);
    expect(screen.queryByText("Nikt się jeszcze nie zapisał")).not.toBeInTheDocument();
  });

  it("TABLE seats the organizer at the head of the table, in the same scene as the families", () => {
    render(
      <GroupVisualization
        layoutMode="TABLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    const head = screen.getByText("Kasia Wójcik").parentElement!;
    const scene = screen.getByTestId("table-top").parentElement!;
    expect(scene).toContainElement(head);
    expect(head.style.left).toBe("50%");
  });
});
