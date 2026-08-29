import type { MapProject } from "@alidade/core";

import { HILLSHADE } from "../project";
import { Field, Section, Switch } from "./Field";

const VIEWS = [
  { id: "2d", label: "2D", pitch: 0, bearing: 0 },
  { id: "25d", label: "2.5D", pitch: 34, bearing: -14 },
  { id: "3d", label: "3D", pitch: 58, bearing: -28 },
];

/** Relief needs a minimum scale before it reads as anything but a flat sheet. */
const TERRAIN_DENOMINATOR = 3_000_000;

export function ScenePanel({
  project,
  edit,
  denominator,
}: {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  denominator: number;
}) {
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

      <Section title="Projection">
        <div className="row buttons">
          {(["mercator", "globe"] as const).map((p) => (
            <button
              key={p}
              className={(project.environment.projection ?? "mercator") === p ? "on" : ""}
              onClick={() =>
                edit((d) => {
                  d.environment.projection = p;
                  // A globe against a black void reads as a bug, not a globe.
                  if (p === "globe") d.environment.sky = true;
                  return d;
                })
              }
            >
              {p === "mercator" ? "Mercator" : "Globe"}
            </button>
          ))}
        </div>
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
          Storage and rendering stay EPSG:3857. Globe is a way of drawing the same web mercator
          data, not a different coordinate system, and it only looks like a globe below about
          zoom 5.
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
    </div>
  );
}
