import type { MapProject } from "@alidade/core";

import { BASEMAPS } from "../basemaps";
import { Field, Switch } from "./Field";

export function BasemapGallery({
  project,
  edit,
}: {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
}) {
  return (
    <div className="pane">
      <div className="gallery">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            className={`card${b.id === project.basemap.id ? " on" : ""}`}
            onClick={() =>
              edit((d) => {
                // Keep the label preference across the swap; it is the user's, not the basemap's.
                d.basemap = { ...b, labels: b.labelTiles ? d.basemap.labels : false };
                return d;
              })
            }
          >
            <span className="thumb" style={{ background: b.background }}>
              {b.raster && <img src={preview(b.raster.tiles[0]!)} alt="" loading="lazy" />}
            </span>
            <span className="label">{b.name}</span>
          </button>
        ))}
      </div>

      <Switch
        label="Basemap labels"
        on={project.basemap.labels}
        onChange={(on) =>
          edit((d) => {
            d.basemap = { ...d.basemap, labels: on };
            return d;
          })
        }
      />
      <Field label="Attribution">
        <span className="muted small">{project.basemap.raster?.attribution ?? "None"}</span>
      </Field>
      <p className="hint">
        Swapping a basemap replaces two layers at the bottom of the stack. Nothing you added is
        touched.
      </p>
    </div>
  );
}

/** One real tile over Tehran, which is a more honest preview than a gradient. */
function preview(template: string): string {
  return template.replace("{z}", "9").replace("{x}", "329").replace("{y}", "201");
}
