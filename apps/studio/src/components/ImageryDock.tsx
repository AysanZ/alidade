import { useEffect, useRef, useState } from "react";
import type { ImageRecord } from "@alidade/core";

import { dateLabel, gsdLabel, sortImages, type SortKey } from "../imagery";

/**
 * Every field of every image, in a table.
 *
 * The pictures moved to the sidebar; this is what is left, and it is the half a
 * GIS user actually works with once there are a hundred images: sortable
 * columns, every attribute, nothing behind a hover. It is the footprint table of
 * a mosaic dataset by another name.
 */

interface Props {
  images: ImageRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onClose: () => void;
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

export function ImageryDock(props: Props) {
  const [sort, setSort] = useState<SortKey>("date");
  /*
   * Resizable, like the layer attribute table. Ten columns in 240 pixels is a
   * table you have to scroll to read one row of, and the whole reason to open
   * this rather than the sidebar is seeing many rows at once.
   */
  const [height, setHeight] = useState(260);
  const drag = useRef<{ from: number; at: number } | null>(null);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return;
      const next = drag.current.from + (drag.current.at - event.clientY);
      setHeight(Math.max(120, Math.min(next, window.innerHeight - 220)));
    };
    const up = () => (drag.current = null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const shown = sortImages(props.images, sort);

  return (
    /*
     * `dock` as well as `imagery-dock`. The app grid reserves its bottom row
     * with `.app:has(.dock)`, so a panel that only carried its own class was
     * laid out past the bottom of the window: present, correct and invisible.
     */
    <section className="dock imagery-dock" style={{ height }}>
      <div
        className="dockgrip"
        title="Drag to resize"
        onMouseDown={(e) => (drag.current = { from: height, at: e.clientY })}
      />
      <header>
        <b>Imagery</b>
        <span className="n">{shown.length}</span>
        <div className="spacer" />
        <button onClick={props.onClose}>Close</button>
      </header>

      <div className="tablewrap idtable">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.label}
                  className={column.key ? "sortable" : ""}
                  onClick={() => column.key && setSort(column.key)}
                >
                  {column.label}
                  {column.key === sort && <span className="srt">▾</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((image) => (
              <tr
                key={image.id}
                className={image.id === props.selected ? "sel" : ""}
                onClick={() => props.onSelect(image.id)}
                onMouseEnter={() => props.onHover(image.id)}
                onMouseLeave={() => props.onHover(null)}
              >
                <td>{image.title}</td>
                <td className="m">{dateLabel(image.datetime) ?? <span className="none">—</span>}</td>
                <td className="m small">{image.datetimeFrom ?? "—"}</td>
                <td>{image.sensor || "—"}</td>
                <td className="n">{gsdLabel(image.gsd)}</td>
                <td className="n">{image.cloudCover === null ? "—" : `${image.cloudCover}%`}</td>
                <td className="n">
                  {image.coverage === undefined ? "—" : `${image.coverage.toFixed(1)}%`}
                </td>
                <td className="m">{image.epsg ? `EPSG:${image.epsg}` : "—"}</td>
                <td className="n">{image.bands}</td>
                <td className="m small">{image.file}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
