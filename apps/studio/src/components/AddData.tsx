import { useState } from "react";
import type { Geometry, LayerNode, MapProject, WmsLayerChoice } from "@alidade/core";
import { wmsSource } from "@alidade/core";

import { readCapabilities, uploadFile, type RegisteredLayer } from "../api";

type Tab = "file" | "wms";

interface Props {
  edit: (change: (draft: MapProject) => MapProject) => void;
  onClose: () => void;
  onAdded: (id: string) => void;
}

const GEOMETRY: Record<string, Geometry> = {
  Point: "point",
  MultiPoint: "point",
  LineString: "line",
  MultiLineString: "line",
  Polygon: "polygon",
  MultiPolygon: "polygon",
};

export function AddData({ edit, onClose, onAdded }: Props) {
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
          <button className={tab === "file" ? "on" : ""} onClick={() => setTab("file")}>
            File
          </button>
          <button className={tab === "wms" ? "on" : ""} onClick={() => setTab("wms")}>
            WMS
          </button>
        </div>
        <div className="mbody">
          {tab === "file" ? (
            <FileTab edit={edit} onClose={onClose} onAdded={onAdded} />
          ) : (
            <WmsTab edit={edit} onClose={onClose} onAdded={onAdded} />
          )}
        </div>
      </div>
    </div>
  );
}

function FileTab({ edit, onClose, onAdded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RegisteredLayer | null>(null);

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const layer = await uploadFile(file);
      setDone(layer);
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
      setTimeout(onClose, 700);
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
      {done && (
        <dl className="facts">
          <div>
            <dt>Table</dt>
            <dd>{done.table}</dd>
          </div>
          <div>
            <dt>Geometry</dt>
            <dd>{done.geometryType ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Source CRS</dt>
            <dd>{done.sourceCrs ?? "unknown"}</dd>
          </div>
          <div>
            <dt>Features</dt>
            <dd>{done.featureCount ?? "—"}</dd>
          </div>
        </dl>
      )}
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
    },
  };
}
