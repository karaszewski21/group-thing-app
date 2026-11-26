import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGoogleNonce } from "../api/auth";
import { ApiError } from "../api/client";

const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("auth API", () => {
  it("getGoogleNonce_post_sendsEmptyBodyAndReturnsNonce", async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ nonce: "nonce-123" }), { status: 200 }));

    await expect(getGoogleNonce()).resolves.toBe("nonce-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/google/nonce");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it("getGoogleNonce_unavailable_returnsNullAndRethrowsOtherErrors", async () => {
    const unavailable = { status: 503, error: "Service Unavailable", message: "Logowanie przez Google jest niedostępne." };
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(unavailable), { status: 503 }));
    await expect(getGoogleNonce()).resolves.toBeNull();

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    const failure = getGoogleNonce();
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
  });
});
