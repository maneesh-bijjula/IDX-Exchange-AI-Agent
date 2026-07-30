import unittest

import geopandas as gpd
import pandas as pd
from shapely.geometry import box

from scripts.enrich_school_districts import (
    BOUNDARY_YEAR,
    build_listing_query,
    load_unified_districts,
    map_properties_to_districts,
)


class SchoolDistrictEnrichmentTests(unittest.TestCase):
    def test_listing_query_is_parameterized(self):
        sql, params = build_listing_query(25)

        self.assertIn("L_Status = %s", sql)
        self.assertIn("LIMIT %s", sql)
        self.assertEqual(params, ("Active", 25))

    def test_maps_only_points_inside_unified_districts(self):
        districts = gpd.GeoDataFrame(
            {
                "OBJECTID": [1],
                "CDSCode": ["30636500000000"],
                "CountyName": ["Orange"],
                "DistrictName": ["Irvine Unified"],
                "DistrictType": ["Unified"],
            },
            geometry=[box(-118.0, 33.0, -117.0, 34.0)],
            crs="EPSG:4326",
        )
        listings = pd.DataFrame(
            [
                {
                    "listing_id": "INSIDE",
                    "latitude": 33.68,
                    "longitude": -117.82,
                },
                {
                    "listing_id": "OUTSIDE",
                    "latitude": 36.0,
                    "longitude": -120.0,
                },
            ]
        )

        result = map_properties_to_districts(listings, districts)
        inside = result.loc[result["listing_id"] == "INSIDE"].iloc[0]
        outside = result.loc[result["listing_id"] == "OUTSIDE"].iloc[0]

        self.assertEqual(inside["district_name"], "Irvine Unified")
        self.assertTrue(bool(inside["matched"]))
        self.assertEqual(inside["boundary_year"], BOUNDARY_YEAR)
        self.assertTrue(pd.isna(outside["district_name"]))
        self.assertFalse(bool(outside["matched"]))

    def test_boundary_loader_filters_to_unified_and_reprojects(self):
        districts = gpd.GeoDataFrame(
            {
                "OBJECTID": [1, 2],
                "Year": [BOUNDARY_YEAR, BOUNDARY_YEAR],
                "CDSCode": ["1", "2"],
                "CountyName": ["Orange", "Orange"],
                "DistrictName": ["Unified Example", "Elementary Example"],
                "DistrictType": ["Unified", "Elementary"],
            },
            geometry=[
                box(-118.0, 33.0, -117.0, 34.0),
                box(-118.0, 33.0, -117.0, 34.0),
            ],
            crs="EPSG:4326",
        )

        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as directory:
            path = f"{directory}/districts.geojson"
            districts.to_file(path, driver="GeoJSON")
            result = load_unified_districts(path)

        self.assertEqual(len(result), 1)
        self.assertEqual(result.iloc[0]["DistrictName"], "Unified Example")
        self.assertEqual(result.crs.to_string(), "EPSG:4326")


if __name__ == "__main__":
    unittest.main()
