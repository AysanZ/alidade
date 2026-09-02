import { useEffect, useMemo, useRef, useState } from "react";

import type { Cell, FeatureRow } from "../api";
import { useFeatures } from "../queries";
import type { Extent } from "./AddData";

interface Props {
  layerId: string;
  title: string;
  /** A feature picked on the map, to be found and shown in the table. */
  focus?: { field: string; value: string } | null;
  /** The layer's source is what a highlight has to filter on. */
  onSelect: (field: string, values: (string | number)[], hover: boolean) => void;
  onZoom: (extent: Extent) => void;
  onClose: () => void;
}

const LIMIT = 100;

/**
 * The attribute table.
 *
 * Natural Earth's populated places has thirty eight columns. The old table put
 * every one of them in a row that could only grow sideways, so the pager, the
 * close button and most of the data ended up somewhere past the edge of the
 * screen with no way back. Four things fix that and none of them is truncation:
 * the header and the first column stay put while the rest scrolls, columns can
 * be turned off, the panel can be dragged taller, and there is a search box so
 * you can find the row instead of hunting for it.
 */
export function AttributeTable({ layerId, title, focus, onSelect, onZoom, onClose }: Props) {
  const [offset, setOffset] = useState(0);
  const [order, setOrder] = useState<string | undefined>(undefined);
  const [descending, setDescending] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [height, setHeight] = useState(240);
  const [chosen, setChosen] = useState<number | null>(null);

  /*
   * A feature clicked on the map has to be findable in a table of nine thousand
   * rows, and it will usually be on a page you are not looking at. Searching for
   * it is how you get to it in one request rather than paging through.
   */
  useEffect(() => {
    if (!focus) return;
    setSearch(focus.value);
    setQuery(focus.value);
    setOffset(0);
  }, [focus]);

  /* the search box waits for a pause rather than a request per keystroke */
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  /*
   * One page of rows.
   *
   * This was a `useEffect` with a `live` flag, which is the correct hand-rolled
   * answer to the race and still leaves three things undone: the request that
   * lost the race carried on running, the rows of the *previous* layer stayed on
   * screen under the new layer's title until the first page landed, and clicking
   * a column header emptied the table for as long as the sort took.
   */
  const request = { limit: LIMIT, offset, order, descending, search: query };
  const { data: page = null, error, isFetching } = useFeatures(layerId, request);

  /* a new layer is a new set of columns, so forget which ones were hidden */
  useEffect(() => {
    setHidden(new Set());
    setChosen(null);
    setOffset(0);
    setSearch("");
  }, [layerId]);

  const shown = useMemo(
    () => (page ? page.fields.filter((f) => !hidden.has(f)) : []),
    [page, hidden],
  );

  const key = page?.key ?? page?.fields[0] ?? null;

  const highlight = (row: FeatureRow | null, hover: boolean) => {
    if (!key) return;
    if (!row) return onSelect(key, [], hover);
    const value = row.values?.[key];
    if (value === null || typeof value === "boolean") return;
    onSelect(key, [value], hover);
  };

  const drag = useRef<{ from: number; at: number } | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return;
      const next = drag.current.from + (drag.current.at - event.clientY);
      setHeight(Math.max(120, Math.min(window.innerHeight - 220, next)));
    };
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  /* once the page arrives, put the focused row on the screen and mark it */
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus || !page) return;
    const at = page.rows.findIndex((row) => String(row.values?.[focus.field] ?? "") === focus.value);
    if (at < 0) return;
    setChosen(at);
    const row = body.current?.querySelectorAll("tbody tr")[at];
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, page]);

  const lastPage = page ? offset + LIMIT >= page.total : true;

  return (
    <section className="dock" style={{ height }}>
      <div
        className="dockgrip"
        title="Drag to resize"
        onMouseDown={(e) => (drag.current = { from: height, at: e.clientY })}
      />
      <header>
        <b>{title}</b>
        <span className="muted small">
          {page
            ? `${page.total.toLocaleString("en-US")} rows · ${page.fields.length} fields`
            : "loading"}
        </span>
        {/*
          The page that is on the screen while the next one is on its way is the
          previous one, deliberately. Saying so is cheaper than blanking it.
        */}
        {isFetching && page && (
          <span className="muted small" aria-live="polite">
            updating…
          </span>
        )}

        <input
          className="tablesearch"
          value={search}
          placeholder="Search every column…"
          onChange={(e) => setSearch(e.target.value)}
        />

        <button className={picking ? "on" : ""} onClick={() => setPicking(!picking)}>
          Columns{hidden.size > 0 ? ` · ${shown.length}/${page?.fields.length ?? 0}` : ""}
        </button>

        <div className="grow" />
        <span className="muted small">
          {page && page.total > 0 ? `${offset + 1}–${Math.min(offset + LIMIT, page.total)}` : "—"}
        </span>
        <button onClick={() => setOffset(Math.max(0, offset - LIMIT))} disabled={offset === 0}>
          Previous
        </button>
        <button onClick={() => setOffset(offset + LIMIT)} disabled={lastPage}>
          Next
        </button>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {picking && page && (
        <div className="columnpicker">
          {page.fields.map((field) => (
            <label key={field}>
              <input
                type="checkbox"
                checked={!hidden.has(field)}
                onChange={(e) =>
                  setHidden((previous) => {
                    const next = new Set(previous);
                    if (e.target.checked) next.delete(field);
                    else next.add(field);
                    return next;
                  })
                }
              />
              {field}
            </label>
          ))}
          <button onClick={() => setHidden(new Set())}>Show all</button>
          <button
            onClick={() => setHidden(new Set(page.fields.slice(6)))}
            title="Keep the first six"
          >
            Show fewer
          </button>
        </div>
      )}

      {error && (
        <p className="error">{error instanceof Error ? error.message : String(error)}</p>
      )}

      <div className="tablewrap" ref={body} onMouseLeave={() => highlight(null, true)}>
        {page && (
          <table>
            <thead>
              <tr>
                <th className="rownum">#</th>
                {shown.map((field) => (
                  <th
                    key={field}
                    onClick={() => {
                      if (order === field) setDescending(!descending);
                      else {
                        setOrder(field);
                        setDescending(false);
                      }
                      setOffset(0);
                    }}
                    title="Sort by this field"
                  >
                    {field}
                    {order === field && (descending ? " ▴" : " ▾")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, i) => (
                <tr
                  key={i}
                  className={chosen === i ? "on" : ""}
                  onMouseEnter={() => highlight(row, true)}
                  onClick={() => {
                    setChosen(i);
                    highlight(row, false);
                    if (row.bounds) onZoom(row.bounds);
                  }}
                  title={row.bounds ? "Click to select and fly to this feature" : "No geometry"}
                >
                  <td className="rownum">{offset + i + 1}</td>
                  {shown.map((field) => (
                    <td key={field} className={typeof row.values?.[field] === "number" ? "num" : ""}>
                      {show(row.values?.[field])}
                    </td>
                  ))}
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td className="rownum" />
                  <td colSpan={Math.max(1, shown.length)} className="muted">
                    {query ? `Nothing matches “${query}”.` : "This layer has no rows."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function show(value: Cell | undefined) {
  if (value === null || value === undefined) return <i>NULL</i>;
  if (value === "") return <i>empty</i>;
  return String(value);
}
