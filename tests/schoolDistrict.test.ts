import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchoolDistrictBatchLookupQuery,
  buildSchoolDistrictLookupQuery,
  getSchoolDistrictsForListings,
  getSchoolDistrictForListing,
  type SchoolDistrictMapping,
} from "../src/schoolDistrict.ts";

test("builds a parameterized school-district lookup", () => {
  const built = buildSchoolDistrictLookupQuery("  OC123  ");

  assert.match(built.sql, /FROM property_school_district/);
  assert.match(built.sql, /WHERE listing_id = \?/);
  assert.deepEqual(built.params, ["OC123"]);
  assert.doesNotMatch(built.sql, /OC123/);
});

test("rejects an empty listing id", () => {
  assert.throws(
    () => buildSchoolDistrictLookupQuery("  "),
    /listing ID is required/,
  );
});

test("returns a mapped unified district", async () => {
  const expected: SchoolDistrictMapping = {
    listingId: "OC123",
    districtName: "Irvine Unified",
    districtType: "Unified",
    districtCdsCode: "30636500000000",
    countyName: "Orange",
    boundaryYear: "2025-26",
  };
  const executor = async <T>(sql: string, params: unknown[]) => {
    assert.match(sql, /matched = 1/);
    assert.deepEqual(params, ["OC123"]);
    return [expected as T];
  };

  assert.deepEqual(
    await getSchoolDistrictForListing("OC123", executor),
    expected,
  );
});

test("returns null when a property is outside unified-district coverage", async () => {
  const executor = async <T>() => [] as T[];
  assert.equal(
    await getSchoolDistrictForListing("OUTSIDE", executor),
    null,
  );
});

test("builds one parameterized query for multiple listing ids", async () => {
  const built = buildSchoolDistrictBatchLookupQuery([
    " ONE ",
    "TWO",
    "ONE",
  ]);

  assert.match(built.sql, /listing_id IN \(\?, \?\)/);
  assert.deepEqual(built.params, ["ONE", "TWO"]);

  const expected: SchoolDistrictMapping = {
    listingId: "ONE",
    districtName: "Irvine Unified",
    districtType: "Unified",
    districtCdsCode: "30736500000000",
    countyName: "Orange",
    boundaryYear: "2025-26",
  };
  const executor = async <T>() => [expected as T];
  const mappings = await getSchoolDistrictsForListings(
    ["ONE", "TWO"],
    executor,
  );

  assert.deepEqual(mappings.get("ONE"), expected);
  assert.equal(mappings.has("TWO"), false);
});
