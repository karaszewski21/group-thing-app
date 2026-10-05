import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import * as termsApi from "../api/terms";
import { ApiError } from "../api/client";
import { FirstTermStepperOrganizer } from "../components/panel/FirstTermStepperOrganizer";

vi.mock("../api/terms", () => ({ createTerm: vi.fn() }));

function renderStepper(onDone = vi.fn()) {
  render(
    <MemoryRouter>
      <FirstTermStepperOrganizer onClose={vi.fn()} circleGroupId="g-1" organizerSlug={null} onDone={onDone} />
    </MemoryRouter>,
  );
  return onDone;
}

function submit(description: string) {
  fireEvent.change(screen.getByLabelText("Data i godzina"), { target: { value: "2026-10-10T10:00" } });
  fireEvent.change(screen.getByLabelText("Opis (opcjonalnie)"), { target: { value: description } });
  fireEvent.click(screen.getByRole("button", { name: "Dodaj termin" }));
}

describe("FirstTermStepperOrganizer — server error message", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the server's 400 moderation message in role=alert and keeps the form", async () => {
    const message = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.createTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message }),
    );
    const onDone = renderStepper();
    submit("zły opis");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Opis (opcjonalnie)")).toHaveValue("zły opis");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to the generic Polish message for a non-domain error", async () => {
    vi.mocked(termsApi.createTerm).mockRejectedValue(new ApiError(500, "Server Error", null));
    renderStepper();
    submit("opis");

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać terminu — spróbuj ponownie");
  });
});
