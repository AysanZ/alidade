-- Demo dataset: a 7x6 fishnet over Dushanbe with a plausible density surface.
-- Replace with real data by loading a GeoPackage through data/seed.sh.
SELECT setseed(0.42);

WITH params AS (
    SELECT 68.66::double precision AS lon0,
           68.92::double precision AS lon1,
           38.47::double precision AS lat0,
           38.635::double precision AS lat1,
           7 AS cols,
           6 AS rows
),
names AS (
    SELECT ARRAY['Sino','Firdavsi','Shohmansur','Somoni','Zarafshon','Guliston','Varzob',
                 'Hisor','Rudaki','Navruz','Bahoriston','Chorbogh','Kohistan','Dehmoy'] AS n
),
cells AS (
    SELECT c, r,
           lon0 + (lon1 - lon0) * c / cols       AS x0,
           lon0 + (lon1 - lon0) * (c + 1) / cols AS x1,
           lat0 + (lat1 - lat0) * r / rows       AS y0,
           lat0 + (lat1 - lat0) * (r + 1) / rows AS y1,
           r * cols + c AS i
    FROM params, generate_series(0, 6) AS c, generate_series(0, 5) AS r
),
geoms AS (
    SELECT i, c, r,
           ST_Multi(ST_MakeEnvelope(x0, y0, x1, y1, 4326)) AS geom,
           sqrt(pow((c - 3.0) / 3.5, 2) + pow((r - 2.5) / 3.0, 2)) AS dist
    FROM cells
)
INSERT INTO wards_1400 (ward_id, name, geom, area_km2, density, pop_2024)
SELECT
    'W-' || (101 + i),
    (SELECT n[(i % 14) + 1] FROM names) || ' ' || (i / 14 + 1),
    geom,
    round((ST_Area(geom::geography) / 1e6)::numeric, 2),
    d,
    round(d * (ST_Area(geom::geography) / 1e6)::numeric)
FROM geoms,
     LATERAL (SELECT greatest(120, round((9800 * power(greatest(0, 1 - dist * 0.78), 2.1)
              + random() * 1500)::numeric, 2)) AS d) v
ON CONFLICT (ward_id) DO NOTHING;

-- Two wards with no measurement, so the no-data class has something to show.
UPDATE wards_1400 SET density = NULL, pop_2024 = NULL WHERE ward_id IN ('W-110', 'W-135');
