import type { Basemap, MapProject } from "@alidade/core";

import { BASEMAPS } from "../basemaps";
import { Field, Section, Switch } from "./Field";

const GROUPS = ["Canvas", "Aerial", "Street", "Terrain"];

export function BasemapGallery({
  project,
  edit,
}: {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
}) {
  const choose = (b: Basemap) =>
    edit((d) => {
      // The label preference is the user's, not the basemap's, so it survives a swap.
      d.basemap = {
        ...b,
        labels: b.labelTiles ? d.basemap.labels : false,
        opacity: d.basemap.opacity ?? 1,
      };
      return d;
    });

  return (
    <div className="pane">
      {GROUPS.map((group) => (
        <Section title={group} key={group}>
          <div className="gallery">
            {BASEMAPS.filter((b) => b.group === group).map((b) => (
              <button
                key={b.id}
                className={`card${b.id === project.basemap.id ? " on" : ""}`}
                onClick={() => choose(b)}
                title={(b.raster ?? b.overview)?.attribution ?? "No tiles"}
              >
                <span className="thumb" style={{ background: b.background }}>
                  {(b.raster ?? b.overview) && (
                    <img src={preview((b.raster ?? b.overview)!.tiles[0]!)} alt="" loading="lazy" />
                  )}
                </span>
                <span className="label">{b.name}</span>
              </button>
            ))}
          </div>
        </Section>
      ))}

      <Section title="Settings">
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
        <Field label="Opacity" value={`${Math.round((project.basemap.opacity ?? 1) * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((project.basemap.opacity ?? 1) * 100)}
            onChange={(e) =>
              edit((d) => {
                d.basemap = { ...d.basemap, opacity: Number(e.target.value) / 100 };
                return d;
              })
            }
          />
        </Field>
        <p className="hint">{project.basemap.raster?.attribution ?? "No tiles are being loaded."}</p>
      </Section>
    </div>
  );
}

/** One real tile over Tehran, which is a more honest preview than a gradient. */
function preview(template: string): string {
  return template
    .replace("{z}", "9")
    .replace("{x}", "329")
    .replace("{y}", "201")
    .replace("{s}", "a");
}
