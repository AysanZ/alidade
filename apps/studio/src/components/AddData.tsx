import { useState } from "react";
import type { Geometry, LayerNode, MapProject, WmsLayerChoice } from "@alidade/core";
import { wmsSource } from "@alidade/core";

import { addFromUrl, readCapabilities, uploadFile, type RegisteredLayer } from "../api";

type Tab = "file" | "url" | "wms";

export interface Extent {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface Props {
  edit: (change: (draft: MapProject) => MapProject) => void;
  onClose: () => void;
  onAdded: (id: string) => void;
  onFlyTo: (extent: Extent) => void;
}

const GEOMETRY: Record<string, Geometry> = {
  Point: "point",
  MultiPoint: "point",
  LineString: "line",
  MultiLineString: "line",
  Polygon: "polygon",
  MultiPolygon: "polygon",
};

export function AddData(props: Props) {
  const { onClose } = props;
  const [tab, setTab] = useState<Tab>("file");

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <b>Add data</b>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="mtabs">
          {(["file", "url", "wms"] as Tab[]).map((id) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {id === "file" ? "File" : id === "url" ? "Link" : "WMS"}
            </button>
          ))}
        </div>
        <div className="mbody">
          {tab === "file" && <FileTab {...props} />}
          {tab === "url" && <UrlTab {...props} />}
          {tab === "wms" && <WmsTab {...props} />}
        </div>
      </div>
    </div>
  );
}

function FileTab({ edit, onClose, onAdded, onFlyTo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RegisteredLayer | null>(null);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const layer = await uploadFile(file);
      setDone(layer);
      place(layer, edit, onAdded, onFlyTo);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <label
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void send(file);
        }}
      >
        <input
          type="file"
          accept=".geojson,.json,.zip,.gpkg,.kml,.gpx"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void send(file);
          }}
        />
        <b>{busy ? "Importing…" : "Drop a file here, or choose one"}</b>
        <span>GeoJSON · zipped Shapefile · GeoPackage · KML · GPX</span>
      </label>

      <p className="hint">
        The file is read by ogr2ogr, reprojected to EPSG:4326, written to PostGIS and served
        straight back as vector tiles. The original CRS is kept in the layer metadata.
      </p>

      {error && <p className="error">{error}</p>}
      {done && <Facts layer={done} />}
    </>
  );
}

function Facts({ layer }: { layer: RegisteredLayer }) {
  return (
    <dl className="facts">
      <div>
        <dt>Table</dt>
        <dd>{layer.table}</dd>
      </div>
      <div>
        <dt>Geometry</dt>
        <dd>{layer.geometryType ?? "unknown"}</dd>
      </div>
      <div>
        <dt>Source CRS</dt>
        <dd>{layer.sourceCrs ?? "unknown"}</dd>
      </div>
      <div>
        <dt>Features</dt>
        <dd>{layer.featureCount ?? "—"}</dd>
      </div>
    </dl>
  );
}

/** Put an imported layer in the project and take the map to it. */
function place(
  layer: RegisteredLayer,
  edit: Props["edit"],
  onAdded: Props["onAdded"],
  onFlyTo: Props["onFlyTo"],
) {
  edit((draft) => {
    draft.sources[layer.id] = {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/${layer.id}/{z}/{x}/{y}.mvt`],
      maxzoom: 16,
    };
    draft.tree.unshift(vectorLayer(layer));
    return draft;
  });
  onAdded(layer.id);
  if (layer.extent) onFlyTo(layer.extent);
}

function UrlTab({ edit, onClose, onAdded, onFlyTo }: Props) {
  const [url, setUrl] = useState(
    "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_populated_places_simple.geojson",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RegisteredLayer | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const layer = await addFromUrl(url);
      setDone(layer);
      place(layer, edit, onAdded, onFlyTo);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row">
        <input
          className="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.org/places.geojson"
        />
        <button className="primary" onClick={() => void send()} disabled={busy || !url}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      <p className="hint">
        GDAL reads the link over HTTP and writes straight into PostGIS, so the file is never
        downloaded to your machine. A link ending in .zip is treated as a zipped Shapefile.
      </p>
      {error && <p className="error">{error}</p>}
      {done && <Facts layer={done} />}
    </>
  );
}

function WmsTab({ edit, onClose, onAdded }: Props) {
  const [url, setUrl] = useState("https://ows.terrestris.de/osm/service");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<{ url: string; version: string; formats: string[]; layers: WmsLayerChoice[] } | null>(null);
  const [chosen, setChosen] = useState<WmsLayerChoice | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    setServer(null);
    try {
      const described = await readCapabilities(url);
      setServer(described);
      setChosen(described.layers[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!server || !chosen) return;
    const id = `wms_${chosen.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    edit((draft) => {
      draft.sources[id] = wmsSource({
        url: server.url,
        layers: chosen.name,
        version: server.version === "1.1.1" ? "1.1.1" : "1.3.0",
        styles: chosen.styles[0] ?? "",
        format: server.formats.includes("image/png") ? "image/png" : server.formats[0],
      });
      draft.tree.unshift({
        type: "layer",
        id,
        name: chosen.title,
        slot: "data",
        source: id,
        geometry: "raster",
        visible: true,
        opacity: 1,
        symbology: { kind: "single", color: "#ffffff" },
        metadata: { sourceCrs: chosen.crs[0] ?? "EPSG:3857" },
      });
      return draft;
    });
    onAdded(id);
    onClose();
  };

  return (
    <>
      <div className="row">
        <input
          className="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.org/geoserver/wms"
        />
        <button className="primary" onClick={() => void connect()} disabled={busy}>
          {busy ? "Reading…" : "Connect"}
        </button>
      </div>
      <p className="hint">
        Alidade reads GetCapabilities so you pick a layer, style and format the server actually
        advertises, rather than typing a name and hoping.
      </p>

      {error && <p className="error">{error}</p>}

      {server && (
        <>
          <p className="hint">
            {server.layers.length} layers · WMS {server.version}
          </p>
          <ul className="picker">
            {server.layers.slice(0, 60).map((layer) => (
              <li
                key={layer.name}
                className={chosen?.name === layer.name ? "on" : ""}
                onClick={() => setChosen(layer)}
              >
                <b>{layer.title}</b>
                <span>{layer.name}</span>
                {layer.queryable && <em>queryable</em>}
              </li>
            ))}
          </ul>
          <div className="mfoot">
            <button className="primary" onClick={add} disabled={!chosen}>
              Add layer
            </button>
          </div>
        </>
      )}
    </>
  );
}

function vectorLayer(layer: RegisteredLayer): LayerNode {
  return {
    type: "layer",
    id: layer.id,
    name: layer.title,
    slot: "data",
    source: layer.id,
    sourceLayer: layer.id,
    geometry: GEOMETRY[layer.geometryType ?? ""] ?? "polygon",
    visible: true,
    opacity: 1,
    symbology: {
      kind: "single",
      color: "#4c8dff",
      stroke: { color: "#0a0a0b", width: 0.6 },
    },
    metadata: {
      sourceCrs: layer.sourceCrs ?? undefined,
      featureCount: layer.featureCount ?? undefined,
      fields: layer.fields,
      extent: layer.extent ?? undefined,
    },
  };
}
