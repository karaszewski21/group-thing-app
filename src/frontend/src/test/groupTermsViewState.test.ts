import { describe, expect, it } from "vitest";
import type { OrganizationGroupTermsResponse, PublicOrganizationResponse } from "../api/organizations";
import { GROUP_TERMS_LOAD_ERROR, resolveGroupTermsView } from "../features/group-terms/groupTermsViewState";
import { layoutGroup } from "./organizationLayoutFixtures";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: "orlik",
  name: "Orlik",
  primary_color: null,
  accent_color: null,
  page_layout: "SCHEDULE",
  palette_preset: null,
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
};
const PAGE: OrganizationGroupTermsResponse = {
  owner: { party_id: "p-1", display_name: "Orlik", slug: "orlik" },
  group: layoutGroup("g-1"),
  terms: [],
};

const idle = { data: null, loading: false, notFound: false, error: null };
const orgRead = (overrides = {}) => ({ ...idle, data: ORGANIZATION, ...overrides });
const groupRead = (overrides = {}) => ({ ...idle, data: PAGE, ...overrides });

describe("resolveGroupTermsView", () => {
  it.each([
    ["both loading", orgRead({ data: null, loading: true }), groupRead({ data: null, loading: true }), { kind: "loading" }],
    ["group still loading", orgRead(), groupRead({ data: null, loading: true }), { kind: "loading" }],
    ["organization 404", orgRead({ data: null, notFound: true }), groupRead({ data: null, loading: true }), { kind: "notFound" }],
    ["group 404", orgRead(), groupRead({ data: null, notFound: true }), { kind: "notFound" }],
    [
      "organization error",
      orgRead({ data: null, error: "boom" }),
      groupRead(),
      { kind: "error", message: GROUP_TERMS_LOAD_ERROR },
    ],
    ["group error", orgRead(), groupRead({ data: null, error: "boom" }), { kind: "error", message: GROUP_TERMS_LOAD_ERROR }],
    [
      "stale data through a failed refresh",
      orgRead(),
      groupRead({ error: "boom" }),
      { kind: "content", organization: ORGANIZATION, page: PAGE },
    ],
    ["both loaded", orgRead(), groupRead(), { kind: "content", organization: ORGANIZATION, page: PAGE }],
  ])("%s", (_name, organization, group, expected) => {
    expect(resolveGroupTermsView({ organization, group })).toEqual(expected);
  });
});
