import { useState } from "react";
import { contributing, type ImageRecord, type MosaicRule } from "@alidade/core";

import { dateLabel, gsdLabel, sortImages, type SortKey } from "../imagery";

/**
 * The catalogue along the bottom of the map.
 *
 * Two views of one list, because they answer different questions. The cards are
 * for recognising an image — a thumbnail, a date, how much of the view it
 * reaches — and the table is for working with a hundred of them: sortable
 * columns, every field, nothing hidden behind a hover.
 *
 * Both are linked to the footprints on the map in both directions. Without that
 * the list is a list of filenames and nobody can tell which is which.
 */

interface Props {
  images: ImageRecord[];
  loading: boolean;
  selected: string | null;
  comparing: string | null;
  rule: MosaicRule;
  onSelect: (id: string) => void;
  onLock: (id: string) => void;
  onCompare: (id: string) => void;
  onHover: (id: string | null) => void;
  onAddDate: (id: string) => void;
  onClose: () => void;
}

type Tab = "cards" | "table";

export function ImageryDock(props: Props) {
  const [tab, setTab] = useState<Tab>("cards");
  const [sort, setSort] = useState<SortKey>("date");
  const [query, setQuery] = useState("");
  const [fullOnly, setFullOnly] = useState(false);

  const matching = props.images.filter((image) => {
    if (fullOnly && (image.coverage ?? 0) < 99) return false;
    if (!query) return true;
    const hay = `${image.title} ${image.file} ${image.sensor ?? ""}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });
  const shown = sortImages(matching, sort);
  const drawn = new Set(contributing(matching, props.rule).map((image) => image.id));
  const undated = matching.filter((image) => !image.datetime).length;

  return (
    <section className="imagery-dock">
      <div className="idtabs">
        <button className={tab === "cards" ? "on" : ""} onClick={() => setTab("cards")}>
          Images <span className="n">{shown.length}</span>
        </button>
        <button className={tab === "table" ? "on" : ""} onClick={() => setTab("table")}>
          Attributes
        </button>
        <div className="idright">
          {props.loading && <span className="hint">reading…</span>}
          {undated > 0 && <span className="hint">{undated} without a date</span>}
          <button className="idclose" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="idbar">
        <button
          className={`idchip${fullOnly ? " on" : ""}`}
          onClick={() => setFullOnly((on) => !on)}
          title="Only images whose footprint reaches the whole view"
        >
          Full coverage only
        </button>
        <span className="idsep" />
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="date">Newest</option>
          <option value="dateasc">Oldest</option>
          <option value="coverage">Coverage</option>
          <option value="gsd">Resolution</option>
          <option value="title">Name</option>
        </select>
        <span className="idsep" />
        <input
          className="text"
          value={query}
          placeholder="Search…"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {tab === "cards" ? (
        <Cards {...props} shown={shown} drawn={drawn} sort={sort} />
      ) : (
        <Table {...props} shown={shown} />
      )}
    </section>
  );
}

function Cards(
  props: Props & { shown: ImageRecord[]; drawn: Set<string>; sort: SortKey },
) {
  if (!props.shown.length) {
    return <div className="idempty">No imagery covers this view.</div>;
  }

  const byDate = props.sort === "date" || props.sort === "dateasc";
  let markedUndated = false;

  return (
    <div className="idcards">
      {props.shown.map((image) => {
        const first = byDate && !image.datetime && !markedUndated;
        if (first) markedUndated = true;
        return (
          <div className="idgroup" key={image.id}>
            {first && (
              <div className="iddivider">
                <i />
                <span>no date</span>
                <i />
              </div>
            )}
            <Card
              image={image}
              selected={image.id === props.selected}
              comparing={image.id === props.comparing}
              drawn={props.drawn.has(image.id)}
              onSelect={() => props.onSelect(image.id)}
              onLock={() => props.onLock(image.id)}
              onCompare={() => props.onCompare(image.id)}
              onHover={props.onHover}
              onAddDate={() => props.onAddDate(image.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * A thumbnail's colours, from the image's own id.
 *
 * A real preview is a request per card, and a strip of forty is forty requests
 * before anything is readable. What the card has to do is be distinguishable
 * from its neighbours at a glance, which a stable colour does; the picture is on
 * the map behind it.
 */
function tint(id: string): string {
  let hash = 0;
  for (let n = 0; n < id.length; n++) hash = (hash * 31 + id.charCodeAt(n)) | 0;
  const hue = Math.abs(hash) % 60;
  return `linear-gradient(135deg, hsl(${60 + hue} 18% 26%), hsl(${40 + hue} 14% 42%))`;
}

function Card({
  image,
  selected,
  comparing,
  drawn,
  onSelect,
  onLock,
  onCompare,
  onHover,
  onAddDate,
}: {
  image: ImageRecord;
  selected: boolean;
  comparing: boolean;
  drawn: boolean;
  onSelect: () => void;
  onLock: () => void;
  onCompare: () => void;
  onHover: (id: string | null) => void;
  onAddDate: () => void;
}) {
  const coverage = image.coverage ?? null;
  const date = dateLabel(image.datetime);

  return (
    <div
      className={`idcard${selected ? " sel" : ""}${comparing ? " cmp" : ""}${drawn ? " drawn" : ""}`}
      onClick={onSelect}
      onMouseEnter={() => onHover(image.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="idthumb" style={{ background: tint(image.id) }}>
        <span className="idgsd">{gsdLabel(image.gsd)}</span>
        {coverage !== null && (
          <span className={`idcov${coverage < 50 ? " low" : ""}`}>{Math.round(coverage)}%</span>
        )}
        <div className="idacts">
          <button
            title="Draw only this image"
            onClick={(e) => {
              e.stopPropagation();
              onLock();
            }}
          >
            ⊙
          </button>
          <button
            title="Compare against this image"
            onClick={(e) => {
              e.stopPropagation();
              onCompare();
            }}
          >
            ⇔
          </button>
        </div>
      </div>
      <div className="idmeta">
        <div className="idname" title={image.file}>
          {image.title}
        </div>
        <div className="idrow">
          {date ? (
            <span className={`iddate${image.datetimeFrom === "user" ? " mine" : ""}`}>{date}</span>
          ) : (
            <button
              className="idadddate"
              onClick={(e) => {
                e.stopPropagation();
                onAddDate();
              }}
            >
              ＋ date
            </button>
          )}
          <span className="idsensor">{image.sensor || "—"}</span>
        </div>
      </div>
    </div>
  );
}

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "date", label: "Captured" },
  { key: null, label: "Date from" },
  { key: null, label: "Sensor" },
  { key: "gsd", label: "GSD" },
  { key: null, label: "Cloud" },
  { key: "coverage", label: "Coverage" },
  { key: null, label: "proj:epsg" },
  { key: null, label: "Bands" },
  { key: null, label: "File" },
];

function Table(props: Props & { shown: ImageRecord[] }) {
  return (
    <div className="idtable">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.label}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.shown.map((image) => (
            <tr
              key={image.id}
              className={image.id === props.selected ? "sel" : ""}
              onClick={() => props.onSelect(image.id)}
              onMouseEnter={() => props.onHover(image.id)}
              onMouseLeave={() => props.onHover(null)}
            >
              <td>{image.title}</td>
              <td className="m">
                {dateLabel(image.datetime) ?? <span className="none">—</span>}
              </td>
              <td className="m small">{image.datetimeFrom ?? "—"}</td>
              <td>{image.sensor || "—"}</td>
              <td className="n">{gsdLabel(image.gsd)}</td>
              <td className="n">{image.cloudCover === null ? "—" : `${image.cloudCover}%`}</td>
              <td className="n">
                {image.coverage === undefined ? "—" : `${Math.round(image.coverage)}%`}
              </td>
              <td className="m">{image.epsg ? `EPSG:${image.epsg}` : "—"}</td>
              <td className="n">{image.bands}</td>
              <td className="m small">{image.file}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
