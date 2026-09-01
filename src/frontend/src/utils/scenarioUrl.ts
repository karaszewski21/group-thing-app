export interface ScenarioInput {
  asOf?: string;
  materialWeightKg?: number;
  supplierDistanceKm?: number;
  destinationDistanceKm?: number;
  lastMileDistanceKm?: number;
  storageDays?: number;
  requiresRefrigeration?: boolean;
  unit?: "TOTAL" | "PER_100G";
}

export function encodeScenario(scenario: ScenarioInput): string {
  return btoa(JSON.stringify(scenario));
}

export function decodeScenario(encoded: string): ScenarioInput | null {
  try {
    const json = atob(encoded);
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ScenarioInput;
  } catch {
    return null;
  }
}
