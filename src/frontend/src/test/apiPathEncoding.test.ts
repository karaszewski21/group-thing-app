import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { getItemDetails, getItemHistory } from "../api/items";
import { getPublicOrganization } from "../api/organizations";

vi.mock("../api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

describe("API path segment encoding", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.get).mockResolvedValue({});
  });

  it("getPublicOrganization_traversalSlug_isEncodedAsSingleSegment", async () => {
    await getPublicOrganization("../x");

    expect(api.get).toHaveBeenCalledWith("/organizations/public/..%2Fx");
  });

  it("getPublicOrganization_normalSlug_isUnchanged", async () => {
    await getPublicOrganization("fundacja-krag");

    expect(api.get).toHaveBeenCalledWith("/organizations/public/fundacja-krag");
  });

  it("itemHelpers_traversalId_isEncodedAsSingleSegment", async () => {
    await getItemDetails("../../admin");
    await getItemHistory("1/x");

    expect(api.get).toHaveBeenCalledWith("/inventory-items/..%2F..%2Fadmin/details");
    expect(api.get).toHaveBeenCalledWith("/inventory-items/1%2Fx/history");
  });
});
