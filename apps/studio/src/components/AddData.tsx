import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MapProject, WmsLayerChoice } from "@alidade/core";
import { wmsSource } from "@alidade/core";

import type { RegisteredLayer } from "../api";
import { useCapabilities, useImportLayer } from "../queries";
import { place, type Extent } from "../layers";
import { uniqueId } from "../tree";
import { SAMPLES, SAMPLE_GROUPS } from "../samples";
import { Catalogue } from "./Catalogue";

type Tab = "catalogue" | "samples" | "file" | "url" | "wms";

export type { Extent };

interface Props {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  onClose: () => void;
  onAdded: (id: string) => void;
  onFlyTo: (extent: Extent) => void;
}

export function AddData(props: Props) {
  const { onClose } = props;
  const [tab, setTab] = useState<Tab>("catalogue");

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
          {(["catalogue", "samples", "file", "url", "wms"] as Tab[]).map((id) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {id === "catalogue"
                ? "In the database"
                : id === "samples"
                  ? "Open data"
                  : id === "file"
                    ? "File"
                    : id === "url"
                      ? "Link"
                      : "WMS"}
            </button>
          ))}
        </div>
        <div className="mbody">
          {tab === "catalogue" && (
            <Catalogue
              project={props.project}
              edit={props.edit}
              onAdded={(id) => {
                props.onAdded(id);
                onClose();
              }}
              onFlyTo={props.onFlyTo}
            />
          )}
          {tab === "samples" && <SamplesTab {...props} />}
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

  const client = useQueryClient();
  const { upload } = useImportLayer();

  const send = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const layer = await upload.mutateAsync(file);
      setDone(layer);
      place(layer, edit, onAdded, onFlyTo, client);
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

/**
 * Open datasets, imported through the ordinary from-url route.
 *
 * Nothing here is special-cased: each one goes through GDAL into PostGIS and
 * comes back as vector tiles, exactly as a link you typed would. The list exists
 * because a fresh install has one demo layer in it and nothing to look at.
 */
function SamplesTab({ edit, onAdded, onFlyTo }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  const client = useQueryClient();
  const { fromUrl } = useImportLayer();

  const bring = async (name: string, url: string) => {
    setBusy(url);
    setError(null);
    try {
      const layer = await fromUrl.mutateAsync({ url, name: `${name}.geojson` });
      place(layer, edit, onAdded, onFlyTo, client);
      setDone((previous) => [...previous, url]);
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <p className="hint">
        Public domain data from Natural Earth. Each one is read over HTTP by GDAL and written to
        PostGIS, so it is yours after the first import and the dialog is not needed again.
      </p>
      {error && <p className="error">{error}</p>}

      {SAMPLE_GROUPS.map((group) => (
        <section className="sect" key={group}>
          <h2>{group}</h2>
          <ul className="picker">
            {SAMPLES.filter((sample) => sample.group === group).map((sample) => (
              <li
                key={sample.url}
                className={done.includes(sample.url) ? "used" : ""}
                onClick={() => !busy && !done.includes(sample.url) && void bring(sample.name, sample.url)}
              >
                <b>{sample.name}</b>
                <span>{sample.about}</span>
                <em>
                  {busy === sample.url ? "importing…" : done.includes(sample.url) ? "added" : "add"}
                </em>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function UrlTab({ edit, onClose, onAdded, onFlyTo }: Props) {
  const [url, setUrl] = useState(
    "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_populated_places_simple.geojson",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RegisteredLayer | null>(null);

  const client = useQueryClient();
  const { fromUrl } = useImportLayer();

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const layer = await fromUrl.mutateAsync({ url });
      setDone(layer);
      place(layer, edit, onAdded, onFlyTo, client);
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
  /*
   * The url that has been submitted, which is not the url in the box. Typing is
   * not asking: a GetCapabilities document is large and the server is somebody
   * else's, so it is fetched when Connect is pressed and then cached, which
   * makes going back to a server you already looked at instant.
   */
  const [asked, setAsked] = useState<string | null>(null);
  const [chosen, setChosen] = useState<WmsLayerChoice | null>(null);
  const [picked, setPicked] = useState(false);

  const capabilities = useCapabilities(asked);
  const server = capabilities.data ?? null;
  const busy = capabilities.isFetching;
  const error = capabilities.error
    ? capabilities.error instanceof Error
      ? capabilities.error.message
      : String(capabilities.error)
    : null;

  /* The first layer the server offers, until the user says otherwise. */
  if (server && !picked && chosen?.name !== server.layers[0]?.name) {
    setChosen(server.layers[0] ?? null);
    setPicked(true);
  }

  const connect = () => {
    setPicked(false);
    setChosen(null);
    setAsked(url);
    if (asked === url) void capabilities.refetch();
  };

  const add = () => {
    if (!server || !chosen) return;
    const wanted = `wms_${chosen.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    let id = wanted;
    edit((draft) => {
      id = uniqueId(draft, wanted);
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
