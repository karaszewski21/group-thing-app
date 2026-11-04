import { describe, expect, it } from "vitest";
import { buildMapsUrl } from "../lib/googleMaps";
import { localityDetail, localityMapsQuery } from "../utils/locationLabel";
import { makeLocality } from "./fixtures/locations";

const NOWA_WIES = makeLocality({ id: "0045012", name: "Nowa Wieś", kind: "VILLAGE" });

describe("locationLabel", () => {
  it("localityDetail is the gmina, powiat and voivodeship line", () => {
    expect(localityDetail(NOWA_WIES)).toBe("gm. Kęty, pow. oświęcimski, małopolskie");
  });

  it("localityMapsQuery names the locality with its gmina and voivodeship", () => {
    expect(localityMapsQuery(NOWA_WIES)).toBe("Nowa Wieś, gmina Kęty, małopolskie, Polska");
  });

  it("buildMapsUrl searches the query and adds the place id only when given", () => {
    expect(buildMapsUrl({ query: localityMapsQuery(NOWA_WIES) })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Nowa%20Wie%C5%9B%2C%20gmina%20K%C4%99ty%2C%20ma%C5%82opolskie%2C%20Polska",
    );
    expect(buildMapsUrl({ query: "Polna 12, Kęty", google_place_id: null })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Polna%2012%2C%20K%C4%99ty",
    );
    expect(buildMapsUrl({ query: "Polna 12, Kęty", google_place_id: "ChIJ-x" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Polna%2012%2C%20K%C4%99ty&query_place_id=ChIJ-x",
    );
  });
});
