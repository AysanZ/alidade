-- Put a public instance back the way you left it.
--
-- Vector ingest is open on a demo, so visitors add layers. This drops every
-- layer that is not on the keep list, table and registry row together. Edit the
-- list; anything not in it is temporary by definition.
--
--   docker compose -f docker-compose.prod.yml exec -T postgis \
--     psql -U alidade -d alidade < data/reset-demo.sql

DO $$
DECLARE
    -- The layers you curated. Everything else goes.
    keep text[] := ARRAY['airports', 'marine'];
    row  record;
BEGIN
    FOR row IN SELECT id, table_name FROM layers WHERE NOT (id = ANY (keep)) LOOP
        -- The registry holds the table name, so a dropped layer cannot leave a
        -- table behind that nothing points at and nobody finds.
        EXECUTE format('DROP TABLE IF EXISTS %I', row.table_name);
        DELETE FROM layers WHERE id = row.id;
        RAISE NOTICE 'dropped %', row.id;
    END LOOP;
END $$;

-- Imagery, the same way. This clears the rows; the .tif files are on a volume
-- and have to go separately, which the cron in docs/deployment.md does:
--
--   docker compose ... exec -T api sh -c 'rm -f /srv/rasters/*.tif'
--
-- Files first would leave rows pointing at nothing for a moment, and a tile
-- request in that moment is a 500 rather than an empty map. Rows first is the
-- order that degrades quietly.
DELETE FROM rasters WHERE id <> ALL (ARRAY['keep-this-one']);
