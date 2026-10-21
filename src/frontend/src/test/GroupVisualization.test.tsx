import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupVisualization, type GroupLayoutMode, type VisualizationFamily } from "../pages/term/components/GroupVisualization";

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
        neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    expect(screen.getByText("Kasia Wójcik")).toBeInTheDocument();
    expect(screen.queryByText("trenerka")).not.toBeInTheDocument();
    expect(screen.queryByText("prowadzi zajęcia")).not.toBeInTheDocument();
  });

  it("TABLE mode renders the needed items as non-interactive chips that don't trigger onSelectFamily", () => {
    const onSelectFamily = vi.fn();
    render(
      <GroupVisualization
        layoutMode="TABLE"
        organizerName="Kasia Wójcik"
        families={FAMILIES}
        neededItemRows={[
          { key: 1, title: "Tamburyn", inlineActions: [] },
          { key: 2, title: "2 koce", inlineActions: [] },
        ]}
        activeFamilyId={null}
        onSelectFamily={onSelectFamily}
        groupId="1"
      />,
    );
    const chips = screen.getByTestId("table-chips");
    expect(chips).toHaveTextContent("Tamburyn");
    expect(chips).toHaveTextContent("2 koce");
    expect(chips.querySelectorAll("button")).toHaveLength(0);
    fireEvent.click(chips);
    expect(onSelectFamily).not.toHaveBeenCalled();
  });

  it("activeFamilyId highlights the correct family in all 3 modes", () => {
    const modes: GroupLayoutMode[] = ["CIRCLE", "PITCH", "TABLE"];
    for (const layoutMode of modes) {
      const { unmount } = render(
        <GroupVisualization
          layoutMode={layoutMode}
          organizerName="Kasia Wójcik"
          families={FAMILIES}
          neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
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
        neededItemRows={[]}
        activeFamilyId={null}
        onSelectFamily={vi.fn()}
        groupId="1"
      />,
    );
    const head = screen.getByText("Kasia Wójcik").parentElement!;
    const scene = screen.getByTestId("table-chips").parentElement!;
    expect(scene).toContainElement(head);
    expect(head.style.left).toBe("50%");
    expect(screen.getByTestId("table-chips")).toHaveTextContent("Tu pojawią się potrzebne rzeczy");
  });
});
