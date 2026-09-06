import type { MapProject, Model3D, ModelAnchor } from "@alidade/core";
import { GLOBE_IS_ROUND_BELOW, duplicateModel, findModel, removeModel, withModel } from "@alidade/core";

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

        <LiveSection project={project} model={model} change={change} />

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

/**
 * Which live asset this model stands in for.
 *
 * Placed after the placement section rather than inside it, because turning it
 * on takes the placement away: the position and, if it faces forward, the
 * heading stop being numbers the user sets and become numbers the feed sends.
 * A control that quietly disables the two sliders above it should not be one of
 * them.
 */
function LiveSection({
  project,
  model,
  change,
}: {
  project: MapProject;
  model: Model3D;
  change: (apply: (m: Model3D) => void) => void;
}) {
  const assets = project.assets;
  const follow = model.follow;
  const reporting = assets?.items ?? [];
  /*
   * The asset the model names, even when the feed is not currently reporting it
   * — a vehicle that has gone off shift is still the vehicle this model is for,
   * and dropping the selection because it went quiet would mean re-choosing it
   * every morning.
   */
  const missing = follow !== undefined && !reporting.some((a) => a.id === follow.asset);

  return (
    <Section title="Live movement" open={follow !== undefined}>
      {!assets && (
        <p className="hint">This project has no live layer, so there is nothing to follow.</p>
      )}
      {assets && (
        <>
          <Field label="Driven by">
            <select
              value={follow?.asset ?? ""}
              aria-label="The live asset this model follows"
              onChange={(e) =>
                change((m) => {
                  if (!e.target.value) delete m.follow;
                  else {
                    m.follow = {
                      ...(m.follow ?? { faceForward: true, fromZoom: 14 }),
                      asset: e.target.value,
                    };
                  }
                })
              }
            >
              <option value="">Nothing · stands still</option>
              {missing && <option value={follow.asset}>{follow.asset} · not reporting</option>}
              {reporting.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.label ?? asset.id}
                </option>
              ))}
            </select>
          </Field>

          {!follow && reporting.length === 0 && (
            <p className="hint">
              Nothing is reporting yet. Switch the feed on from the Live assets row in the table of
              contents and the assets will appear here.
            </p>
          )}

          {follow && (
            <>
              <Switch
                label="Turn to face the way it is going"
                on={follow.faceForward}
                onChange={(on) => change((m) => void (m.follow!.faceForward = on))}
              />
              {/*
                The same correction a track offers, for the same reason: a file
                whose front is not its own +z drives sideways down the road, and
                that is a fact about the file rather than about the feed.
              */}
              {follow.faceForward && (
                <Field label="Turn by" value={`${Math.round(follow.headingOffset ?? 0)}°`}>
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={((follow.headingOffset ?? 0) % 360 + 360) % 360}
                    aria-label="Degrees added to the heading"
                    onChange={(e) =>
                      change((m) => void (m.follow!.headingOffset = Number(e.target.value)))
                    }
                  />
                </Field>
              )}
              <Field label="Drawn from" value={`z ${follow.fromZoom ?? 14}`}>
                <input
                  type="range"
                  min={GLOBE_IS_ROUND_BELOW}
                  max={20}
                  value={follow.fromZoom ?? 14}
                  aria-label="The zoom the model appears at"
                  onChange={(e) => change((m) => void (m.follow!.fromZoom = Number(e.target.value)))}
                />
              </Field>
              <p className="hint">
                The model stands in for the asset from this zoom in; further out the feed&rsquo;s own
                dot is what is on the map. A 3D scene is not drawn at all below zoom{" "}
                {GLOBE_IS_ROUND_BELOW}, where the map is still a sphere, so that is the floor.
              </p>
              {missing && (
                <p className="hint">
                  {follow.asset} is not in the feed at the moment, so the model is standing where it
                  was last put.
                </p>
              )}
            </>
          )}
        </>
      )}
    </Section>
  );
}
