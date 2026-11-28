import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { VerifyEmailBanner } from "../features/email/VerifyEmailBanner";
import { withQueryClient } from "./queryClient";

vi.mock("../api/auth", () => ({
  requestEmailVerification: vi.fn(),
  confirmEmailVerification: vi.fn(),
}));

const EMAIL = "ania.kowalska@example.pl";

function renderBanner(emailVerified: boolean | null) {
  return render(withQueryClient(<VerifyEmailBanner emailVerified={emailVerified} email={EMAIL} />));
}

describe("VerifyEmailBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each<[boolean | null, boolean]>([
    [false, true],
    [true, false],
    [null, false],
  ])("for email_verified %s shows the banner: %s", (emailVerified, shown) => {
    renderBanner(emailVerified);

    const heading = screen.queryByRole("heading", { name: "Potwierdź swój adres e-mail" });
    if (shown) {
      expect(heading).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Potwierdź adres, żebyśmy mogli wysyłać Ci ważne wiadomości.");
      expect(screen.getByRole("button", { name: "Wyślij link" })).not.toHaveAttribute("aria-disabled");
      expect(screen.queryByRole("button", { name: /Zamknij/ })).not.toBeInTheDocument();
    } else {
      expect(heading).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    }
  });

  it("shows the sent copy with an aria-disabled resend during the cooldown", async () => {
    vi.mocked(authApi.requestEmailVerification).mockResolvedValue(undefined);
    renderBanner(false);

    fireEvent.click(screen.getByRole("button", { name: "Wyślij link" }));

    expect(await screen.findByRole("heading", { name: "Sprawdź skrzynkę" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      `Wysłaliśmy link na ${EMAIL}. Kliknij go, żeby potwierdzić adres.`,
    );
    const resend = screen.getByRole("button", { name: "Wyślij ponownie" });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(resend);
    expect(authApi.requestEmailVerification).toHaveBeenCalledTimes(1);
  });

  it("shows the failure alert and keeps the send action", async () => {
    vi.mocked(authApi.requestEmailVerification).mockRejectedValue(new Error("network"));
    renderBanner(false);

    fireEvent.click(screen.getByRole("button", { name: "Wyślij link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wysłać linku. Spróbuj ponownie.");
    expect(screen.getByRole("heading", { name: "Potwierdź swój adres e-mail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wyślij link" })).not.toHaveAttribute("aria-disabled");
  });
});
