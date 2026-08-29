import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { denominatorAt, type GraduatedSymbol, type GroupNode, type LayerNode } from "@alidade/core";
import { MapManager, watchStyleSwaps, type Renderer } from "@alidade/maplibre";

import { demoProject, emptyStyle } from "./project";
import { useProject } from "./useProject";

const BASEMAPS = [
  { id: "graphite", name: "Graphite", background: "#0b0b0c" },
  { id: "carbon", name: "Carbon", background: "#050505" },
  { id: "blueprint", name: "Blueprint", background: "#0a1420" },
];

const densityLayer = (p: typeof demoProject) =>
  (p.tree[0] as GroupNode).children[0] as LayerNode;

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const { project, log, edit, attach } = useProject(demoProject);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    if (!holder.current) return;

    const map = new maplibregl.Map({
      container: holder.current,
      style: emptyStyle,
      center: demoProject.view.center,
      zoom: demoProject.view.zoom,
      attributionControl: false,
    });

    map.on("load", () => {
      const manager = new MapManager(map as unknown as Renderer, demoProject);
      watchStyleSwaps(map as never, manager);
      attach(manager);
    });

    const readScale = () => setScale(denominatorAt(map.getZoom(), map.getCenter().lat));
    map.on("move", readScale);
    map.on("load", readScale);

    return () => map.remove();
  }, [attach]);

  const layer = densityLayer(project);
  const symbology = layer.symbology as GraduatedSymbol;

  return (
    <>
      <div className="map" ref={holder} />

      <aside className="panel">
        <header>{project.name}</header>

        <label className="row">
          <input
            type="checkbox"
            checked={layer.visible}
            onChange={(e) =>
              edit((draft) => {
                densityLayer(draft).visible = e.target.checked;
                return draft;
              })
            }
          />
          {layer.name}
        </label>

        <div className="row">
          <span>Third break</span>
          <input
            type="range"
            min={2200}
            max={9000}
            step={50}
            value={symbology.breaks[2]}
            onChange={(e) =>
              edit((draft) => {
                const s = densityLayer(draft).symbology as GraduatedSymbol;
                s.breaks[2] = Number(e.target.value);
                return draft;
              })
            }
          />
          <b>{symbology.breaks[2]}</b>
        </div>

        <div className="row">
          <span>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            onChange={(e) =>
              edit((draft) => {
                densityLayer(draft).opacity = Number(e.target.value) / 100;
                return draft;
              })
            }
          />
          <b>{Math.round(layer.opacity * 100)}%</b>
        </div>

        <div className="row basemaps">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              className={b.id === project.basemap.id ? "on" : ""}
              onClick={() =>
                edit((draft) => {
                  draft.basemap = { ...draft.basemap, ...b };
                  return draft;
                })
              }
            >
              {b.name}
            </button>
          ))}
        </div>

        <footer>
          <span>Last operations</span>
          <ol>
            {log.slice(0, 6).map((op, i) => (
              <li key={i}>
                {op.t}
                {"id" in op ? ` · ${op.id}` : ""}
                {"key" in op ? ` · ${op.key}` : ""}
              </li>
            ))}
          </ol>
        </footer>
      </aside>

      <div className="status">
        <span>EPSG:4326</span>
        <span>1:{Math.round(scale).toLocaleString("en-US").replace(/,/g, " ")}</span>
        <span style={{ marginInlineStart: "auto" }}>
          schema {project.schema} · {log.length} ops this session
        </span>
      </div>
    </>
  );
}
