-- Remove the demo wards from a database that was created before the seed was
-- dropped from data/init.
--
-- The init scripts only run on a brand new volume, so an existing database still
-- holds the 42 fishnet cells over Tehran and the registry row that points at
-- them. This takes both out. It is safe to run more than once, and safe to run
-- on a database that never had them.
--
--   psql postgresql://alidade:change_me@localhost:5433/alidade -f data/drop-demo.sql

DELETE FROM layers WHERE id = 'wards' AND table_name = 'wards_1400';
DROP TABLE IF EXISTS wards_1400;
