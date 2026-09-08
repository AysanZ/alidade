import { useState } from "react";
import {
  estimateCoverage,
  contributing,
  type ImageRecord,
  type ImagerySettings,
  type MosaicRule,
  type Overlap,
} from "@alidade/core";

import { dateLabel, gsdLabel, provenance, type ImageEdit } from "../imagery";
import { Field, Section, Segmented } from "./Field";

/**
 * Everything about the imagery that is not the pixels.
 *
 * Split down the middle, and labelled, because the two halves belong to
 * different things. The mosaic rule and the rendering are properties of the
 * layer — one stretch, one band combination, one rule for all of it. The title,
 * the date and the sensor are properties of one image. Blurring the two is
 * exactly where somebody sets a stretch for a single date and cannot work out
 * why every other date changed too.
 */

interface Props {
  settings: ImagerySettings;
  images: ImageRecord[];
  selected: ImageRecord | null;
  onSettings: (change: (settings: ImagerySettings) => ImagerySettings) => void;
  onEditImage: (id: string, changes: ImageEdit) => void;
  onRemoveImage: (id: string) => void;
  onZoomTo: (image: ImageRecord) => void;
}

const RULES: { kind: MosaicRule["kind"]; label: string; why: string }[] = [
  {
    kind: "lock",
    label: "Locked image only",
    why: "One image, whatever it covers. The strip is the only way to change what is drawn.",
  },
  {
    kind: "closest",
    label: "Closest to a date",
    why: "Every image is a candidate, sorted by how far its date is from the target. Gaps fill from the next closest.",
  },
  {
    kind: "newest",
    label: "Most recent first",
    why: "The newest image wins wherever it has pixels; older ones show through where it does not.",
  },
  {
    kind: "sharpest",
    label: "Finest resolution first",
    why: "A five centimetre survey draws over a ten metre satellite tile.",
  },
  {
    kind: "centre",
    label: "Best covering of the view",
    why: "The image that reaches most of the screen wins, so you are not shown the corner of a scene.",
  },
];

const PRESETS: { label: string; bands: number[] }[] = [
  { label: "True colour · 4,3,2", bands: [3, 2, 1] },
  { label: "False colour · 8,4,3", bands: [4, 3, 2] },
];

export function ImageryPanel(props: Props) {
  const { settings, images, selected } = props;
  const rule = settings.rule;
  const drawn = contributing(images, rule);
  const coverage = estimateCoverage(drawn);

  return (
    <aside className="inspector">
      <div className="phead">
        <span className="cap">Imagery</span>
        <span className="tag">{images.length} images</span>
      </div>
      <div className="pbody">
        <Section title="Mosaic rule" extra="layer">

          <Field label="Sort by">
            <select
              className="grow"
              value={rule.kind}
              onChange={(e) => {
                const kind = e.target.value as MosaicRule["kind"];
                props.onSettings((s) => ({ ...s, rule: newRule(kind, s.rule, selected) }));
              }}
            >
              {RULES.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          {rule.kind === "closest" && (
            <Field label="Target date">
              <input
                type="date"
                className="text grow"
                value={rule.date.slice(0, 10)}
                onChange={(e) =>
                  props.onSettings((s) => ({ ...s, rule: { kind: "closest", date: e.target.value } }))
                }
              />
            </Field>
          )}

          {rule.kind === "lock" && (
            <Field label="Locked to">
              <span className="tag good grow">
                {images.find((i) => i.id === rule.image)?.title ?? "nothing"}
              </span>
              <button
                className="btn"
                onClick={() => props.onSettings((s) => ({ ...s, rule: { kind: "newest" } }))}
              >
                Clear
              </button>
            </Field>
          )}

          <Field label="Overlap">
            <select
              className="grow"
              value={settings.overlap}
              onChange={(e) =>
                props.onSettings((s) => ({ ...s, overlap: e.target.value as Overlap }))
              }
            >
              <option value="first">First — topmost wins</option>
              <option value="blend">Blend — average the seam</option>
              <option value="max">Maximum value</option>
            </select>
          </Field>

          {/*
            How much of the screen the rule actually fills. Without it "nine
            images here" is ambiguous between nine images of this ground and
            nine that clip one corner of the view, which are different answers.
          */}
          <div className="coverage">
            <div className={`covbar${coverage < 99 ? " part" : ""}`}>
              <i style={{ width: `${coverage}%` }} />
            </div>
            <p className="hint">
              {drawn.length} image{drawn.length === 1 ? "" : "s"} drawn ·{" "}
              {coverage >= 99
                ? "the view is covered"
                : `about ${coverage}% of the view, the rest shows the basemap`}
            </p>
          </div>

          <p className="hint">{RULES.find((option) => option.kind === rule.kind)?.why}</p>
        </Section>

        <Rendering settings={settings} onSettings={props.onSettings} />

        {selected ? (
          <ImageFacts
            image={selected}
            onEdit={(changes) => props.onEditImage(selected.id, changes)}
            onRemove={() => props.onRemoveImage(selected.id)}
            onZoomTo={() => props.onZoomTo(selected)}
          />
        ) : (
          <Section title="Selected image" extra="image">
            <p className="hint">Choose an image below to see and edit what is known about it.</p>
          </Section>
        )}
      </div>
    </aside>
  );
}

/** Carry what the old rule knew into the new one, rather than resetting it. */
function newRule(
  kind: MosaicRule["kind"],
  previous: MosaicRule,
  selected: ImageRecord | null,
): MosaicRule {
  if (kind === "lock") {
    const image =
      previous.kind === "lock" ? previous.image : selected?.id ?? "";
    return { kind: "lock", image };
  }
  if (kind === "closest") {
    const date =
      previous.kind === "closest"
        ? previous.date
        : selected?.datetime?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    return { kind: "closest", date };
  }
  return { kind };
}

function Rendering({
  settings,
  onSettings,
}: {
  settings: ImagerySettings;
  onSettings: Props["onSettings"];
}) {
  const render = settings.render;
  const set = (change: Partial<ImagerySettings["render"]>) =>
    onSettings((s) => ({ ...s, render: { ...s.render, ...change } }));

  return (
    <Section title="Rendering" extra="layer">

      <Field label="Mode">
        <Segmented
          value={render.mode}
          options={[
            { value: "rgb" as const, label: "RGB" },
            { value: "single" as const, label: "Single" },
            { value: "expression" as const, label: "Expression" },
          ]}
          onChange={(mode) => set({ mode })}
        />
      </Field>

      {render.mode === "rgb" && (
        <Field label="Bands">
          <select
            className="grow"
            value={(render.bands ?? [1, 2, 3]).join(",")}
            onChange={(e) => set({ bands: e.target.value.split(",").map(Number) })}
          >
            {PRESETS.map((preset) => (
              <option key={preset.label} value={preset.bands.join(",")}>
                {preset.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {render.mode === "expression" && (
        <>
          <div className="stack">
            <span className="k">Expression</span>
            <input
              className="text mono"
              value={render.expression ?? ""}
              placeholder="(b4-b3)/(b4+b3)"
              onChange={(e) => set({ expression: e.target.value })}
            />
          </div>
          <Field label="Ramp">
            <select
              className="grow"
              value={render.colormap ?? "rdylgn"}
              onChange={(e) => set({ colormap: e.target.value })}
            >
              <option value="rdylgn">RdYlGn</option>
              <option value="viridis">viridis</option>
              <option value="spectral">Spectral</option>
              <option value="greys">Greys</option>
            </select>
          </Field>
          {/*
            The whole reason a dynamic tiler was worth the dependency. An index
            is a string, evaluated per tile, and costs nothing on disk; the
            alternative is a derived raster per index per date, which is how a
            folder of four files becomes a folder of forty.
          */}
          <p className="hint">
            Band maths, evaluated per tile. <span className="mono">b1</span> is the first band as
            GDAL numbers them.
          </p>
        </>
      )}

      <Field label="Stretch">
        <Segmented
          value={render.rescale ? "manual" : "auto"}
          options={[
            { value: "auto" as const, label: "Automatic" },
            { value: "manual" as const, label: "Manual" },
          ]}
          onChange={(mode) =>
            set({ rescale: mode === "manual" ? render.rescale ?? [[0, 3000]] : undefined })
          }
        />
      </Field>

      {render.rescale && (
        <Field label="Range">
          <input
            type="number"
            className="text mono"
            value={render.rescale[0]![0]}
            onChange={(e) => set({ rescale: [[Number(e.target.value), render.rescale![0]![1]]] })}
          />
          <span className="between">→</span>
          <input
            type="number"
            className="text mono"
            value={render.rescale[0]![1]}
            onChange={(e) => set({ rescale: [[render.rescale![0]![0], Number(e.target.value)]] })}
          />
        </Field>
      )}

      <Field label="Resample">
        <select
          className="grow"
          value={render.resampling ?? "bilinear"}
          onChange={(e) => set({ resampling: e.target.value as never })}
        >
          <option value="bilinear">Bilinear</option>
          <option value="nearest">Nearest</option>
          <option value="cubic">Cubic</option>
        </select>
      </Field>
    </Section>
  );
}

function ImageFacts({
  image,
  onEdit,
  onRemove,
  onZoomTo,
}: {
  image: ImageRecord;
  onEdit: (changes: ImageEdit) => void;
  onRemove: () => void;
  onZoomTo: () => void;
}) {
  const [title, setTitle] = useState(image.title);
  const where = provenance(image.datetimeFrom);

  return (
    <Section title="Selected image" extra="image">

      <Field label="Title">
        <input
          className="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== image.title && onEdit({ title })}
        />
      </Field>

      <Field label="Captured">
        <input
          type="date"
          className="text"
          value={dateLabel(image.datetime) ?? ""}
          onChange={(e) =>
            onEdit(
              e.target.value
                ? { captured_at: `${e.target.value}T00:00:00Z` }
                : { clear_date: true },
            )
          }
        />
        <span className={`tag ${where.tone}`}>{where.label}</span>
      </Field>

      <Field label="Sensor">
        <input
          className="text"
          defaultValue={image.sensor ?? ""}
          placeholder="Sentinel-2, drone…"
          onBlur={(e) => onEdit({ sensor: e.target.value || null })}
        />
      </Field>

      <div className="stack">
        <span className="k">Note</span>
        <textarea
          className="text"
          rows={2}
          defaultValue={image.note ?? ""}
          onBlur={(e) => onEdit({ note: e.target.value || null })}
        />
      </div>

      <p className="hint">{where.note}</p>
      <p className="hint">
        Edits are kept in Alidade&rsquo;s registry and never written back into your{" "}
        <span className="mono">.tif</span>.
      </p>

      <dl className="facts">
        <div>
          <dt>File</dt>
          <dd className="mono">{image.file}</dd>
        </div>
        <div>
          <dt>proj:epsg</dt>
          <dd className="mono">{image.epsg ? `EPSG:${image.epsg}` : "unknown"}</dd>
        </div>
        <div>
          <dt>gsd</dt>
          <dd className="mono">{gsdLabel(image.gsd)}</dd>
        </div>
        <div>
          <dt>Bands</dt>
          <dd className="mono">
            {image.bands} · {image.dtype}
          </dd>
        </div>
      </dl>

      <div className="pair">
        <button className="btn" onClick={onZoomTo}>
          Zoom to
        </button>
        <button className="btn danger" onClick={onRemove}>
          Remove
        </button>
      </div>
    </Section>
  );
}
