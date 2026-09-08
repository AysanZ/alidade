-- The imagery catalogue.
--
-- One row per GeoTIFF. The pixels live on a volume, the way uploaded 3D models
-- already do; this says where they are and what they are of.
--
-- Column names follow STAC where STAC has a name for the thing — gsd, proj:epsg,
-- eo:cloud_cover — so that the search endpoint can answer with an ItemCollection
-- without translating, and anything that speaks STAC can read the catalogue
-- without being told about Alidade.

CREATE TABLE IF NOT EXISTS rasters (
    id            text PRIMARY KEY,
    title         text NOT NULL,
    file          text NOT NULL,
    -- Server-chosen: a slug of the original and a short token. Never from a request.
    stored        text NOT NULL,

    -- NULL is a legal state, not a broken one. STAC allows a null datetime for an
    -- item with no meaningful single instant, and a great many exported GeoTIFFs
    -- carry no acquisition tag at all. Such an image is drawn and listed like any
    -- other; it sorts last, and it says why.
    captured_at   timestamptz,
    -- 'tag', 'filename' or 'user'. A date somebody typed must never be
    -- indistinguishable from one the file stated.
    captured_from text,

    -- The real outline, not the bounding box. A scene is a rotated quadrilateral
    -- with nodata in the corners; its box claims ground it has no pixels for.
    footprint     geometry(Polygon, 4326) NOT NULL,

    gsd           double precision NOT NULL,
    epsg          integer,
    cloud_cover   double precision,
    bands         integer NOT NULL,
    dtype         text NOT NULL,
    nodata        double precision,
    width         integer,
    height        integer,
    bytes         bigint,

    sensor        text,
    note          text,

    -- 'converting', 'ready' or 'failed'. A 800 MB scene takes tens of seconds to
    -- warp, so the row exists before the file does.
    state         text NOT NULL DEFAULT 'ready',
    error         text,

    created_at    timestamptz NOT NULL DEFAULT now()
);

-- The strip's query is "what covers this view", so the footprint index is the
-- one that matters. The date index is for the sorting rules.
CREATE INDEX IF NOT EXISTS rasters_footprint ON rasters USING GIST (footprint);
CREATE INDEX IF NOT EXISTS rasters_captured ON rasters (captured_at DESC NULLS LAST);
