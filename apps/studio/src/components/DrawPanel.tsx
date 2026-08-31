import { useRef, useState } from "react";
import type { Annotation, MapProject } from "@alidade/core";
import {
  bufferGeoJSON,
  bufferSourceId,
  describe,
  formatDistance,
  read,
  write,
  type ExchangeFormat,
} from "@alidade/core";

import { Field, Section, Switch } from "./Field";
import type { DrawSession } from "../useDrawing";

interface Props {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  session: DrawSession;
  active: Annotation | undefined;
  onStart: (kind: Annotation["kind"], measure?: "distance" | "area" | null) => void;
  onStop: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onGoTo: (lon: number, lat: number) => void;
  onProblem: (message: string) => void;
}

const TOOLS = [
  { kind: "point" as const, measure: null, label: "Point", hint: "Click once" },
  { kind: "line" as const, measure: null, label: "Line", hint: "Click, then Enter" },
  { kind: "polygon" as const, measure: null, label: "Area", hint: "Click, then Enter" },
];

const MEASURES = [
  { kind: "line" as const, measure: "distance" as const, label: "Distance", hint: "Along the ground" },
  { kind: "polygon" as const, measure: "area" as const, label: "Area", hint: "On the sphere" },
];

const FORMATS: { id: ExchangeFormat; label: string }[] = [
  { id: "geojson", label: "GeoJSON" },
  { id: "kml", label: "KML" },
  { id: "gpx", label: "GPX" },
  { id: "csv", label: "CSV" },
  { id: "wkt", label: "WKT" },
];

/**
 * Drawing, measuring and buffering.
 *
 * Measuring is drawing that reports a number, so it is the same tool underneath
 * and the same list afterwards: a measurement you can keep, rename and export is
 * more useful than one that disappears when the panel closes.
 */
export function DrawPanel(props: Props) {
  const { project, edit, session, active, onStart, onStop, onFinish, onCancel, onGoTo, onProblem } = props;
  const annotations = project.annotations;
  const features = annotations?.features ?? [];
  const units = project.chrome.scaleBar.units;

  const [bufferOf, setBufferOf] = useState<string | null>(null);
  const [radius, setRadius] = useState(500);
  const file = useRef<HTMLInputElement>(null);

  const applyBuffer = (id: string | null, metres: number) => {
    setBufferOf(id);
    setRadius(metres);
    edit((d) => {
      const source = bufferSourceId();
      if (!id || metres <= 0) {
        delete d.sources[source];
        d.tree = d.tree.filter((n) => n.id !== "buffer");
        return d;
      }
      d.sources[source] = { type: "geojson", data: bufferGeoJSON(d.annotations, [id], metres) };
      if (!d.tree.some((n) => n.id === "buffer")) {
        d.tree.unshift({
          type: "layer",
          id: "buffer",
          name: "Buffer",
          slot: "overlay",
          source,
          geometry: "polygon",
          visible: true,
          opacity: 0.45,
          symbology: { kind: "single", color: "#4c8dff", stroke: { color: "#4c8dff", width: 1 } },
        });
      }
      return d;
    });
  };

  const download = (format: ExchangeFormat) => {
    if (features.length === 0) return onProblem("There is nothing drawn to export.");
    const written = write(project.annotations, format, project.id, units);
    const blob = new Blob([written.text], { type: written.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = written.filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const load = async (chosen: File) => {
    try {
      const imported = read(await chosen.text(), chosen.name.replace(/\.[^.]+$/, ""));
      if (imported.length === 0) {
        return onProblem(`Nothing in ${chosen.name} could be read as GeoJSON, KML, GPX, CSV or WKT.`);
      }
      edit((d) => {
        d.annotations ??= { visible: true, opacity: 1, features: [] };
        d.annotations.features.push(...imported);
        return d;
      });
      const first = imported[0]?.coordinates[0];
      if (first) onGoTo(first[0], first[1]);
    } catch (error) {
      onProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="pane">
      <Section title="Draw">
        <div className="row buttons">
          {TOOLS.map((tool) => (
            <button
              key={tool.label}
              className={session.mode === tool.kind && !session.measure ? "on" : ""}
              title={tool.hint}
              onClick={() =>
                session.mode === tool.kind && !session.measure ? onStop() : onStart(tool.kind, null)
              }
            >
              {tool.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Measure">
        <div className="row buttons">
          {MEASURES.map((tool) => (
            <button
              key={tool.label}
              className={session.measure === tool.measure ? "on" : ""}
              title={tool.hint}
              onClick={() =>
                session.measure === tool.measure ? onStop() : onStart(tool.kind, tool.measure)
              }
            >
              {tool.label}
            </button>
          ))}
        </div>
        <p className="hint">
          Distances and areas are computed on the sphere, not on the screen. A length read off web
          mercator is too long by one over the cosine of the latitude, which at Tehran is a fifth.
        </p>
      </Section>

      {session.mode && (
        <Section title="In progress">
          <p className="hint">
            {active
              ? `${active.coordinates.length} point${active.coordinates.length === 1 ? "" : "s"} · ${describe(active, units)}`
              : "Click the map to start. Enter finishes, Escape cancels."}
          </p>
          <div className="row buttons">
            <button onClick={onFinish} disabled={!active}>
              Finish
            </button>
            <button className="danger" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </Section>
      )}

      {annotations && features.length > 0 && (
        <>
          <Section title={`Drawings · ${features.length}`}>
            <Switch
              label="Show drawings"
              on={annotations.visible}
              onChange={(on) =>
                edit((d) => {
                  d.annotations!.visible = on;
                  return d;
                })
              }
            />
            <ul className="drawlist">
              {features.map((feature) => (
                <li key={feature.id}>
                  <span className="swatch" style={{ background: feature.color }} />
                  <span className="name" title={feature.name}>
                    {feature.name}
                  </span>
                  <span className="value">{describe(feature, units)}</span>
                  <button
                    title="Zoom to"
                    onClick={() => {
                      const [lon, lat] = feature.coordinates[0] ?? [0, 0];
                      onGoTo(lon, lat);
                    }}
                  >
                    ⤢
                  </button>
                  <button
                    title="Rename"
                    onClick={() => {
                      const name = window.prompt("Name", feature.name);
                      if (!name) return;
                      edit((d) => {
                        const target = d.annotations?.features.find((f) => f.id === feature.id);
                        if (target) target.name = name;
                        return d;
                      });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="danger"
                    title="Delete"
                    onClick={() => {
                      if (bufferOf === feature.id) applyBuffer(null, 0);
                      edit((d) => {
                        if (d.annotations) {
                          d.annotations.features = d.annotations.features.filter(
                            (f) => f.id !== feature.id,
                          );
                        }
                        return d;
                      });
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="row buttons">
              <button
                className="danger"
                onClick={() => {
                  applyBuffer(null, 0);
                  edit((d) => {
                    if (d.annotations) d.annotations.features = [];
                    return d;
                  });
                }}
              >
                Clear all
              </button>
            </div>
          </Section>

          <Section title="Buffer">
            <Field label="Around">
              <select value={bufferOf ?? ""} onChange={(e) => applyBuffer(e.target.value || null, radius)}>
                <option value="">Nothing</option>
                {features.map((feature) => (
                  <option key={feature.id} value={feature.id}>
                    {feature.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Radius" value={formatDistance(radius, units)}>
              <input
                type="range"
                min={50}
                max={20000}
                step={50}
                value={radius}
                onChange={(e) => applyBuffer(bufferOf, Number(e.target.value))}
              />
            </Field>
            <p className="hint">
              The buffer is geodesic: a disc at each vertex and a rectangle along each segment, left
              overlapping rather than dissolved. The union is the same region either way.
            </p>
          </Section>
        </>
      )}

      <Section title="Exchange">
        <div className="row buttons">
          {FORMATS.map((format) => (
            <button key={format.id} onClick={() => download(format.id)}>
              {format.label}
            </button>
          ))}
        </div>
        <div className="row buttons">
          <button onClick={() => file.current?.click()}>Import a file…</button>
          <input
            ref={file}
            type="file"
            accept=".geojson,.json,.kml,.gpx,.csv,.txt,.wkt"
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void load(chosen);
              e.target.value = "";
            }}
          />
        </div>
        <p className="hint">
          The format is worked out from what is in the file rather than from its extension, so a
          .txt full of GeoJSON still reads as GeoJSON.
        </p>
      </Section>
    </div>
  );
}
