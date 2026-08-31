import { useState } from "react";
import type {
  CategorizedSymbol,
  GraduatedSymbol,
  LayerNode,
  MapProject,
  SingleSymbol,
  Symbology,
} from "@alidade/core";
import { CATEGORY_COLORS, RAMPS, equalIntervalBreaks, rampOf } from "@alidade/core";

import { Field, Section, Switch } from "./Field";

interface Props {
  layer: LayerNode;
  edit: (change: (node: LayerNode) => void) => void;
}

type Kind = Symbology["kind"];

/**
 * How a layer looks.
 *
 * The old inspector could nudge the break values of a graduated layer and
 * nothing else: an imported layer arrived as a flat colour and stayed one. This
 * is the part that makes a layer yours — the classification, the colours, the
 * stroke, the point size, and what the labels say.
 */
export function Appearance({ layer, edit }: Props) {
  const [ramp, setRamp] = useState("Blue");
  const fields = layer.metadata?.fields ?? [];
  const kind = layer.symbology.kind;

  const available: { id: Kind; label: string; needsField: boolean }[] = [
    { id: "single", label: "Single", needsField: false },
    { id: "graduated", label: "Graduated", needsField: true },
    { id: "categorized", label: "Categories", needsField: true },
    ...(layer.geometry === "polygon"
      ? [{ id: "extrusion" as Kind, label: "Extruded", needsField: true }]
      : []),
  ];

  /** Moving between classifications keeps whatever the next one can use. */
  const switchTo = (next: Kind) => {
    if (next === kind) return;
    edit((node) => {
      const colour = representative(node.symbology);
      const stroke = "stroke" in node.symbology ? node.symbology.stroke : undefined;
      const field = "field" in node.symbology ? node.symbology.field : fields[0] ?? "";

      if (next === "single") node.symbology = { kind: "single", color: colour, stroke };
      else if (next === "graduated") {
        node.symbology = {
          kind: "graduated",
          field,
          breaks: [25, 50, 75],
          colors: rampOf(RAMPS[ramp]!, 4),
          noDataColor: "#3a3a40",
          stroke,
        };
      } else if (next === "categorized") {
        node.symbology = {
          kind: "categorized",
          field,
          categories: [],
          fallbackColor: colour,
          stroke,
        };
      } else {
        node.symbology = { kind: "extrusion", color: colour, heightField: field, heightScale: 1 };
      }
    });
  };

  return (
    <>
      <Section title="Appearance">
        <div className="row buttons">
          {available.map((option) => (
            <button
              key={option.id}
              className={kind === option.id ? "on" : ""}
              disabled={option.needsField && fields.length === 0}
              title={
                option.needsField && fields.length === 0
                  ? "This layer has no attribute fields recorded"
                  : undefined
              }
              onClick={() => switchTo(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {kind === "single" && (
          <Field label="Colour">
            <input
              type="color"
              value={(layer.symbology as SingleSymbol).color}
              onChange={(e) =>
                edit((node) => void ((node.symbology as SingleSymbol).color = e.target.value))
              }
            />
          </Field>
        )}

        {(kind === "graduated" || kind === "categorized") && (
          <Field label="Field">
            <select
              value={(layer.symbology as GraduatedSymbol).field}
              onChange={(e) =>
                edit((node) => void ((node.symbology as GraduatedSymbol).field = e.target.value))
              }
            >
              {fields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </Field>
        )}

        {kind === "graduated" && (
          <Graduated symbology={layer.symbology as GraduatedSymbol} edit={edit} ramp={ramp} setRamp={setRamp} />
        )}
        {kind === "categorized" && (
          <Categorized symbology={layer.symbology as CategorizedSymbol} edit={edit} />
        )}
        {kind === "extrusion" && (
          <>
            <Field label="Height from">
              <select
                value={(layer.symbology as { heightField: string }).heightField}
                onChange={(e) =>
                  edit((node) => {
                    (node.symbology as { heightField: string }).heightField = e.target.value;
                  })
                }
              >
                {fields.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Scale"
              value={`${((layer.symbology as { heightScale?: number }).heightScale ?? 1).toFixed(2)}×`}
            >
              <input
                type="range"
                min={1}
                max={500}
                value={((layer.symbology as { heightScale?: number }).heightScale ?? 1) * 100}
                onChange={(e) =>
                  edit((node) => {
                    (node.symbology as { heightScale?: number }).heightScale =
                      Number(e.target.value) / 100;
                  })
                }
              />
            </Field>
          </>
        )}
      </Section>

      {layer.geometry !== "raster" && kind !== "extrusion" && (
        <Section title={layer.geometry === "point" ? "Marker" : "Outline"}>
          <Stroke layer={layer} edit={edit} />
        </Section>
      )}

      <Labels layer={layer} edit={edit} fields={fields} />
    </>
  );
}

function Graduated({
  symbology,
  edit,
  ramp,
  setRamp,
}: {
  symbology: GraduatedSymbol;
  edit: Props["edit"];
  ramp: string;
  setRamp: (name: string) => void;
}) {
  const classes = symbology.breaks.length + 1;
  const [low, setLow] = useState(symbology.breaks[0] ?? 0);
  const [high, setHigh] = useState(symbology.breaks[symbology.breaks.length - 1] ?? 100);

  const reclassify = (nextClasses: number, nextRamp: string, from = low, to = high) => {
    const breaks = equalIntervalBreaks(from, to, nextClasses);
    edit((node) => {
      const s = node.symbology as GraduatedSymbol;
      s.breaks = breaks;
      s.colors = rampOf(RAMPS[nextRamp] ?? RAMPS["Blue"]!, breaks.length + 1);
    });
  };

  return (
    <>
      <Field label="Ramp">
        <select
          value={ramp}
          onChange={(e) => {
            setRamp(e.target.value);
            reclassify(classes, e.target.value);
          }}
        >
          {Object.keys(RAMPS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Classes" value={classes}>
        <input
          type="range"
          min={2}
          max={9}
          value={classes}
          onChange={(e) => reclassify(Number(e.target.value), ramp)}
        />
      </Field>
      <Field label="From" value={low}>
        <input
          type="number"
          className="num"
          value={low}
          onChange={(e) => {
            setLow(Number(e.target.value));
            reclassify(classes, ramp, Number(e.target.value), high);
          }}
        />
      </Field>
      <Field label="To" value={high}>
        <input
          type="number"
          className="num"
          value={high}
          onChange={(e) => {
            setHigh(Number(e.target.value));
            reclassify(classes, ramp, low, Number(e.target.value));
          }}
        />
      </Field>

      {/* Each break is editable on its own, because equal interval is a start. */}
      {symbology.breaks.map((value, i) => (
        <Field key={i} label={`Break ${i + 1}`}>
          <input
            type="number"
            className="num"
            value={value}
            onChange={(e) =>
              edit((node) => {
                const s = node.symbology as GraduatedSymbol;
                const next = Number(e.target.value);
                // Breaks stay ascending, or the step expression stops meaning anything.
                const under = i === 0 ? -Infinity : s.breaks[i - 1]!;
                const over = i === s.breaks.length - 1 ? Infinity : s.breaks[i + 1]!;
                s.breaks[i] = Math.min(Math.max(next, under), over);
              })
            }
          />
          <input
            type="color"
            value={symbology.colors[i + 1] ?? "#4c8dff"}
            onChange={(e) =>
              edit((node) => {
                (node.symbology as GraduatedSymbol).colors[i + 1] = e.target.value;
              })
            }
          />
        </Field>
      ))}
      <div className="classes">
        {symbology.colors.map((c, i) => (
          <span key={i} style={{ background: c }} title={c} />
        ))}
      </div>
    </>
  );
}

function Categorized({ symbology, edit }: { symbology: CategorizedSymbol; edit: Props["edit"] }) {
  const [entry, setEntry] = useState("");

  return (
    <>
      <div className="row">
        <input
          className="text"
          value={entry}
          placeholder="Value, then Enter"
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !entry.trim()) return;
            edit((node) => {
              const s = node.symbology as CategorizedSymbol;
              if (s.categories.some((c) => String(c.value) === entry.trim())) return;
              s.categories.push({
                value: entry.trim(),
                color: CATEGORY_COLORS[s.categories.length % CATEGORY_COLORS.length]!,
                label: entry.trim(),
              });
            });
            setEntry("");
          }}
        />
      </div>
      {symbology.categories.map((category, i) => (
        <div className="row" key={String(category.value)}>
          <input
            type="color"
            value={category.color}
            onChange={(e) =>
              edit((node) => {
                (node.symbology as CategorizedSymbol).categories[i]!.color = e.target.value;
              })
            }
          />
          <span className="grow small">{String(category.value)}</span>
          <button
            className="danger"
            aria-label={`Remove ${String(category.value)}`}
            onClick={() =>
              edit((node) => {
                const s = node.symbology as CategorizedSymbol;
                s.categories = s.categories.filter((c) => c.value !== category.value);
              })
            }
          >
            ✕
          </button>
        </div>
      ))}
      <Field label="Everything else">
        <input
          type="color"
          value={symbology.fallbackColor}
          onChange={(e) =>
            edit((node) => void ((node.symbology as CategorizedSymbol).fallbackColor = e.target.value))
          }
        />
      </Field>
      {symbology.categories.length === 0 && (
        <p className="hint">
          Add the values you want to pick out. Opening the attribute table and sorting by the field
          is the quickest way to see what they are.
        </p>
      )}
    </>
  );
}

function Stroke({ layer, edit }: Props) {
  const symbology = layer.symbology;
  if (symbology.kind === "extrusion") return null;
  const stroke = symbology.stroke;

  return (
    <>
      <Switch
        label={layer.geometry === "point" ? "Outline" : "Draw outline"}
        on={Boolean(stroke)}
        onChange={(on) =>
          edit((node) => {
            const s = node.symbology as Exclude<Symbology, { kind: "extrusion" }>;
            if (on) s.stroke = { color: "#0a0a0b", width: 0.8 };
            else delete s.stroke;
          })
        }
      />
      {stroke && (
        <>
          <Field label="Colour">
            <input
              type="color"
              value={stroke.color}
              onChange={(e) =>
                edit((node) => {
                  const s = node.symbology as Exclude<Symbology, { kind: "extrusion" }>;
                  if (s.stroke) s.stroke.color = e.target.value;
                })
              }
            />
          </Field>
          <Field label="Width" value={`${stroke.width.toFixed(1)} px`}>
            <input
              type="range"
              min={1}
              max={80}
              value={stroke.width * 10}
              onChange={(e) =>
                edit((node) => {
                  const s = node.symbology as Exclude<Symbology, { kind: "extrusion" }>;
                  if (s.stroke) s.stroke.width = Number(e.target.value) / 10;
                })
              }
            />
          </Field>
          <Switch
            label="Dashed"
            on={Boolean(stroke.dash)}
            onChange={(on) =>
              edit((node) => {
                const s = node.symbology as Exclude<Symbology, { kind: "extrusion" }>;
                if (!s.stroke) return;
                if (on) s.stroke.dash = [3, 2];
                else delete s.stroke.dash;
              })
            }
          />
        </>
      )}
    </>
  );
}

function Labels({
  layer,
  edit,
  fields,
}: Props & { fields: string[] }) {
  const labels = layer.labels;

  return (
    <Section title="Labels">
      <Switch
        label="Show labels"
        on={Boolean(labels)}
        onChange={(on) =>
          edit((node) => {
            if (!on) {
              delete node.labels;
              return;
            }
            node.labels = {
              template: `{${fields[0] ?? "name"}}`,
              size: 11,
              color: "#e4e4e6",
              haloColor: "#050505",
              haloWidth: 1.2,
              placement: node.geometry === "line" ? "line" : "point",
            };
          })
        }
      />
      {labels && (
        <>
          <Field label="Field">
            <select
              value={labels.template}
              onChange={(e) => edit((node) => void (node.labels!.template = e.target.value))}
            >
              {fields.map((field) => (
                <option key={field} value={`{${field}}`}>
                  {field}
                </option>
              ))}
              {!fields.some((f) => `{${f}}` === labels.template) && (
                <option value={labels.template}>{labels.template}</option>
              )}
            </select>
          </Field>
          <Field label="Size" value={`${labels.size} px`}>
            <input
              type="range"
              min={8}
              max={24}
              value={labels.size}
              onChange={(e) => edit((node) => void (node.labels!.size = Number(e.target.value)))}
            />
          </Field>
          <Field label="Colour">
            <input
              type="color"
              value={labels.color}
              onChange={(e) => edit((node) => void (node.labels!.color = e.target.value))}
            />
          </Field>
          <Switch
            label="Let labels overlap"
            on={Boolean(labels.allowOverlap)}
            onChange={(on) => edit((node) => void (node.labels!.allowOverlap = on))}
          />
          <p className="hint">
            The template takes any field in braces, so <code>{"{name} · {pop_max}"}</code> works too
            if you type it.
          </p>
        </>
      )}
    </Section>
  );
}

function representative(symbology: Symbology): string {
  if (symbology.kind === "graduated") return symbology.colors[symbology.colors.length - 1] ?? "#4c8dff";
  if (symbology.kind === "categorized") return symbology.categories[0]?.color ?? symbology.fallbackColor;
  return symbology.color;
}

/** Kept beside the editor because it is the same set of decisions, inverted. */
export function describeSymbology(project: MapProject, layer: LayerNode): string {
  void project;
  const s = layer.symbology;
  if (s.kind === "graduated") return `${s.breaks.length + 1} classes on ${s.field}`;
  if (s.kind === "categorized") return `${s.categories.length} categories on ${s.field}`;
  if (s.kind === "extrusion") return `extruded by ${s.heightField}`;
  return "one colour";
}
