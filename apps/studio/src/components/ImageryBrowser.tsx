import { useMemo, useState } from "react";
import { contributing, type ImageRecord, type MosaicRule } from "@alidade/core";

import { dateLabel, gsdLabel, sortImages, type SortKey } from "../imagery";

/**
 * The images covering the view.
 *
 * In the sidebar rather than along the bottom, because this is the contents of
 * the imagery layer and the sidebar is where a layer's contents belong. It also
 * gives the pictures a column instead of a strip: a horizontal row of thumbnails
 * shows six at a time and hides the rest behind a scroll nobody discovers,
 * whereas two columns down the side show a dozen at once, which is the number
 * that makes a coverage gap in a date range visible at all.
 *
 * The thumbnail is a real read of the image, not a colour derived from its name.
 * That was the first version and it was useless: every card looked like every
 * other card, so the strip told you how many images there were and nothing else.
 */

interface Props {
  images: ImageRecord[];
  loading: boolean;
  selected: string | null;
  rule: MosaicRule;
  /**
   * Whether the catalogue is being asked about the view or about everything.
   *
   * Owned by whoever runs the query, because it changes what is fetched rather
   * than what is filtered. Selecting an image flies the camera to it, and the
   * next answer is then "the images over that airfield" — which is right, and
   * leaves no way back to the whole catalogue unless there is a switch for it.
   */
  scope: "view" | "all";
  onScope: (scope: "view" | "all") => void;
  /** A position someone pressed and held on the map, while it is set. */
  at: [number, number] | null;
  onClearPoint: () => void;
  /** A box drawn on the map, and whether one is being drawn now. */
  area: { west: number; south: number; east: number; north: number } | null;
  drawingArea: boolean;
  onDrawArea: () => void;
  onClearArea: () => void;
  onSelect: (id: string) => void;
  onLock: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Opens the full attribute table, which does not fit in a sidebar. */
  onAttributes: () => void;
}

/** Ten years of scenes at one airfield is a range, not a list. */
interface Window {
  from: string;
  to: string;
}

export function ImageryBrowser(props: Props) {
  const [sort, setSort] = useState<SortKey>("date");
  /*
   * Shut by default, and it stays where it is put. Four controls that appear
   * and disappear as they become relevant reflow the panel under the pointer,
   * so the thumbnail somebody was about to click moves out from under it.
   */
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [window, setWindow] = useState<Window>({ from: "", to: "" });
  const [query, setQuery] = useState("");
  const [undatedToo, setUndatedToo] = useState(true);

  /*
   * The span the catalogue actually covers, for the date inputs' own limits.
   * Offering a picker that ranges over the whole of time when every image is
   * from one decade is offering a control that mostly produces nothing.
   */
  const span = useMemo(() => {
    const dates = props.images
      .map((image) => image.datetime)
      .filter((value): value is string => Boolean(value))
      .sort();
    return dates.length ? { first: dates[0]!.slice(0, 10), last: dates.at(-1)!.slice(0, 10) } : null;
  }, [props.images]);

  const matching = props.images.filter((image) => {
    if (query) {
      const hay = `${image.title} ${image.file} ${image.sensor ?? ""}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    const day = image.datetime?.slice(0, 10);
    if (!day) {
      // An undated image cannot be in or out of a date range, so it is shown
      // unless it is deliberately switched off. Silently dropping it would make
      // the count disagree with the list, and the ones without dates are exactly
      // the ones somebody needs to find and fix.
      return undatedToo;
    }
    if (window.from && day < window.from) return false;
    if (window.to && day > window.to) return false;
    return true;
  });

  const shown = sortImages(matching, sort);
  const drawn = new Set(contributing(matching, props.rule).map((image) => image.id));
  const filtered = props.images.length - matching.length;
  const active = [window.from, window.to, query].filter(Boolean).length + (undatedToo ? 0 : 1);

  return (
    <section className="browser">
      <header>
        <span className="cap">Imagery here</span>
        <span className="count" title={props.at ? "Images covering that position" : undefined}>
          {shown.length}
          {filtered > 0 && <em> of {props.images.length}</em>}
        </span>
        {/*
          A dot, not a word. "reading…" appearing and vanishing on every pan
          re-laid out the header under the pointer, and the catalogue is
          re-queried on every camera move — so that was most of the time.
        */}
        <span className={`pulse${props.loading ? " on" : ""}`} aria-hidden />
        <button className="attrs" onClick={props.onAttributes} title="Every field, in a table">
          Attributes
        </button>
      </header>

      {props.area ? (
        <div className="atpoint area">
          <span className="pin" aria-hidden>
            <MarqueeIcon />
          </span>
          <span className="coords">{areaLabel(props.area)}</span>
          <button onClick={props.onClearArea} title="Back to the view">
            ✕
          </button>
        </div>
      ) : props.at ? (
        /*
         * While a point is pinned it is the whole question, so the scope switch
         * gets out of the way rather than sitting there looking selectable and
         * doing nothing.
         */
        <div className="atpoint">
          <span className="pin" aria-hidden>
            ✛
          </span>
          <span className="coords">
            {props.at[1].toFixed(4)}° {props.at[1] >= 0 ? "N" : "S"} ·{" "}
            {props.at[0].toFixed(4)}° {props.at[0] >= 0 ? "E" : "W"}
          </span>
          <button
            className={props.drawingArea ? "on" : ""}
            onClick={props.onDrawArea}
            title="Draw a box to search inside"
          >
            <MarqueeIcon />
          </button>
          <button onClick={props.onClearPoint} title="Back to the view">
            ✕
          </button>
        </div>
      ) : (
        <div className="scope">
          <button
            className={props.scope === "view" ? "on" : ""}
            onClick={() => props.onScope("view")}
          >
            This view
          </button>
          <button
            className={props.scope === "all" ? "on" : ""}
            onClick={() => props.onScope("all")}
          >
            Everything
          </button>
          {/*
            Draw an area. Beside the two scopes because it is a third answer to
            the same question — which ground the panel is reporting on — and not
            a separate feature that happens to live nearby.
          */}
          {/*
            Labelled, not a glyph. A bare rectangle next to two words reads as
            decoration; "Area" next to "This view" and "Everything" reads as the
            third answer to the same question, which is what it is.
          */}
          <button
            className={`draw${props.drawingArea ? " on" : ""}`}
            onClick={props.onDrawArea}
            title="Draw a box on the map and search inside it"
            aria-pressed={props.drawingArea}
          >
            <MarqueeIcon />
            Area
          </button>
        </div>
      )}

      {props.drawingArea && (
        <p className="legend drawing">
          <i />
          Drag a box on the map. Escape to cancel.
        </p>
      )}

      <button className="disclose" onClick={() => setFiltersOpen((open) => !open)}>
        <span className="chev">{filtersOpen ? "▾" : "▸"}</span>
        Filter and sort
        {active > 0 && <span className="badge">{active}</span>}
      </button>

      <div className={`filters${filtersOpen ? "" : " shut"}`}>
        <div className="dates">
          <input
            type="date"
            className="text"
            value={window.from}
            min={span?.first}
            max={span?.last}
            title="From"
            onChange={(e) => setWindow((w) => ({ ...w, from: e.target.value }))}
          />
          <span className="between">→</span>
          <input
            type="date"
            className="text"
            value={window.to}
            min={span?.first}
            max={span?.last}
            title="To"
            onChange={(e) => setWindow((w) => ({ ...w, to: e.target.value }))}
          />
        </div>

        <div className="line">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="date">Newest first</option>
            <option value="dateasc">Oldest first</option>
            <option value="coverage">Most of the view</option>
            <option value="gsd">Finest first</option>
            <option value="title">Name</option>
          </select>
          <button
            className="clear"
            disabled={active === 0}
            onClick={() => {
              setWindow({ from: "", to: "" });
              setQuery("");
              setUndatedToo(true);
            }}
          >
            Clear
          </button>
        </div>

        <input
          className="text"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <label className="undated">
          <input
            type="checkbox"
            checked={undatedToo}
            onChange={(e) => setUndatedToo(e.target.checked)}
          />
          include images with no date
        </label>
      </div>

      {!props.at && shown.length > 0 && (
        <p className="legend gesture">
          <i className="none" />
          Press and hold anywhere on the map to list only the images covering that spot.
        </p>
      )}

      {shown.length > 0 && (
        <p className="legend">
          <i />
          {props.rule.kind === "lock" ? (
            <>Click any image to draw it. The marked one is on the map now.</>
          ) : (
            <>
              {drawn.size} marked {drawn.size === 1 ? "image is" : "images are"} what the{" "}
              {ruleName(props.rule)} rule draws; the others are covered by them. Click one to draw
              it on its own.
            </>
          )}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="hint pad">
          {props.images.length === 0
            ? props.area
              ? "No image reaches that box."
              : props.at
              ? "No image covers that position."
              : props.scope === "view"
                ? "No imagery covers this view. Zoom out, or switch to Everything."
                : "No imagery yet. Add some from Add data → Imagery."
            : "Nothing in that range."}
        </p>
      ) : (
        <ul className="thumbs">
          {shown.map((image) => (
            <Thumb
              key={image.id}
              image={image}
              selected={image.id === props.selected}
              drawn={drawn.has(image.id)}
              onSelect={() => props.onSelect(image.id)}
              onLock={() => props.onLock(image.id)}
              onHover={props.onHover}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A selection marquee: a dashed box with corner handles. */
function MarqueeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2.5" />
      <circle cx="4" cy="6" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="20" cy="18" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A drawn box, in ground units rather than degrees.
 *
 * Half a degree means nothing to anybody; three kilometres by two is the same
 * fact in the units the scale bar is already using.
 */
function areaLabel(area: { west: number; south: number; east: number; north: number }): string {
  const metresPerDegree = 111_320;
  const mid = ((area.north + area.south) / 2) * (Math.PI / 180);
  const wide = (area.east - area.west) * metresPerDegree * Math.cos(mid);
  const tall = (area.north - area.south) * metresPerDegree;
  const say = (metres: number) =>
    metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
  return `${say(wide)} × ${say(tall)}`;
}

/** The rule in the words the panel's own dropdown uses. */
function ruleName(rule: MosaicRule): string {
  switch (rule.kind) {
    case "closest":
      return "closest to " + rule.date.slice(0, 10);
    case "sharpest":
      return "finest resolution";
    case "centre":
      return "best covering";
    default:
      return "most recent";
  }
}

function Thumb({
  image,
  selected,
  drawn,
  onSelect,
  onLock,
  onHover,
}: {
  image: ImageRecord;
  selected: boolean;
  drawn: boolean;
  onSelect: () => void;
  onLock: () => void;
  onHover: (id: string | null) => void;
}) {
  const [failed, setFailed] = useState(false);
  const coverage = image.coverage ?? null;
  const date = dateLabel(image.datetime);

  return (
    <li
      className={`thumb${selected ? " sel" : ""}${drawn ? " drawn" : ""}`}
      onClick={onSelect}
      onDoubleClick={onLock}
      onMouseEnter={() => onHover(image.id)}
      onMouseLeave={() => onHover(null)}
      title={`${image.file}\n${date ?? "no date"} · ${gsdLabel(image.gsd)}${
        coverage !== null ? ` · covers ${Math.round(coverage)}% of the view` : ""
      }`}
    >
      <div className="shot">
        {failed ? (
          <div className="broken">no preview</div>
        ) : (
          <img
            src={`/api/rasters/${encodeURIComponent(image.id)}/preview.png?size=256`}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
          />
        )}
        <span className="gsd">{gsdLabel(image.gsd)}</span>
        {coverage !== null && coverage >= 1 && (
          <span className={`cov${coverage < 50 ? " low" : ""}`}>{Math.round(coverage)}%</span>
        )}
        {/* Being under another image is not the same as being broken, and a
            card with no mark at all cannot tell you which it is. */}
        {!drawn && <span className="hidden">not drawn</span>}
      </div>

      <div className="caption">
        <span className={`date${image.datetimeFrom === "user" ? " mine" : ""}${date ? "" : " none"}`}>
          {date ?? "no date"}
        </span>
        <span className="name">{image.title}</span>
      </div>
    </li>
  );
}
