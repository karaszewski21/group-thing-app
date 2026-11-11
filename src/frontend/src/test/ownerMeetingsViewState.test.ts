import { describe, expect, it } from "vitest";
import type { OwnerNearestDate } from "../api/ownerItems";
import type { PublicOrganizationResponse } from "../api/organizations";
import { OWNER_MEETINGS_LOAD_ERROR, resolveOwnerMeetingsView } from "../features/meetings/ownerMeetingsViewState";
import type { OwnerRef } from "../hooks/useOwnerItems";

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
const ORG_REF: OwnerRef = { kind: "organization", slug: "orlik" };
const PARTY_REF: OwnerRef = { kind: "party", partyId: "p-1" };
const PERSON = { party_id: "p-1", display_name: "Ania", slug: null };
const ORG_OWNER = { party_id: "p-1", display_name: "Orlik", slug: "orlik" };
const MEETING: OwnerNearestDate = {
  kind: "EVENT",
  id: "e1",
  name: "Piknik",
  starts_at: "2026-11-14T10:00:00",
  location_name: null,
  attendee_count: 0,
  path: "/orlik/event/e1",
};

const orgRead = (overrides = {}) => ({ data: ORGANIZATION, loading: false, notFound: false, error: null, ...overrides });
const meetingsRead = (overrides = {}) => ({
  owner: PERSON,
  meetings: [MEETING],
  loading: false,
  notFound: false,
  error: null,
  ...overrides,
});

describe("resolveOwnerMeetingsView", () => {
  it.each([
    ["organization loading", ORG_REF, orgRead({ data: null, loading: true }), meetingsRead(), { kind: "loading" }],
    ["organization 404", ORG_REF, orgRead({ data: null, notFound: true }), meetingsRead(), { kind: "notFound" }],
    [
      "organization error",
      ORG_REF,
      orgRead({ data: null, error: "boom" }),
      meetingsRead(),
      { kind: "error", message: OWNER_MEETINGS_LOAD_ERROR },
    ],
    ["meetings loading", PARTY_REF, null, meetingsRead({ owner: null, loading: true }), { kind: "loading" }],
    ["meetings 404", PARTY_REF, null, meetingsRead({ owner: null, notFound: true }), { kind: "notFound" }],
    [
      "meetings error",
      ORG_REF,
      orgRead(),
      meetingsRead({ owner: null, error: "boom" }),
      { kind: "error", message: OWNER_MEETINGS_LOAD_ERROR },
    ],
    [
      "organization content",
      ORG_REF,
      orgRead(),
      meetingsRead({ owner: ORG_OWNER }),
      { kind: "content", owner: ORG_OWNER, meetings: [MEETING], organization: ORGANIZATION },
    ],
    [
      "person content without a theme",
      PARTY_REF,
      null,
      meetingsRead({ meetings: [] }),
      { kind: "content", owner: PERSON, meetings: [], organization: null },
    ],
  ])("%s", (_name, _ownerRef, organization, meetings, expected) => {
    expect(resolveOwnerMeetingsView({ organization, meetings })).toEqual(expected);
  });
});
