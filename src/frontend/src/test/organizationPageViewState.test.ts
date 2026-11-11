import { describe, expect, it } from "vitest";
import type { PublicOrganizationResponse } from "../api/organizations";
import type { DirectoryStatus } from "../features/organization-public/layouts/types";
import {
  directoryStatusOf,
  ORGANIZATION_PAGE_LOAD_ERROR,
  resolveOrganizationPageView,
  type OrganizationPageView,
} from "../features/organization-public/organizationPageViewState";

const ORGANIZATION: PublicOrganizationResponse = {
  slug: "muzyczne-skrzaty",
  name: "Muzyczne Skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  description: null,
  logo: null,
  avatar: null,
  cover: null,
  gallery: [],
};

type Input = Parameters<typeof resolveOrganizationPageView>[0];

const BASE: Input = { data: null, loading: false, notFound: false, error: null };

describe("resolveOrganizationPageView", () => {
  it.each<{ name: string; input: Partial<Input>; expected: OrganizationPageView }>([
    { name: "first read pending", input: { loading: true }, expected: { kind: "loading" } },
    { name: "404 wins over data", input: { notFound: true, data: ORGANIZATION }, expected: { kind: "notFound" } },
    { name: "loaded Organization", input: { data: ORGANIZATION }, expected: { kind: "content", organization: ORGANIZATION } },
    {
      name: "failed refresh keeps the Organization",
      input: { data: ORGANIZATION, error: "Błąd serwera" },
      expected: { kind: "content", organization: ORGANIZATION },
    },
    {
      name: "failed first read",
      input: { error: "Błąd serwera" },
      expected: { kind: "error", message: ORGANIZATION_PAGE_LOAD_ERROR },
    },
    { name: "nothing to show", input: {}, expected: { kind: "notFound" } },
  ])("$name", ({ input, expected }) => {
    expect(resolveOrganizationPageView({ ...BASE, ...input })).toEqual(expected);
  });
});

describe("directoryStatusOf", () => {
  it.each<{ input: Parameters<typeof directoryStatusOf>[0]; expected: DirectoryStatus }>([
    { input: { loading: true, notFound: false, error: null }, expected: "loading" },
    { input: { loading: false, notFound: true, error: null }, expected: "unavailable" },
    { input: { loading: false, notFound: false, error: "Błąd" }, expected: "unavailable" },
    { input: { loading: false, notFound: false, error: null }, expected: "ready" },
  ])("$expected", ({ input, expected }) => {
    expect(directoryStatusOf(input)).toEqual(expected);
  });
});
