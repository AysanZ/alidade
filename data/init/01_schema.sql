-- Everything the API needs on an empty database, and nothing else.
--
-- There is no seed dataset. A demo layer shipped in here is somebody else's map
-- in your table of contents: it cannot be removed from the studio, it comes back
-- on every fresh volume, and it makes an empty install look like it already has
-- data. Load your own through Add data, or with data/seed.sh.
CREATE EXTENSION IF NOT EXISTS postgis;

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
