import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OnboardingWizard } from "../components/onboarding/OnboardingWizard";
import { guestSteps } from "../components/onboarding/steps/guestSteps";
import { organizerSteps } from "../components/onboarding/steps/organizerSteps";
import { createLightweightMembers } from "../api/families";

vi.mock("../api/families", () => ({
  createLightweightMembers: vi.fn().mockResolvedValue({ family: {}, guardians: [] }),
}));
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
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createLightweightMembers).mockResolvedValue({ family: {} as never, guardians: [] });
});

describe("OnboardingWizard", () => {
  it("renders step-dot progress and 'Krok X z N' text with an aria-label", () => {
    render(<OnboardingWizard steps={guestSteps} onSkip={vi.fn()} onComplete={vi.fn()} />);

    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
    expect(screen.getByText("Krok 1 z 3")).toBeInTheDocument();
  });

  it("clicking 'Pomiń' calls onSkip without calling any submit API", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={guestSteps} onSkip={onSkip} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Pomiń" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(createLightweightMembers).not.toHaveBeenCalled();
  });

  it("clicking 'X' calls the same handler as 'Pomiń' without calling any submit API", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={guestSteps} onSkip={onSkip} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(createLightweightMembers).not.toHaveBeenCalled();
  });

  it("GUEST config renders 3 steps (family name, family members, items) in order", () => {
    expect(guestSteps.map((s) => s.id)).toEqual(["family-name", "family-members", "items"]);
    expect(guestSteps.map((s) => s.title)).toEqual([
      "Nazwa rodziny",
      "Członkowie rodziny",
      "Rzeczy, które masz",
    ]);
  });

  it("ORGANIZER config renders 2 steps (circle name, term/schedule) in order", () => {
    expect(organizerSteps.map((s) => s.id)).toEqual(["circle-name", "term"]);
    expect(organizerSteps.map((s) => s.title)).toEqual(["Nazwa grupy", "Termin zajęć"]);
  });

  it("family-members step's 'Usuń' buttons carry distinct per-member aria-labels", () => {
    render(<OnboardingWizard steps={guestSteps} onSkip={vi.fn()} onComplete={vi.fn()} />);

    // advance from step 1 (family name) to step 2 (family members)
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    fireEvent.change(screen.getByLabelText("Imię"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj kolejną osobę" }));
    fireEvent.change(screen.getByLabelText("Imię"), { target: { value: "Tomek" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj kolejną osobę" }));

    expect(screen.getByRole("button", { name: "Usuń Anna" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń Tomek" })).toBeInTheDocument();
  });

  it("submitting the family-members step calls the batch endpoint once with the accumulated draft list", async () => {
    render(<OnboardingWizard steps={guestSteps} onSkip={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    fireEvent.change(screen.getByLabelText("Imię"), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj kolejną osobę" }));
    fireEvent.change(screen.getByLabelText("Imię"), { target: { value: "Tomek" } });
    fireEvent.click(screen.getByRole("button", { name: "Dziecko" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj kolejną osobę" }));

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() => {
      expect(createLightweightMembers).toHaveBeenCalledTimes(1);
    });
    expect(createLightweightMembers).toHaveBeenCalledWith([
      { name: "Anna", role_type: "GUARDIAN" },
      { name: "Tomek", role_type: "CHILD" },
    ]);
  });
});
