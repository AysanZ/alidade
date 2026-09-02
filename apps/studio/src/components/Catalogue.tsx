import { useQueryClient } from "@tanstack/react-query";
import type { MapProject } from "@alidade/core";

import { alreadyAdded, geometryOf, place, type Extent } from "../layers";
import { useLayers } from "../queries";

interface Props {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  onAdded: (id: string) => void;
  onFlyTo: (extent: Extent) => void;
  /** The empty state needs a way through to the import dialog. */
  onImport?: () => void;
  compact?: boolean;
}

/**
 * What is already in the database.
 *
 * The application used to open with one hard-coded Tehran layer, and then with a
 * hard-coded button offering it. Both were guesses about somebody else's data.
 * The `layers` table is a registry and the API will read it out, so the honest
 * thing is to ask rather than assume: whatever has been loaded shows up here on
 * its own, and on a fresh install that is nothing at all.
 *
 * It also answers a question an empty map cannot. A black screen with no layers
 * looks exactly the same whether the backend is healthy and you have not added
 * anything yet, or the backend is down.
 */
export function Catalogue({ project, edit, onAdded, onFlyTo, onImport, compact }: Props) {
  const client = useQueryClient();
  const { data: layers, error, isPending, refetch, isFetching } = useLayers();

  if (isPending) {
    return <p className="hint">Asking the server what it has…</p>;
  }

  if (error) {
    return (
      <div className={compact ? "empty" : "pane"}>
        <p className="error">
          The API did not answer: {error instanceof Error ? error.message : String(error)}
          <br />
          Start it with <code>docker compose --env-file .env -f deploy/docker-compose.yml up -d</code>.
        </p>
        <div className="row buttons">
          <button onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? "Trying…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (layers.length === 0) {
    return (
      <div className={compact ? "empty" : "pane"}>
        <b>The database is empty</b>
        <p>
          Nothing has been loaded yet. Upload a file, paste a link to one, or connect to a WMS.
        </p>
        {onImport && (
          <div className="row buttons">
            <button className="primary" onClick={onImport}>
              Add data
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {compact && (
        <p className="hint">
          {layers.length} layer{layers.length === 1 ? "" : "s"} are already in the database. Add
          one, or bring in your own.
        </p>
      )}
      <ul className="picker">
        {layers.map((layer) => {
          const on = alreadyAdded(project, layer);
          return (
            <li
              key={layer.id}
              className={on ? "used" : ""}
              onClick={() => !on && place(layer, edit, onAdded, onFlyTo, client)}
              title={on ? "Already on the map" : `Add ${layer.title}`}
            >
              <b>{layer.title}</b>
              <span>
                {geometryOf(layer.geometryType)}
                {layer.featureCount !== null && ` · ${layer.featureCount.toLocaleString("en-US")} features`}
                {layer.sourceCrs && ` · ${layer.sourceCrs}`}
              </span>
              <em>{on ? "on the map" : "add"}</em>
            </li>
          );
        })}
      </ul>
      {onImport && (
        <div className="row buttons">
          <button className="primary" onClick={onImport}>
            Add data
          </button>
          <button onClick={() => void refetch()} disabled={isFetching}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}
