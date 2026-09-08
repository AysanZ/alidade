import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ImageRecord, MapProject } from "@alidade/core";

import { addImageryLayer, dateLabel, gsdLabel, provenance, uploadImage } from "../imagery";
import type { Extent } from "../layers";

/**
 * Bringing GeoTIFFs in.
 *
 * Each file is read, converted to a Cloud-Optimised GeoTIFF in web mercator and
 * indexed by its real footprint, and what came out is shown here before anything
 * is added to the map. That order matters: a file whose date could not be found
 * is something to notice now, while the person still remembers what the file
 * was, rather than three weeks later when the strip sorts it last.
 */

interface Props {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  onClose: () => void;
  onAdded: (id: string) => void;
  onFlyTo: (extent: Extent) => void;
}

interface Done {
  image: ImageRecord;
}

interface Failed {
  name: string;
  why: string;
}

export function ImageryTab({ edit, onClose, onAdded, onFlyTo }: Props) {
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [read, setRead] = useState<Done[]>([]);
  const [failed, setFailed] = useState<Failed[]>([]);

  const client = useQueryClient();

  const send = async (files: File[]) => {
    setBusy({ done: 0, total: files.length });
    setFailed([]);
    const arrived: Done[] = [];

    /*
     * One at a time rather than all at once. Warping a 800 MB scene is the whole
     * machine for a while, and four of them in parallel is four times the memory
     * for the same wall clock — with the added charm that the first failure
     * arrives after all four have been read.
     */
    for (const [n, file] of files.entries()) {
      try {
        arrived.push({ image: await uploadImage(file) });
      } catch (error) {
        setFailed((was) => [
          ...was,
          { name: file.name, why: error instanceof Error ? error.message : String(error) },
        ]);
      }
      setBusy({ done: n + 1, total: files.length });
    }

    setRead((was) => [...was, ...arrived]);
    setBusy(null);
    void client.invalidateQueries({ queryKey: ["imagery"] });

    if (!arrived.length) return;

    const finest = Math.min(...arrived.map((entry) => entry.image.gsd));
    const id = addImageryLayer(edit, finest);
    onAdded(id);

    // The camera goes to what just arrived, because imagery that is somewhere
    // else on the planet looks exactly like imagery that failed to load.
    const boxes = arrived.map((entry) => entry.image.bbox);
    onFlyTo({
      west: Math.min(...boxes.map((b) => b[0])),
      south: Math.min(...boxes.map((b) => b[1])),
      east: Math.max(...boxes.map((b) => b[2])),
      north: Math.max(...boxes.map((b) => b[3])),
    });
  };

  const undated = read.filter((entry) => !entry.image.datetime).length;

  return (
    <>
      <label
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (files.length) void send(files);
        }}
      >
        <input
          type="file"
          accept=".tif,.tiff,.jp2"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void send(files);
          }}
        />
        <b>
          {busy
            ? `Converting ${busy.done + 1} of ${busy.total}…`
            : "Drop GeoTIFFs here, or choose them"}
        </b>
        <span>.tif · .tiff · .jp2 — as many at once as you like</span>
      </label>

      {busy && (
        <div className="bar">
          <i style={{ width: `${(busy.done / busy.total) * 100}%` }} />
        </div>
      )}

      <p className="hint">
        Each file is read with <span className="mono">gdalinfo</span>, reprojected to EPSG:3857 and
        written as a Cloud-Optimised GeoTIFF, then indexed by its real footprint rather than its
        bounding box. A date is taken from the file&rsquo;s metadata or its filename where either
        has one, and left empty where neither does — never from when the file was last saved.
      </p>

      {failed.map((entry) => (
        <p className="error" key={entry.name}>
          {entry.name}: {entry.why}
        </p>
      ))}

      {read.map((entry) => (
        <ReadFile key={entry.image.id} image={entry.image} />
      ))}

      {undated > 0 && (
        <p className="hint">
          {undated === 1 ? "One image has" : `${undated} images have`} no date. They are on the map
          with the rest and sort last; you can give them one from the strip along the bottom
          whenever you know it.
        </p>
      )}

      {read.length > 0 && !busy && (
        <div className="mfoot">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </>
  );
}

function ReadFile({ image }: { image: ImageRecord }) {
  const date = dateLabel(image.datetime);
  const where = provenance(image.datetimeFrom);

  return (
    <div className={`readfile${date ? "" : " undated"}`}>
      <span className={`tag ${where.tone}`}>{date ?? "no date"}</span>
      <span className="name mono">{image.file}</span>
      <span className="tag">{gsdLabel(image.gsd)}</span>
      <span className="tag">{image.epsg ? `EPSG:${image.epsg}` : "no CRS"}</span>
      <span className="tag">
        {image.bands} × {image.dtype}
      </span>
    </div>
  );
}
