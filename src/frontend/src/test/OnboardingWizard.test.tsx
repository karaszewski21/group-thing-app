import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OnboardingWizard } from "../components/onboarding/OnboardingWizard";
import { guestSteps } from "../components/onboarding/steps/guestSteps";
import { organizerSteps } from "../components/onboarding/steps/organizerSteps";

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
}));
vi.mock("../api/inventories", () => ({
  getInventories: vi.fn(),
  createInventory: vi.fn(),
  registerInventoryItem: vi.fn(),
}));
vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
}));
vi.mock("../api/organizations", () => ({
  createMyOrganization: vi.fn(),
}));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("OnboardingWizard — GUEST single-step config", () => {
  it("guestSteps is a single 'items' step titled 'Co chcesz oddać, wymienić lub wypożyczyć?'", () => {
    expect(guestSteps.map((s) => s.id)).toEqual(["items"]);
    expect(guestSteps.map((s) => s.title)).toEqual([
      "Co chcesz oddać, wymienić lub wypożyczyć?",
    ]);
  });

  it("renders neither the step-dot row nor the 'Krok 1 z 1' status counter", () => {
    const { container } = render(
      <OnboardingWizard steps={guestSteps} onSkip={vi.fn()} onComplete={vi.fn()} />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Krok \d+ z \d+/)).not.toBeInTheDocument();
    expect(container.querySelectorAll("span.h-2\\.5.w-2\\.5")).toHaveLength(0);
  });

  it("primary button reads 'Zakończ ✓' (single step ⇒ isLast)", () => {
    render(<OnboardingWizard steps={guestSteps} onSkip={vi.fn()} onComplete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Zakończ ✓" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dalej →" })).not.toBeInTheDocument();
  });

  it("clicking 'Pomiń' calls onSkip", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={guestSteps} onSkip={onSkip} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Pomiń" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("clicking '✕' calls the same handler as 'Pomiń'", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={guestSteps} onSkip={onSkip} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingWizard — ORGANIZER multi-step chrome", () => {
  it("renders step-dot progress and 'Krok 1 z 3' text with an aria-label", () => {
    const { container } = render(
      <OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />,
    );

    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
    expect(screen.getByText("Krok 1 z 3")).toBeInTheDocument();
    expect(container.querySelectorAll("span.h-2\\.5.w-2\\.5")).toHaveLength(3);
  });

  it("ORGANIZER config renders 3 steps (organization name, circle name, term/schedule) in order", () => {
    expect(organizerSteps.map((s) => s.id)).toEqual(["organization-name", "circle-name", "term"]);
    expect(organizerSteps.map((s) => s.title)).toEqual([
      "Nazwa organizacji",
      "Nazwa grupy",
      "Termin zajęć",
    ]);
  });

  it("ORGANIZER's organization-name step is mandatory: no 'Pomiń'/'X', blocks advancing when empty", async () => {
    render(<OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Pomiń" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zamknij" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() => {
      expect(screen.getByText("Nazwa organizacji jest wymagana")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
  });
});
