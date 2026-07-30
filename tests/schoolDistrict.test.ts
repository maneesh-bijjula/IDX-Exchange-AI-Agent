import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSchoolDistrictLookupQuery,
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
