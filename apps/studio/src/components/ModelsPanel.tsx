import { useRef, useState } from "react";
import type { MapProject, Model3D } from "@alidade/core";
import { GLOBE_IS_ROUND_BELOW, describeModel, looksLikeModel, nameFromUrl } from "@alidade/core";

import { SAMPLES, heightOf, metres, uploadModel, type ModelStatus, type Sample } from "../models";
import { Section, Switch } from "./Field";

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
}: Props) {
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
          zoom in past zoom {GLOBE_IS_ROUND_BELOW} on the Globe projection.
        </p>
      )}
      {!globe && flat && items.length > 0 && (
        <p className="hint">
          The camera is looking straight down, which is the one angle a model looks flat from. Tilt
          it: 2.5D or 3D in the Scene pane, or drag with the right mouse button.
        </p>
      )}

      <Section title="Add a model">
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
