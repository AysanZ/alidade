-- Alidade phase 0: one table, served as vector tiles.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS wards_1400 (
    ward_id    text PRIMARY KEY,
    name       text NOT NULL,
    pop_2024   integer,
    area_km2   numeric(8, 2),
    density    numeric(10, 2),
    updated_at date NOT NULL DEFAULT current_date,
    geom       geometry(MultiPolygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS wards_1400_geom_idx ON wards_1400 USING gist (geom);
CREATE INDEX IF NOT EXISTS wards_1400_density_idx ON wards_1400 (density);

COMMENT ON TABLE wards_1400 IS 'Demo wards over Tehran. Source CRS was EPSG:32639, reprojected on import.';
