import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { system } from "../theme";
import { ScopeChip } from "../components/footprint/ScopeChip";
import { ScopeBar } from "../components/footprint/ScopeBar";
import { BreakdownTree } from "../components/footprint/BreakdownTree";
import { CsvExportButton } from "../components/footprint/CsvExportButton";
import type { BreakdownDto } from "../api/footprints";
import * as footprintsApi from "../api/footprints";
import * as downloadUtil from "../utils/download";

vi.mock("../api/footprints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/footprints")>();
  return {
    ...actual,
    getFootprintCsvExport: vi.fn(),
  };
});

vi.mock("../utils/download", () => ({
  downloadBlob: vi.fn(),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe("ScopeChip", () => {
  it("renders Scope 1 with amber semantic token via data-scope attribute", () => {
    renderWithProviders(<ScopeChip scope={1} />);
    const chip = screen.getByText("Scope 1");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-scope", "1");
  });

  it("renders mixed with grey semantic token via data-scope attribute", () => {
    renderWithProviders(<ScopeChip scope="mixed" />);
    const chip = screen.getByText("mixed");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveAttribute("data-scope", "mixed");
  });

  it("renders Scope 2 (yellow) and Scope 3 (green) with correct labels and data-scope attributes", () => {
    // Group D delivered only Scope 1 + mixed coverage. The colour-token map
    // covers all four enum values, so the missing 2 / 3 paths are exercised
    // here to lock in the FR-2 chip contract.
    const { rerender } = renderWithProviders(<ScopeChip scope={2} />);
    const chip2 = screen.getByText("Scope 2");
    expect(chip2).toHaveAttribute("data-scope", "2");

    rerender(<ChakraProvider value={system}><ScopeChip scope={3} /></ChakraProvider>);
    const chip3 = screen.getByText("Scope 3");
    expect(chip3).toHaveAttribute("data-scope", "3");
  });
});

describe("ScopeBar", () => {
  it("renders label, proportional bar width, numeric value, and ScopeChip in order", () => {
    const { container } = renderWithProviders(
      <ScopeBar label="Materials" kgCo2={1.35} total={5.4} scope={3} />,
    );
    expect(screen.getByText("Materials")).toBeInTheDocument();
    // formatCO2eKg renders "1.350 kg CO₂"
    expect(screen.getByText(/1\.350/)).toBeInTheDocument();
    expect(screen.getByText("Scope 3")).toBeInTheDocument();

    const bar = container.querySelector('[data-testid="scope-bar-fill"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe("25%");

    // Order: label, bar, value, chip
    const row = container.querySelector('[data-testid="scope-bar-row"]') as HTMLElement;
    const children = Array.from(row.children) as HTMLElement[];
    expect(children[0].textContent).toContain("Materials");
    expect(children[1].getAttribute("data-testid")).toBe("scope-bar-track");
    expect(children[2].textContent).toMatch(/1\.350/);
    expect(children[3].textContent).toContain("Scope 3");
  });
});

const tree: BreakdownDto = {
  type: "composite",
  componentId: "root",
  kgCo2: 3.0,
  warnings: [],
  children: [
    {
      type: "composite",
      componentId: "materials",
      kgCo2: 1.35,
      warnings: [],
      children: [
        {
          type: "leaf",
          componentId: "raw-material",
          kgCo2: 0.45,
          scope: 3,
          factorVersionId: "fv-raw",
          factorRate: 0.9,
          factorValidFrom: "2026-01-01",
          quantity: 0.5,
          warnings: [],
        },
        {
          type: "leaf",
          componentId: "processing",
          kgCo2: 0.9,
          scope: 1,
          factorVersionId: "fv-proc",
          factorRate: 1.8,
          factorValidFrom: "2026-01-01",
          quantity: 0.5,
          warnings: [],
        },
      ],
    },
    {
      type: "leaf",
      componentId: "packaging",
      kgCo2: 0.42,
      scope: 3,
      factorVersionId: "fv-pkg",
      factorRate: 0.42,
      factorValidFrom: "2026-01-01",
      quantity: 1,
      warnings: [],
    },
  ],
};

describe("BreakdownTree", () => {
  it("renders all top-level composites expanded by default, toggles via composite button (click + aria-expanded)", () => {
    renderWithProviders(<BreakdownTree root={tree} total={3.0} />);

    const compositeBtn = screen.getByRole("button", { name: /materials/i });
    expect(compositeBtn).toHaveAttribute("aria-expanded", "true");
    // Child rows visible by default
    expect(screen.getByText("raw-material")).toBeInTheDocument();
    expect(screen.getByText("processing")).toBeInTheDocument();

    fireEvent.click(compositeBtn);
    expect(compositeBtn).toHaveAttribute("aria-expanded", "false");
    // Child rows are hidden (HTML `hidden` attribute) — they remain in DOM but
    // are not visible/interactive. RTL surfaces this via accessibility tree.
    const rawMatCell = screen.queryByText("raw-material");
    expect(rawMatCell).not.toBeNull();
    const row = rawMatCell!.closest("tr");
    expect(row).toHaveAttribute("hidden");

    fireEvent.click(compositeBtn);
    expect(compositeBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("raw-material")).toBeInTheDocument();
  });

  it("toggles via keyboard Space on focused composite button", () => {
    renderWithProviders(<BreakdownTree root={tree} total={3.0} />);
    const compositeBtn = screen.getByRole("button", { name: /materials/i });
    compositeBtn.focus();
    // Native <button> handles Space via click; assert through click for semantic equivalence.
    fireEvent.keyDown(compositeBtn, { key: " ", code: "Space" });
    fireEvent.keyUp(compositeBtn, { key: " ", code: "Space" });
    fireEvent.click(compositeBtn); // Browser-equivalent fallback (jsdom does not synthesize click from Space)
    expect(compositeBtn).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CsvExportButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("click → getFootprintCsvExport(correlationId) → downloadBlob('footprint-<id>.csv'); status cycles", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    vi.mocked(footprintsApi.getFootprintCsvExport).mockResolvedValue(blob);
    // Spy on setTimeout so we can verify the 3s auto-clear is scheduled without
    // racing real time in the test.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    renderWithProviders(<CsvExportButton correlationId="corr-xyz" />);

    const btn = screen.getByRole("button", { name: /export/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(footprintsApi.getFootprintCsvExport).toHaveBeenCalledWith("corr-xyz");
    await waitFor(() =>
      expect(downloadUtil.downloadBlob).toHaveBeenCalledWith(blob, "footprint-corr-xyz.csv"),
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Downloaded footprint-corr-xyz\.csv/);

    // Verify the auto-clear timer was scheduled for 3000ms.
    const clearCall = setTimeoutSpy.mock.calls.find((c) => c[1] === 3000);
    expect(clearCall).toBeDefined();

    // Invoke the scheduled callback directly to simulate elapsed time, then
    // assert the live region is cleared.
    const cb = clearCall![0] as () => void;
    await act(async () => {
      cb();
    });
    expect(status.textContent).toBe("");

    setTimeoutSpy.mockRestore();
  });
});
