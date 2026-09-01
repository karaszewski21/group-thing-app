import { ApiError, api } from "./client";

export type Normalisation = "TOTAL" | "PER_100G";
export type Strictness = "STRICT" | "LENIENT";
export type Unit = "KG_CO2" | "KG_CO2_PER_100G";
export type Scope = 1 | 2 | 3;

export interface WarningDto {
  code: string;
  message: string;
  componentId: string | null;
}

export interface CompositeDto {
  type: "composite";
  componentId: string;
  kgCo2: number;
  children: BreakdownDto[];
  warnings: WarningDto[];
}

export interface LeafDto {
  type: "leaf";
  componentId: string;
  kgCo2: number;
  scope: Scope;
  factorVersionId: string;
  factorRate: number;
  factorValidFrom: string;
  quantity: number;
  warnings: WarningDto[];
}

export type BreakdownDto = CompositeDto | LeafDto;

export interface ParametersEcho {
  productId: string;
  materialWeightKg: number | null;
  supplierDistanceKm: number | null;
  destinationDistanceKm: number | null;
  lastMileDistanceKm: number | null;
  storageDays: number;
  requiresRefrigeration: boolean;
  timestamp: string;
}

export interface OptionsEcho {
  strictness: Strictness;
  normalisation: Normalisation;
  dryRun: boolean;
}

export interface FootprintResponse {
  correlationId: string;
  comparisonGroupId: string | null;
  computedAt: string;
  total: number;
  unit: Unit;
  parametersEcho: ParametersEcho;
  options: OptionsEcho;
  breakdown: BreakdownDto;
}

export interface FootprintQueryInput {
  asOf?: string;
  materialWeightKg?: number;
  supplierDistanceKm?: number;
  destinationDistanceKm?: number;
  lastMileDistanceKm?: number;
  storageDays?: number;
  requiresRefrigeration?: boolean;
  unit?: Normalisation;
  strictness?: Strictness;
  dryRun?: boolean;
}

export interface FootprintRequestHeaders {
  comparisonGroupId?: string;
  correlationId?: string;
}

/**
 * Backend BreakdownDto is a sealed interface with no `type` field on the wire.
 * Tag by structure so consumers can narrow with the discriminator.
 * Idempotent: re-tagging a tree with existing tags is a no-op.
 */
export function tagBreakdown(node: BreakdownDto): BreakdownDto {
  if ("children" in node && Array.isArray((node as CompositeDto).children)) {
    const composite = node as CompositeDto;
    composite.type = "composite";
    for (let i = 0; i < composite.children.length; i++) {
      composite.children[i] = tagBreakdown(composite.children[i]);
    }
    return composite;
  }
  (node as LeafDto).type = "leaf";
  return node;
}

// Backend `asOf` is a java.time.Instant. The frontend date input emits
// `YYYY-MM-DD`; coerce date-only values to UTC midnight so Jackson can parse.
// Already-formatted instants (contain 'T') pass through unchanged.
function normaliseAsOf(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

function buildQueryString(query?: FootprintQueryInput): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const serialised = key === "asOf" ? normaliseAsOf(String(value)) : String(value);
    params.set(key, serialised);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export function getProductFootprint(
  productId: string,
  query?: FootprintQueryInput,
  headers?: FootprintRequestHeaders,
): Promise<FootprintResponse> {
  const path = `/products/${productId}/footprint${buildQueryString(query)}`;
  const requestHeaders: Record<string, string> = {};
  if (headers?.comparisonGroupId) {
    requestHeaders["X-Comparison-Group"] = headers.comparisonGroupId;
  }
  if (headers?.correlationId) {
    requestHeaders["X-Correlation-Id"] = headers.correlationId;
  }
  const opts = Object.keys(requestHeaders).length
    ? { headers: requestHeaders }
    : undefined;
  return api
    .get<FootprintResponse>(path, undefined, opts)
    .then((response) => {
      response.breakdown = tagBreakdown(response.breakdown);
      return response;
    });
}

/**
 * CSV export needs a Blob, which the JSON `api` client cannot produce.
 * Mirror the minimal request shape from client.ts (Bearer from localStorage,
 * ApiError on non-2xx) without adding a speculative helper to the shared client.
 */
export async function getFootprintCsvExport(correlationId: string): Promise<Blob> {
  const url = `/api/footprints/calculations/${correlationId}/export?format=csv`;
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text();
    }
    throw new ApiError(response.status, response.statusText, body);
  }
  return response.blob();
}
