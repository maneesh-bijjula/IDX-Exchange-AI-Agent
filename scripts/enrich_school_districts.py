#!/usr/bin/env python3
"""Map active MLS listings to 2025-26 California unified school districts."""

from __future__ import annotations

import argparse
import math
import os
from pathlib import Path
from typing import Any, Iterable
from urllib.request import urlretrieve

import geopandas as gpd
import mysql.connector
import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIRECTORY = PROJECT_ROOT / "data" / "school-districts"
DEFAULT_BOUNDARY_PATH = (
    DATA_DIRECTORY / "california-school-district-areas-2025-26.geojson"
)
DEFAULT_OUTPUT_PATH = DATA_DIRECTORY / "property-school-district-mapping.csv"
BOUNDARY_URL = (
    "https://gis.data.ca.gov/api/download/v1/items/"
    "48870daecfe14c6ab376f6a673491914/geojson?layers=0"
)
BOUNDARY_YEAR = "2025-26"

REQUIRED_DISTRICT_COLUMNS = {
    "OBJECTID",
    "Year",
    "CDSCode",
    "CountyName",
    "DistrictName",
    "DistrictType",
    "geometry",
}

CREATE_MAPPING_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS property_school_district (
  listing_id VARCHAR(255) NOT NULL,
  latitude DECIMAL(18, 15) NOT NULL,
  longitude DECIMAL(19, 15) NOT NULL,
  district_name VARCHAR(255) NULL,
  district_type VARCHAR(32) NULL,
  district_cds_code VARCHAR(32) NULL,
  county_name VARCHAR(128) NULL,
  district_object_id INT NULL,
  boundary_year VARCHAR(16) NOT NULL,
  matched TINYINT(1) NOT NULL,
  mapped_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id),
  INDEX idx_property_school_district_name (district_name),
  INDEX idx_property_school_district_matched (matched)
)
"""

UPSERT_MAPPING_SQL = """
INSERT INTO property_school_district (
  listing_id,
  latitude,
  longitude,
  district_name,
  district_type,
  district_cds_code,
  county_name,
  district_object_id,
  boundary_year,
  matched
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
  latitude = VALUES(latitude),
  longitude = VALUES(longitude),
  district_name = VALUES(district_name),
  district_type = VALUES(district_type),
  district_cds_code = VALUES(district_cds_code),
  county_name = VALUES(county_name),
  district_object_id = VALUES(district_object_id),
  boundary_year = VALUES(boundary_year),
  matched = VALUES(matched)
"""


def load_project_env(path: Path = PROJECT_ROOT / ".env") -> None:
    """Load simple KEY=VALUE entries without overriding the shell environment."""
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.removeprefix("export ").strip()
        value = value.strip().strip("'\"")
        if key:
            os.environ.setdefault(key, value)


def ensure_boundary_file(path: Path) -> None:
    if path.exists():
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading official California school-district boundaries to {path}...")
    urlretrieve(BOUNDARY_URL, path)


def load_unified_districts(path: Path) -> gpd.GeoDataFrame:
    districts = gpd.read_file(path)
    missing = REQUIRED_DISTRICT_COLUMNS.difference(districts.columns)
    if missing:
        raise ValueError(
            "School-district boundary file is missing columns: "
            + ", ".join(sorted(missing))
        )
    if districts.crs is None:
        raise ValueError("School-district boundary file does not declare a CRS")

    unified = districts.loc[
        districts["DistrictType"].astype(str).str.casefold() == "unified",
        list(REQUIRED_DISTRICT_COLUMNS),
    ].copy()
    unified = unified.loc[unified.geometry.notna() & ~unified.geometry.is_empty]
    unified = unified.to_crs("EPSG:4326")
    unified["CDSCode"] = unified["CDSCode"].astype(str)
    return unified


def build_listing_query(limit: int | None = None) -> tuple[str, tuple[Any, ...]]:
    sql = """
SELECT
  L_ListingID AS listing_id,
  LMD_MP_Latitude AS latitude,
  LMD_MP_Longitude AS longitude
FROM rets_property
WHERE L_Status = %s
  AND L_ListingID IS NOT NULL
  AND LMD_MP_Latitude IS NOT NULL
  AND LMD_MP_Longitude IS NOT NULL
ORDER BY L_ListingID
""".strip()
    params: list[Any] = ["Active"]

    if limit is not None:
        safe_limit = max(1, int(limit))
        sql += "\nLIMIT %s"
        params.append(safe_limit)

    return sql, tuple(params)


def connect_to_database():
    load_project_env()
    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "idx_exchange"),
    )


def fetch_active_listings(connection, limit: int | None = None) -> pd.DataFrame:
    sql, params = build_listing_query(limit)
    cursor = connection.cursor(dictionary=True)
    try:
        cursor.execute(sql, params)
        rows = cursor.fetchall()
    finally:
        cursor.close()

    listings = pd.DataFrame(rows)
    if listings.empty:
        return pd.DataFrame(columns=["listing_id", "latitude", "longitude"])

    listings["latitude"] = pd.to_numeric(listings["latitude"], errors="coerce")
    listings["longitude"] = pd.to_numeric(listings["longitude"], errors="coerce")
    finite_coordinates = listings["latitude"].map(math.isfinite) & listings[
        "longitude"
    ].map(math.isfinite)
    valid_ranges = listings["latitude"].between(-90, 90) & listings[
        "longitude"
    ].between(-180, 180)
    return listings.loc[finite_coordinates & valid_ranges].reset_index(drop=True)


def map_properties_to_districts(
    listings: pd.DataFrame, unified_districts: gpd.GeoDataFrame
) -> pd.DataFrame:
    output_columns = [
        "listing_id",
        "latitude",
        "longitude",
        "district_name",
        "district_type",
        "district_cds_code",
        "county_name",
        "district_object_id",
        "boundary_year",
        "matched",
    ]
    if listings.empty:
        return pd.DataFrame(columns=output_columns)

    points = gpd.GeoDataFrame(
        listings.copy(),
        geometry=gpd.points_from_xy(listings["longitude"], listings["latitude"]),
        crs="EPSG:4326",
    )
    district_fields = unified_districts[
        [
            "OBJECTID",
            "CDSCode",
            "CountyName",
            "DistrictName",
            "DistrictType",
            "geometry",
        ]
    ]
    joined = gpd.sjoin(points, district_fields, how="left", predicate="within")

    # Boundaries should not overlap, but deterministic de-duplication protects
    # the listing-id primary key if the source data contains an overlap.
    joined = joined.sort_values(
        ["listing_id", "DistrictName"], na_position="last"
    ).drop_duplicates("listing_id", keep="first")
    joined = joined.rename(
        columns={
            "DistrictName": "district_name",
            "DistrictType": "district_type",
            "CDSCode": "district_cds_code",
            "CountyName": "county_name",
            "OBJECTID": "district_object_id",
        }
    )
    joined["boundary_year"] = BOUNDARY_YEAR
    joined["matched"] = joined["district_name"].notna()
    return pd.DataFrame(joined[output_columns]).reset_index(drop=True)


def _database_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        return value.item()
    return value


def mapping_rows(mapping: pd.DataFrame) -> Iterable[tuple[Any, ...]]:
    for row in mapping.itertuples(index=False, name=None):
        values = tuple(_database_value(value) for value in row)
        yield values[:-1] + (int(bool(values[-1])),)


def save_mapping_to_database(
    connection, mapping: pd.DataFrame, batch_size: int = 1000
) -> None:
    cursor = connection.cursor()
    try:
        cursor.execute(CREATE_MAPPING_TABLE_SQL)
        rows = list(mapping_rows(mapping))
        for start in range(0, len(rows), batch_size):
            cursor.executemany(UPSERT_MAPPING_SQL, rows[start : start + batch_size])
            connection.commit()
    finally:
        cursor.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Map active MLS listings to California unified school districts."
    )
    parser.add_argument(
        "--boundaries",
        type=Path,
        default=DEFAULT_BOUNDARY_PATH,
        help="Path to the official 2025-26 school-district GeoJSON.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="CSV output path for the enriched listing mapping.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Process only the first N active listings for a quick smoke test.",
    )
    parser.add_argument(
        "--no-db-write",
        action="store_true",
        help="Create the CSV but do not create or update the MySQL mapping table.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Number of mapping rows per MySQL upsert batch.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_boundary_file(args.boundaries)

    unified_districts = load_unified_districts(args.boundaries)
    print(
        f"Loaded {len(unified_districts):,} unified districts "
        f"from the {BOUNDARY_YEAR} boundary file."
    )

    connection = connect_to_database()
    try:
        listings = fetch_active_listings(connection, args.limit)
        print(f"Loaded {len(listings):,} active listings with valid coordinates.")

        mapping = map_properties_to_districts(listings, unified_districts)
        matched = int(mapping["matched"].sum()) if not mapping.empty else 0
        unmatched = len(mapping) - matched

        args.output.parent.mkdir(parents=True, exist_ok=True)
        mapping.to_csv(args.output, index=False)
        print(f"Saved {len(mapping):,} property mappings to {args.output}.")

        if not args.no_db_write:
            save_mapping_to_database(
                connection, mapping, batch_size=max(1, args.batch_size)
            )
            print("Updated MySQL table property_school_district.")

        coverage = (matched / len(mapping) * 100) if len(mapping) else 0
        print(
            f"Unified-district matches: {matched:,}; "
            f"unmatched: {unmatched:,}; coverage: {coverage:.1f}%."
        )
    finally:
        connection.close()


if __name__ == "__main__":
    main()
