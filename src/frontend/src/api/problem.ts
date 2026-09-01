import { ApiError } from "./client";

export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
}

export function isProblemDetail(body: unknown): body is ProblemDetail {
  if (body === null || typeof body !== "object") return false;
  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.detail === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}

// Kernel-wide GlobalExceptionHandler envelope (not RFC 7807): emitted for
// validation failures outside the footprint package's own scoped handler.
// Shape: { status, error, message, fieldErrors?: Record<string, string>, timestamp }.
interface LegacyErrorEnvelope {
  message: string;
  fieldErrors?: Record<string, string>;
}

function isLegacyErrorEnvelope(body: unknown): body is LegacyErrorEnvelope {
  if (body === null || typeof body !== "object") return false;
  const c = body as Record<string, unknown>;
  return typeof c.message === "string";
}

export function extractProblemMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (isProblemDetail(err.body)) {
      return err.body.detail;
    }
    if (isLegacyErrorEnvelope(err.body)) {
      const fields = err.body.fieldErrors;
      if (fields && Object.keys(fields).length > 0) {
        const pairs = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
        return `${err.body.message}: ${pairs.join("; ")}`;
      }
      return err.body.message;
    }
    const statusText = err.statusText || "Request failed";
    return `${statusText} (HTTP ${err.status})`;
  }
  return "Network error — check connection";
}
