import type { Bookmark, MapProject, Projection } from "@alidade/core";

import { useState } from "react";
import { GLOBE_IS_ROUND_BELOW, parseCoordinate } from "@alidade/core";

import { HILLSHADE } from "../project";
import { Field, Section, Switch } from "./Field";

const VIEWS = [
  { id: "2d", label: "2D", pitch: 0, bearing: 0 },
  { id: "25d", label: "2.5D", pitch: 34, bearing: -14 },
  { id: "3d", label: "3D", pitch: 58, bearing: -28 },
];

/**
 * `globe` is MapLibre's own name for a projection that is a sphere when zoomed
 * out and mercator on the way in. That is the right default and the wrong
 * surprise: picking it at zoom 10 changes nothing on the screen, which is what
 * made it look broken. `vertical-perspective` is the sphere at every zoom.
 */
const PROJECTIONS: { id: Projection; label: string; hint: string }[] = [
  { id: "mercator", label: "Mercator", hint: "Flat, the way web maps are drawn" },
  { id: "globe", label: "Globe", hint: "A sphere when zoomed out, mercator when zoomed in" },
  { id: "vertical-perspective", label: "Sphere", hint: "A sphere at every zoom" },
];

/** Relief needs a minimum scale before it reads as anything but a flat sheet. */
const TERRAIN_DENOMINATOR = 3_000_000;

export function ScenePanel({
  project,
  edit,
  denominator,
  onGoTo,
  onProjection,
  onRecall,
}: {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  denominator: number;
  onGoTo: (lon: number, lat: number) => void;
  onProjection: (projection: Projection) => void;
  onRecall: (bookmark: Bookmark) => void;
}) {
  const [target, setTarget] = useState("");
  const parsed = parseCoordinate(target);
  const { view, environment, chrome } = project;
  const mode = VIEWS.find((v) => v.pitch === view.pitch)?.id ?? "custom";
  const tooFarOutForRelief = denominator > TERRAIN_DENOMINATOR;

  return (
    <div className="pane">
      <Section title="Camera">
        <div className="row buttons">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={mode === v.id ? "on" : ""}
              onClick={() =>
                edit((d) => {
                  d.view = { ...d.view, pitch: v.pitch, bearing: v.bearing };
                  // Tilting a flat sheet is not a 3D view. Anything but 2D brings
                  // the relief with it, which is what the button is really asking for.
                  if (v.id === "2d") {
                    delete d.environment.terrain;
                  } else {
                    d.environment.terrain ??= { source: "dem", exaggeration: 1.4 };
                    d.environment.hillshade ??= { ...HILLSHADE };
                  }
                  return d;
                })
              }
            >
              {v.label}
            </button>
          ))}
        </div>
        <Field label="Pitch" value={`${Math.round(view.pitch)}°`}>
          <input
            type="range"
            min={0}
            max={70}
            value={view.pitch}
            onChange={(e) =>
              edit((d) => {
                d.view = { ...d.view, pitch: Number(e.target.value) };
                return d;
              })
            }
          />
        </Field>
        <Field label="Bearing" value={`${Math.round(view.bearing)}°`}>
          <input
            type="range"
            min={-180}
            max={180}
            value={view.bearing}
            onChange={(e) =>
              edit((d) => {
                d.view = { ...d.view, bearing: Number(e.target.value) };
                return d;
              })
            }
          />
        </Field>
        <div className="row buttons">
          <button
            onClick={() =>
              edit((d) => {
                d.view = { ...d.view, pitch: 0, bearing: 0 };
                return d;
              })
            }
          >
            Reset pitch and bearing
          </button>
        </div>
      </Section>

      <Section title="Go to">
        <div className="row">
          <input
            className="text"
            value={target}
            placeholder="35.6892, 51.389"
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && parsed) onGoTo(parsed[0], parsed[1]);
            }}
          />
          <button
            className="primary"
            disabled={!parsed}
            onClick={() => parsed && onGoTo(parsed[0], parsed[1])}
          >
            Go
          </button>
        </div>
        <p className="hint">
          {target && !parsed
            ? "That is not a coordinate this can read."
            : "Latitude first. Decimal degrees or 35° 41′ 21″ N, 51° 23′ 20″ E."}
        </p>
      </Section>

      <Section title="Projection">
        <div className="row buttons">
          {PROJECTIONS.map((p) => (
            <button
              key={p.id}
              className={(environment.projection ?? "mercator") === p.id ? "on" : ""}
              title={p.hint}
              onClick={() => onProjection(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {environment.projection === "globe" && view.zoom > GLOBE_IS_ROUND_BELOW && (
          <p className="warn">
            Globe is drawn as a sphere below about zoom {GLOBE_IS_ROUND_BELOW} and as mercator above
            it, and the map is at zoom {view.zoom.toFixed(1)}. Zoom out, or pick Sphere, which stays
            round at every zoom.
          </p>
        )}
        <Switch
          label="Sky and atmosphere"
          on={Boolean(environment.sky)}
          onChange={(on) =>
            edit((d) => {
              if (on) d.environment.sky = true;
              else delete d.environment.sky;
              return d;
            })
          }
        />
        <p className="hint">
          Storage and rendering stay EPSG:3857. These are ways of drawing the same web mercator
          data, not different coordinate systems.
        </p>
      </Section>

      <Section title="Terrain">
        {environment.terrain && tooFarOutForRelief && (
          <p className="warn">
            Terrain is on, but at 1:{Math.round(denominator).toLocaleString("en-US").replace(/,/g, " ")} there
            is no relief to see. Zoom in to somewhere with mountains.
          </p>
        )}
        <Switch
          label="Terrain from SRTM"
          on={Boolean(environment.terrain)}
          onChange={(on) =>
            edit((d) => {
              if (on) d.environment.terrain = { source: "dem", exaggeration: 1.4 };
              else delete d.environment.terrain;
              return d;
            })
          }
        />
        {environment.terrain && (
          <Field label="Exaggeration" value={`${environment.terrain.exaggeration.toFixed(1)}×`}>
            <input
              type="range"
              min={0}
              max={40}
              value={environment.terrain.exaggeration * 10}
              onChange={(e) =>
                edit((d) => {
                  d.environment.terrain = { source: "dem", exaggeration: Number(e.target.value) / 10 };
                  return d;
                })
              }
            />
          </Field>
        )}
        <Switch
          label="Hillshade"
          on={Boolean(environment.hillshade)}
          onChange={(on) =>
            edit((d) => {
              if (on) d.environment.hillshade = { ...HILLSHADE };
              else delete d.environment.hillshade;
              return d;
            })
          }
        />
        {environment.hillshade && (
          <>
            <Field label="Sun azimuth" value={`${environment.hillshade.illumination}°`}>
              <input
                type="range"
                min={0}
                max={359}
                value={environment.hillshade.illumination}
                onChange={(e) =>
                  edit((d) => {
                    d.environment.hillshade!.illumination = Number(e.target.value);
                    return d;
                  })
                }
              />
            </Field>
            <Field label="Intensity" value={environment.hillshade.intensity.toFixed(2)}>
              <input
                type="range"
                min={0}
                max={100}
                value={environment.hillshade.intensity * 100}
                onChange={(e) =>
                  edit((d) => {
                    d.environment.hillshade!.intensity = Number(e.target.value) / 100;
                    return d;
                  })
                }
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="Furniture">
        <Switch
          label="Graticule"
          on={chrome.graticule.enabled}
          onChange={(on) =>
            edit((d) => {
              d.chrome.graticule = { ...d.chrome.graticule, enabled: on };
              return d;
            })
          }
        />
        {chrome.graticule.enabled && (
          <Field label="Interval">
            <select
              value={chrome.graticule.interval}
              onChange={(e) =>
                edit((d) => {
                  d.chrome.graticule = { ...d.chrome.graticule, interval: Number(e.target.value) };
                  return d;
                })
              }
            >
              {[0.1, 0.25, 0.5, 1, 5, 10].map((i) => (
                <option key={i} value={i}>
                  {i}°
                </option>
              ))}
            </select>
          </Field>
        )}
        <Switch
          label="UTM zones and bands"
          on={Boolean(chrome.grids?.utm)}
          onChange={(on) =>
            edit((d) => {
              d.chrome.grids = { ...defaults(d), utm: on };
              return d;
            })
          }
        />
        <Switch
          label="Metric square grid"
          on={Boolean(chrome.grids?.square.enabled)}
          onChange={(on) =>
            edit((d) => {
              const grids = defaults(d);
              d.chrome.grids = { ...grids, square: { ...grids.square, enabled: on } };
              return d;
            })
          }
        />
        {chrome.grids?.square.enabled && (
          <Field label="Spacing">
            <select
              value={chrome.grids.square.spacing}
              onChange={(e) =>
                edit((d) => {
                  const grids = defaults(d);
                  d.chrome.grids = {
                    ...grids,
                    square: { ...grids.square, spacing: Number(e.target.value) },
                    // Forget the patch so the application rebuilds it at the new
                    // spacing rather than reusing the one built for the old.
                    squareBounds: undefined,
                  };
                  return d;
                })
              }
            >
              {[
                [1000, "1 km"],
                [5000, "5 km"],
                [10000, "10 km"],
                [50000, "50 km"],
                [100000, "100 km"],
              ].map(([metres, label]) => (
                <option key={String(metres)} value={metres}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Switch
          label="Overview map"
          on={chrome.overview}
          onChange={(on) =>
            edit((d) => {
              d.chrome.overview = on;
              return d;
            })
          }
        />
        <Switch
          label="Scale bar"
          on={chrome.scaleBar.enabled}
          onChange={(on) =>
            edit((d) => {
              d.chrome.scaleBar = { ...d.chrome.scaleBar, enabled: on };
              return d;
            })
          }
        />
        <Field label="Units">
          <select
            value={chrome.scaleBar.units}
            onChange={(e) =>
              edit((d) => {
                d.chrome.scaleBar = {
                  ...d.chrome.scaleBar,
                  units: e.target.value as typeof d.chrome.scaleBar.units,
                };
                return d;
              })
            }
          >
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
            <option value="nautical">Nautical</option>
          </select>
        </Field>
        <Switch
          label="North arrow"
          on={chrome.northArrow}
          onChange={(on) =>
            edit((d) => {
              d.chrome.northArrow = on;
              return d;
            })
          }
        />
        <Field label="Readout">
          <select
            value={chrome.coordinates}
            onChange={(e) =>
              edit((d) => {
                d.chrome.coordinates = e.target.value as typeof d.chrome.coordinates;
                return d;
              })
            }
          >
            <option value="dd">Decimal degrees</option>
            <option value="dms">Degrees, minutes, seconds</option>
            <option value="utm">UTM metres</option>
          </select>
        </Field>
      </Section>

      <Section title="Lighting">
        <div className="row buttons">
          {([
            ["day", "Day"],
            ["night", "Night"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              className={(environment.light?.intensity ?? 1) >= 0.7 === (id === "day") ? "on" : ""}
              onClick={() =>
                edit((d) => {
                  d.environment.light =
                    id === "day"
                      ? { anchor: "viewport", color: "#ffffff", intensity: 1 }
                      : { anchor: "viewport", color: "#64748b", intensity: 0.35 };
                  return d;
                })
              }
            >
              {label}
            </button>
          ))}
          <button
            onClick={() =>
              edit((d) => {
                delete d.environment.light;
                return d;
              })
            }
          >
            Default
          </button>
        </div>
        <p className="hint">
          Lighting is what shades extruded buildings and hillshade, so it does nothing on a flat
          map with neither.
        </p>
      </Section>

      <Section title="Bookmarks">
        <div className="row buttons">
          <button
            onClick={() => {
              const name = window.prompt("Name this view", `View ${(project.bookmarks?.length ?? 0) + 1}`);
              if (!name) return;
              edit((d) => {
                d.bookmarks ??= [];
                d.bookmarks.push({
                  id: `bm_${Math.random().toString(36).slice(2, 8)}`,
                  name,
                  view: { ...d.view },
                });
                return d;
              });
            }}
          >
            Save this view
          </button>
        </div>
        {(project.bookmarks ?? []).map((bookmark) => (
          <div className="row" key={bookmark.id}>
            <button className="link" onClick={() => onRecall(bookmark)}>
              {bookmark.name}
            </button>
            <span className="grow" />
            <button
              className="danger"
              aria-label={`Delete ${bookmark.name}`}
              onClick={() =>
                edit((d) => {
                  d.bookmarks = (d.bookmarks ?? []).filter((b) => b.id !== bookmark.id);
                  return d;
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        {(project.bookmarks?.length ?? 0) === 0 && (
          <p className="hint">Nothing saved. A bookmark keeps the centre, zoom, pitch and bearing.</p>
        )}
      </Section>
    </div>
  );
}

/** Grids were added after the first projects were written, so fill them in. */
function defaults(draft: MapProject) {
  return (
    draft.chrome.grids ?? {
      utm: false,
      square: { enabled: false, spacing: 10000 },
      color: "#3b6ea5",
    }
  );
}
