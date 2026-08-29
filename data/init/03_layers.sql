-- The layer registry. Uploaded data lands in its own table; this says where.
CREATE TABLE IF NOT EXISTS layers (
    id              text PRIMARY KEY,
    title           text NOT NULL,
    table_name      text NOT NULL,
    geometry_column text NOT NULL DEFAULT 'geom',
    geometry_type   text,
    source_crs      text,
    feature_count   integer,
    fields          jsonb NOT NULL DEFAULT '[]'::jsonb,
    extent          jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN layers.table_name IS
    'Written by the server from a sanitised slug, never taken from a request.';

INSERT INTO layers (id, title, table_name, geometry_type, source_crs, feature_count, fields, extent)
SELECT
    'wards',
    'Population density',
    'wards_1400',
    'MultiPolygon',
    'EPSG:32639',
    count(*)::int,
    '["ward_id","name","pop_2024","area_km2","density","updated_at"]'::jsonb,
    jsonb_build_object(
        'west', min(ST_XMin(geom)), 'south', min(ST_YMin(geom)),
        'east', max(ST_XMax(geom)), 'north', max(ST_YMax(geom))
    )
FROM wards_1400
ON CONFLICT (id) DO NOTHING;
