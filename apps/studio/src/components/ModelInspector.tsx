import type { MapProject, Model3D, ModelAnchor } from "@alidade/core";
import { duplicateModel, findModel, removeModel, withModel } from "@alidade/core";

import { heightOf, metres, type ModelStatus } from "../models";
import { Field, Section, Switch } from "./Field";

interface Props {
  project: MapProject;
  id: string;
  status: ModelStatus | undefined;
  edit: (change: (draft: MapProject) => MapProject) => void;
  /** Whether the next click on the map moves this model. */
  placing: boolean;
  onPlace: (on: boolean) => void;
  onZoomTo: () => void;
  onSelect: (id: string | null) => void;
}

/**
 * One model, every number.
 *
 * The placement is edited as a surveyor would state it — where, how high,
 * facing which way, how big — because those are the questions a client asks,
 * and a matrix answers none of them. Size is offered in metres as well as as a
 * factor, once the file has arrived and its real extent is known, since "make
 * it twelve metres tall" is what someone placing a building means.
 */
export function ModelInspector({ project, id, status, edit, placing, onPlace, onZoomTo, onSelect }: Props) {
  const model = findModel(project, id);
  if (!model) {
    return (
      <aside className="inspector">
        <div className="phead">
          <span className="cap">Nothing selected</span>
        </div>
      </aside>
    );
  }

  const change = (apply: (m: Model3D) => void) => edit((d) => withModel(d, id, apply));
  const info = status?.state === "ready" ? status.info : null;
  const terrain = Boolean(project.environment.terrain);
  const height = info ? heightOf(info, model.scale) : null;

  return (
    <aside className="inspector">
      <div className="phead">
        <span className="cap" title={model.name}>
          {model.name}
        </span>
        <span className="tag">3D model</span>
      </div>

      <div className="pbody">
        {status?.state === "failed" && (
          <p className="warn">
            The file could not be loaded: {status.reason} Check the link opens in a browser tab and
            that the server sends it with permission for other origins to read it.
          </p>
        )}
        {!status && <p className="hint">Fetching the file. The size will be reported when it arrives.</p>}
        {placing && (
          <p className="warn">Click the map to put {model.name} there. Escape keeps it where it is.</p>
        )}

        <Section title="Model">
          <Field label="Name">
            <input
              className="text"
              value={model.name}
              aria-label="Model name"
              onChange={(e) => change((m) => void (m.name = e.target.value))}
            />
          </Field>
          <div className="row buttons">
            <button className={placing ? "on" : ""} onClick={() => onPlace(!placing)}>
              {placing ? "Placing…" : "Place on map"}
            </button>
            <button onClick={onZoomTo}>Zoom to</button>
            <button onClick={() => edit((d) => duplicateModel(d, id))}>Duplicate</button>
            <button
              className="danger"
              onClick={() => {
                edit((d) => removeModel(d, id));
                onSelect(null);
              }}
            >
              Remove
            </button>
          </div>
          <Switch label="Visible" on={model.visible} onChange={(on) => change((m) => void (m.visible = on))} />
          <Field label="Opacity" value={`${Math.round(model.opacity * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(model.opacity * 100)}
              onChange={(e) => change((m) => void (m.opacity = Number(e.target.value) / 100))}
            />
          </Field>
        </Section>

        <Section title="Placement">
          <Field label="Latitude">
            <input
              type="number"
              className="num wide"
              step={0.00001}
              min={-85}
              max={85}
              value={model.position[1]}
              onChange={(e) => {
                const lat = Number(e.target.value);
                if (Number.isFinite(lat)) change((m) => void (m.position = [m.position[0], lat]));
              }}
            />
          </Field>
          <Field label="Longitude">
            <input
              type="number"
              className="num wide"
              step={0.00001}
              min={-180}
              max={180}
              value={model.position[0]}
              onChange={(e) => {
                const lon = Number(e.target.value);
                if (Number.isFinite(lon)) change((m) => void (m.position = [lon, m.position[1]]));
              }}
            />
          </Field>
          <Field label="Height">
            <input
              type="number"
              className="num"
              step={0.5}
              value={model.altitude}
              aria-label="Height above the ground in metres"
              onChange={(e) => {
                const altitude = Number(e.target.value);
                if (Number.isFinite(altitude)) change((m) => void (m.altitude = altitude));
              }}
            />
            <span className="muted small">m above ground</span>
          </Field>
          <Switch
            label="Sit on the terrain"
            on={model.clamp}
            onChange={(on) => change((m) => void (m.clamp = on))}
          />
          {model.clamp && !terrain && (
            <p className="hint">
              Terrain is off, so the ground is sea level. Turn it on in the Scene pane and the model
              will stand on the hill it is on.
            </p>
          )}
          <Field label="Heading" value={`${Math.round(model.heading)}°`}>
            <input
              type="range"
              min={0}
              max={359}
              value={((model.heading % 360) + 360) % 360}
              onChange={(e) => change((m) => void (m.heading = Number(e.target.value)))}
            />
          </Field>
          <Field label="Stands on">
            <select
              value={model.anchor}
              onChange={(e) => change((m) => void (m.anchor = e.target.value as ModelAnchor))}
            >
              <option value="base">Its lowest point</option>
              <option value="origin">The file's own origin</option>
            </select>
          </Field>
          <p className="hint">
            Heading is a bearing: clockwise from north, for a file whose front faces its own +z, which
            is what glTF specifies. Files that face elsewhere just need a different number.
          </p>
        </Section>

        <Section title="Size">
          {info && (
            <Field label="In the file">
              <span className="muted small">
                {metres(info.size[0])} × {metres(info.size[1])} × {metres(info.size[2])} · {info.triangles.toLocaleString("en-US")} triangles
              </span>
            </Field>
          )}
          {info && height !== null && (
            <Field label="Height">
              <input
                type="number"
                className="num"
                step={0.1}
                min={0}
                value={Number(height.toPrecision(4))}
                aria-label="Height in metres"
                onChange={(e) => {
                  const wanted = Number(e.target.value);
                  if (!(wanted > 0) || !(info.size[1] > 0)) return;
                  change((m) => void (m.scale = wanted / info.size[1]));
                }}
              />
              <span className="muted small">m on the ground</span>
            </Field>
          )}
          <Field label="Scale">
            <input
              type="number"
              className="num"
              step={0.1}
              min={0.0001}
              value={Number(model.scale.toPrecision(4))}
              onChange={(e) => {
                const scale = Number(e.target.value);
                if (scale > 0) change((m) => void (m.scale = scale));
              }}
            />
            <span className="muted small">× the file's units</span>
          </Field>
          <p className="hint">
            glTF units are metres, so a scale of 1 is life size when the file was made properly. One
            modelled in centimetres wants 0.01. Setting the height sets the scale for you.
          </p>
        </Section>

        <Section title="Source" open={false}>
          <Field label="File">
            <span className="grow small muted" title={model.url}>
              {model.url}
            </span>
          </Field>
          {model.attribution && (
            <Field label="Credit">
              <span className="muted small">{model.attribution}</span>
            </Field>
          )}
          <Field label="Position">
            <span className="muted small">
              {model.position[1].toFixed(6)}, {model.position[0].toFixed(6)}
            </span>
          </Field>
        </Section>
      </div>
    </aside>
  );
}
