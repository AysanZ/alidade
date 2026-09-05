import { useRef, useState } from "react";
import type { MapProject, Model3D } from "@alidade/core";
import type { LayerNode, SpreadOptions } from "@alidade/core";
import {
  GLOBE_IS_ROUND_BELOW,
  describeModel,
  findTrack,
  looksLikeModel,
  nameFromUrl,
  disc,
  newAnnotation,
  newModel,
  newTrack,
  speedOf,
  trackLength,
} from "@alidade/core";

import { SAMPLES, heightOf, metres, uploadModel, type ModelStatus, type Sample } from "../models";
import { Field, Section, Switch } from "./Field";

interface Props {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  status: Record<string, ModelStatus>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Put a file on the map, at the centre of the view, and take the camera to it. */
  onAdd: (model: Pick<Model3D, "url" | "name"> & Partial<Model3D>) => void;
  onZoomTo: (id: string) => void;
  onRemove: (id: string) => void;
  onProblem: (message: string) => void;
  /** The scene is not being drawn because the map is a sphere. */
  globe: boolean;
  /** Point layers a model can be placed over. */
  pointLayers: LayerNode[];
  onSpread: (layerId: string, options: SpreadOptions) => void;
  playing: boolean;
  onPlay: (on: boolean) => void;
  /** Where each moving model is right now. Not in the document; a few times a second. */
  live: Record<string, { position: [number, number]; heading: number; covered: number }>;
}

/**
 * The 3D models pane.
 *
 * Three ways in — the catalogue, a link, a file — and one list out. Selecting
 * a placement opens it in the inspector, where the numbers are; this pane is
 * for getting things onto the map and finding them again.
 */
export function ModelsPanel({
  project,
  edit,
  status,
  selected,
  onSelect,
  onAdd,
  onZoomTo,
  onRemove,
  onProblem,
  globe,
  pointLayers,
  onSpread,
  playing,
  onPlay,
  live,
}: Props) {
  const [overLayer, setOverLayer] = useState("");
  const [limit, setLimit] = useState(200);
  const [headingField, setHeadingField] = useState("");
  const [pathId, setPathId] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const models = project.models;
  const items = models?.items ?? [];
  const flat = project.view.pitch === 0;
  const round =
    project.environment.projection === "vertical-perspective" ||
    (project.environment.projection === "globe" && project.view.zoom <= GLOBE_IS_ROUND_BELOW);

  const addSample = (sample: Sample) =>
    onAdd({
      url: sample.url,
      name: sample.name,
      attribution: sample.attribution,
      ...(sample.scale !== undefined ? { scale: sample.scale } : {}),
    });

  const addLink = () => {
    const url = link.trim();
    if (!url) return;
    if (!looksLikeModel(url)) {
      return onProblem("That link does not end in .glb or .gltf, so the renderer will not know how to read it.");
    }
    onAdd({ url, name: nameFromUrl(url) });
    setLink("");
  };

  /*
   * The server is asked first, because a URL it hands back survives a refresh.
   * When there is no server — the studio is running against nothing, or the
   * API is an older build — the file is kept in this tab's memory instead and
   * the user is told so, rather than told nothing and left with a model that
   * vanishes on reload.
   */
  const load = async (chosen: File) => {
    if (!looksLikeModel(chosen.name)) {
      return onProblem(`${chosen.name} is not a .glb or .gltf file. Export the model as binary glTF and try again.`);
    }
    setBusy(true);
    try {
      const stored = await uploadModel(chosen);
      onAdd({ url: stored.url, name: stored.name });
    } catch (error) {
      const url = URL.createObjectURL(chosen);
      onAdd({ url, name: nameFromUrl(chosen.name) });
      onProblem(
        `${error instanceof Error ? error.message : String(error)} The file is on the map for this session only and will not be in the saved project.`,
      );
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="pane">
      {(globe || round) && (
        <p className="warn">
          Models are not drawn on a sphere. Switch the projection to Mercator in the Scene pane, or
          zoom in past zoom {GLOBE_IS_ROUND_BELOW} on the Globe projection, which is where
          MapLibre hands the globe over to mercator.
        </p>
      )}
      {!globe && flat && items.length > 0 && (
        <p className="hint">
          The camera is looking straight down, which is the one angle a model looks flat from. Tilt
          it: 2.5D or 3D in the Scene pane, or drag with the right mouse button.
        </p>
      )}

      <Section title="Add a model">
        <div className="row buttons">
          <button
            className="primary"
            onClick={() => {
              /*
               * Something moving, without having to place a model, draw a path
               * and press play to find out whether any of it works.
               *
               * An airliner at three thousand metres on a fifteen kilometre
               * circuit: big enough on the ground to be followed from the zoom
               * you were already at, and slow enough across the screen to
               * watch. The circuit is an ordinary drawing and the track an
               * ordinary track, so everything it made can then be taken apart,
               * retimed or sent somewhere else.
               */
              const centre = project.view.center;
              const ring = disc(centre, 15000, 72);
              const plane = newModel({
                url: "builtin:aircraft",
                name: "Airliner",
                position: ring[0]!,
                altitude: 3000,
                // Height above the ground, not above the hill under it: an
                // aircraft's altitude is not a property of the terrain.
                clamp: false,
                minPixels: 34,
                attribution: "Alidade · Apache-2.0",
              });
              const path = newAnnotation("line", "#4c8dff");
              path.coordinates = ring;
              path.name = "Flight circuit";

              edit((d) => {
                /*
                 * A sphere draws no models at all, so a demo started under one
                 * puts an aircraft on a circuit that nobody can see and reads
                 * as a broken button. The demo is a demonstration: it makes the
                 * conditions it needs rather than reporting that they are
                 * missing.
                 */
                if (d.environment.projection && d.environment.projection !== "mercator") {
                  d.environment.projection = "mercator";
                }
                d.models ??= { visible: true, items: [] };
                d.models.items = [...d.models.items, plane];
                d.models.tracks = [
                  ...(d.models.tracks ?? []),
                  { ...newTrack(`tr_${plane.id}`, plane.id, ring), duration: 90 },
                ];
                d.annotations ??= { visible: true, opacity: 1, features: [] };
                d.annotations.features.push(path);
                return d;
              });
              onSelect(plane.id);
              onPlay(true);
            }}
          >
            Fly a demo
          </button>
        </div>
        <p className="hint">
          Puts an airliner on a fifteen kilometre circuit around the middle of the view
          and starts it, so there is something moving to look at before you have placed
          anything. It is an ordinary placement on an ordinary drawing: take it apart,
          retime it, or send it somewhere else.
        </p>
        <ul className="picker samples">
          {SAMPLES.map((sample) => (
            <li key={sample.id} onClick={() => addSample(sample)} title={sample.hint}>
              <b>{sample.name}</b>
              <span>
                {sample.size} · {sample.attribution}
              </span>
              <em>Add</em>
            </li>
          ))}
        </ul>
        <div className="row">
          <input
            className="text"
            value={link}
            placeholder="https://…/building.glb"
            aria-label="Link to a glTF file"
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addLink();
            }}
          />
          <button className="primary" disabled={!link.trim()} onClick={addLink}>
            Add
          </button>
        </div>
        <div className="row buttons">
          <button onClick={() => file.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Upload a .glb file"}
          </button>
          <input
            ref={file}
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void load(chosen);
            }}
          />
        </div>
        <p className="hint">
          Binary glTF is the format to export. A .gltf that refers to textures in other files will
          load only if those files sit beside it at the same address. Draco compression is handled.
        </p>
      </Section>

      {items.length > 0 && (
        <Section title="On the map" extra={items.length}>
          <Switch
            label="Show 3D models"
            on={models?.visible ?? true}
            onChange={(on) =>
              edit((d) => {
                if (d.models) d.models.visible = on;
                return d;
              })
            }
          />
          <ul className="drawlist models">
            {items.map((model) => {
              const state = status[model.id];
              return (
                <li
                  key={model.id}
                  className={model.id === selected ? "on" : model.visible ? "" : "off"}
                  onClick={() => onSelect(model.id === selected ? null : model.id)}
                >
                  <button
                    className="eye"
                    title={model.visible ? "Hide" : "Show"}
                    aria-label={`${model.visible ? "Hide" : "Show"} ${model.name}`}
                    aria-pressed={model.visible}
                    onClick={(e) => {
                      e.stopPropagation();
                      edit((d) => {
                        const target = d.models?.items.find((m) => m.id === model.id);
                        if (target) target.visible = !target.visible;
                        return d;
                      });
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
                      <circle cx="12" cy="12" r="2.6" />
                    </svg>
                  </button>
                  <span className="name" title={`${model.name} · ${describeModel(model)}`}>
                    {model.name}
                  </span>
                  {state?.state === "failed" ? (
                    <span className="tag flag" title={state.reason}>
                      failed
                    </span>
                  ) : state?.state === "ready" ? (
                    <span className="value" title="Height on the ground at the current scale">
                      {metres(heightOf(state.info, model.scale))}
                    </span>
                  ) : (
                    <span className="value loading">loading</span>
                  )}
                  <button
                    title="Zoom to"
                    aria-label={`Zoom to ${model.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onZoomTo(model.id);
                    }}
                  >
                    ⤢
                  </button>
                  <button
                    className="danger"
                    title="Remove"
                    aria-label={`Remove ${model.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(model.id);
                    }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="hint">
            Click a model on the map to select it. The inspector has its position, height, heading
            and size; Place on map moves it with a click.
          </p>
        </Section>
      )}

      {selected && (
        <Section title="Place over a layer">
          <p className="hint">
            One copy of the selected model at every point of a layer. Forty turbines
            dropped by hand is forty chances to put one in the wrong field; the same
            forty taken from the layer that already knows where they are is right by
            construction.
          </p>
          {pointLayers.length === 0 ? (
            <p className="hint">No point layers on the map yet.</p>
          ) : (
            <>
              <Field label="Layer">
                <select value={overLayer} onChange={(e) => setOverLayer(e.target.value)}>
                  <option value="">Choose one</option>
                  {pointLayers.map((layer) => (
                    <option key={layer.id} value={layer.id}>
                      {layer.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Bearing from">
                <select value={headingField} onChange={(e) => setHeadingField(e.target.value)}>
                  <option value="">The model's own heading</option>
                  {(pointLayers.find((l) => l.id === overLayer)?.metadata?.fields ?? []).map(
                    (field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="At most" value={String(limit)}>
                <input
                  type="range"
                  min={10}
                  max={1000}
                  step={10}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </Field>
              <div className="row buttons">
                <button
                  className="primary"
                  disabled={!overLayer}
                  onClick={() =>
                    onSpread(overLayer, {
                      limit,
                      headingField: headingField || undefined,
                    })
                  }
                >
                  Place at every point
                </button>
              </div>
              <p className="hint">
                Taken from what is drawn on the screen now, because a vector tile is the
                only copy of the geometry the browser has. Zoom to the layer first, and
                the count that comes back is the count that was there.
              </p>
            </>
          )}
        </Section>
      )}

      {selected && (
        <Section title="Movement">
          {(() => {
            const model = items.find((m) => m.id === selected);
            const track = findTrack(models?.tracks, selected);
            const paths = (project.annotations?.features ?? []).filter((f) => f.kind === "line");
            if (!model) return null;

            if (!track) {
              const circuit = (radius: number) =>
                edit((d) => {
                  /*
                   * A ready-made route, so movement can be seen without having
                   * to draw one first. It is a real drawing rather than a
                   * hidden path: it appears in the table of contents, exports
                   * as a GeoJSON line, and its vertices can be dragged, which
                   * a generated path nobody could see or edit could not.
                   *
                   * `disc` builds it geodesically, so the circuit is the same
                   * radius on the ground all the way round.
                   */
                  const ring = disc(model.position, radius, 64);
                  const drawn = newAnnotation("line", "#4c8dff");
                  drawn.coordinates = ring;
                  drawn.name = `Circuit, ${radius} m`;
                  d.annotations ??= { visible: true, opacity: 1, features: [] };
                  d.annotations.features.push(drawn);
                  d.models ??= { visible: true, items: [] };
                  d.models.tracks = [
                    ...(d.models.tracks ?? []),
                    newTrack(`tr_${selected}`, selected, ring),
                  ];
                  return d;
                });

              return paths.length === 0 ? (
                <>
                  <p className="hint">
                    Nothing drawn to follow yet. Take a circuit around where it stands,
                    or draw a line with the drawing tools and come back.
                  </p>
                  <div className="row buttons">
                    <button onClick={() => circuit(150)}>Circle it, 150 m</button>
                    <button onClick={() => circuit(600)}>600 m</button>
                  </div>
                </>
              ) : (
                <>
                  <Field label="Along">
                    <select value={pathId} onChange={(e) => setPathId(e.target.value)}>
                      <option value="">Choose a drawing</option>
                      {paths.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="row buttons">
                    <button onClick={() => circuit(150)}>Circle it</button>
                    <button
                      className="primary"
                      disabled={!pathId}
                      onClick={() => {
                        const path = paths.find((p) => p.id === pathId);
                        if (!path) return;
                        edit((d) => {
                          d.models ??= { visible: true, items: [] };
                          d.models.tracks = [
                            ...(d.models.tracks ?? []),
                            newTrack(`tr_${selected}`, selected, path.coordinates),
                          ];
                          return d;
                        });
                      }}
                    >
                      Send it along this
                    </button>
                  </div>
                </>
              );
            }

            return (
              <>
                <Field label="Lap time" value={`${track.duration}s`}>
                  <input
                    type="range"
                    min={5}
                    max={600}
                    step={5}
                    value={track.duration}
                    onChange={(e) =>
                      edit((d) => {
                        const t = findTrack(d.models?.tracks, selected);
                        if (t) t.duration = Number(e.target.value);
                        return d;
                      })
                    }
                  />
                </Field>
                <Field label="Turn to face" value={`${track.headingOffset ?? 0}°`}>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={15}
                    value={track.headingOffset ?? 0}
                    onChange={(e) =>
                      edit((d) => {
                        const t = findTrack(d.models?.tracks, selected);
                        if (t) t.headingOffset = Number(e.target.value);
                        return d;
                      })
                    }
                  />
                </Field>
                <Switch
                  label="Repeat"
                  on={track.loop}
                  onChange={(on) =>
                    edit((d) => {
                      const t = findTrack(d.models?.tracks, selected);
                      if (t) t.loop = on;
                      return d;
                    })
                  }
                />
                <div className="row buttons">
                  <button className={playing ? "" : "primary"} onClick={() => onPlay(!playing)}>
                    {playing ? "Stop" : "Play"}
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      onPlay(false);
                      edit((d) => {
                        d.models!.tracks = (d.models?.tracks ?? []).filter(
                          (t) => t.model !== selected,
                        );
                        return d;
                      });
                    }}
                  >
                    Remove track
                  </button>
                </div>
                {live[selected] && (
                  <>
                    <Field label="Now at" value={`${live[selected]!.position[1].toFixed(5)}, ${live[selected]!.position[0].toFixed(5)}`}>
                      <span className="grow" />
                    </Field>
                    <Field label="Heading" value={`${Math.round(live[selected]!.heading)}°`}>
                      <span className="grow" />
                    </Field>
                    <Field
                      label="Covered"
                      value={`${(live[selected]!.covered / 1000).toFixed(2)} km`}
                    >
                      <span className="grow" />
                    </Field>
                  </>
                )}
                <p className="hint">
                  {Math.round(trackLength(track.path)).toLocaleString()} m at{" "}
                  {speedOf(track).toFixed(1)} m/s, which is{" "}
                  {(speedOf(track) * 3.6).toFixed(0)} km/h. The path is saved with the
                  project; where the model is at this instant is not, so playing it is not
                  an edit and cannot be undone into.
                </p>
              </>
            );
          })()}
        </Section>
      )}

      {items.length === 0 && (
        <div className="empty">
          <b>Nothing on the map yet</b>
          <p>
            Pick one from the catalogue to see how it works, or bring your own building, vehicle or
            sensor housing as a .glb. Every placement is part of the project, so it is saved,
            exported and undone like anything else.
          </p>
        </div>
      )}
    </div>
  );
}
