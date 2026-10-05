import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import { OnboardingWizard, type Step } from "../components/onboarding/OnboardingWizard";
import { organizerSteps } from "../components/onboarding/steps/organizerSteps";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/groups", () => ({
  createMyCircle: vi.fn(),
}));
vi.mock("../api/organizations", () => ({
  createMyOrganization: vi.fn(),
}));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

const singleStep: Step[] = [{ id: "only", title: "Jedyny krok", render: () => null }];

describe("OnboardingWizard — single-step chrome", () => {
  it("renders neither the step-dot row nor the 'Krok 1 z 1' status counter", () => {
    const { container } = render(
      <OnboardingWizard steps={singleStep} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() },
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/Krok \d+ z \d+/)).not.toBeInTheDocument();
    expect(container.querySelectorAll("span.h-2\\.5.w-2\\.5")).toHaveLength(0);
  });

  it("primary button reads 'Zakończ ✓' (single step ⇒ isLast)", () => {
    render(<OnboardingWizard steps={singleStep} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.getByRole("button", { name: "Zakończ ✓" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dalej →" })).not.toBeInTheDocument();
  });

  it("clicking 'Pomiń' calls onSkip", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={singleStep} onSkip={onSkip} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Pomiń" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("clicking '✕' calls the same handler as 'Pomiń'", () => {
    const onSkip = vi.fn();
    render(<OnboardingWizard steps={singleStep} onSkip={onSkip} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingWizard — ORGANIZER multi-step chrome", () => {
  it("renders step-dot progress and 'Krok 1 z 3' text with an aria-label", () => {
    const { container } = render(
      <OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() },
    );

    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
    expect(screen.getByText("Krok 1 z 3")).toBeInTheDocument();
    expect(container.querySelectorAll("span.h-2\\.5.w-2\\.5")).toHaveLength(3);
  });

  it("the term step has no needed-items section", () => {
    render(<>{organizerSteps[2].render({ setSubmit: vi.fn(), busy: false })}</>, { wrapper: createQueryWrapper() });

    expect(screen.getByLabelText("Data i godzina")).toBeInTheDocument();
    expect(screen.queryByText(/Potrzebne rzeczy/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj potrzebną rzecz/ })).not.toBeInTheDocument();
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
    render(<OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    expect(screen.queryByRole("button", { name: "Pomiń" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zamknij" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    await waitFor(() => {
      expect(screen.getByText("Nazwa organizacji jest wymagana")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
  });
});

describe("OnboardingWizard — step error surfacing", () => {
  it("orgStep_emptyName_showsLocalRequiredMessage", async () => {
    render(<OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nazwa organizacji jest wymagana");
    expect(organizationsApi.createMyOrganization).not.toHaveBeenCalled();
  });

  it("orgStep_apiError400_showsServerMessageAndStaysOnStep", async () => {
    const rejection = "Nazwa organizacji narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(organizationsApi.createMyOrganization).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    render(<OnboardingWizard steps={organizerSteps} onSkip={vi.fn()} onComplete={vi.fn()} />, { wrapper: createQueryWrapper() });

    fireEvent.change(screen.getByLabelText("Nazwa organizacji"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getByRole("button", { name: "Dalej →" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.queryByText(/400 Bad Request/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Krok 1 z 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Nazwa organizacji")).toHaveValue("Zła nazwa");
  });
});
