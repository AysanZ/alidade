import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { denominatorAt, formatCoordinate } from "@alidade/core";
import { MapManager, watchStyleSwaps, type Renderer } from "@alidade/maplibre";

import { AddData } from "./components/AddData";
import { AttributeTable } from "./components/AttributeTable";
import { LayerMenu, moveWithinSlot } from "./components/LayerMenu";
import { BasemapGallery } from "./components/BasemapGallery";
import { Inspector } from "./components/Inspector";
import { LayerTree } from "./components/LayerTree";
import { MapChrome, type Camera } from "./components/MapChrome";
import { MapControls } from "./components/MapControls";
import { ProjectPanel } from "./components/ProjectPanel";
import { Rail, type PaneId } from "./components/Rail";
import { ScenePanel } from "./components/ScenePanel";
import { TitleBar } from "./components/TitleBar";
import { demoProject, emptyStyle } from "./project";
import { duplicateNode, findLayer, removeNode, withNode } from "./tree";
import { useProject } from "./useProject";

const TITLES: Record<PaneId, string> = {
  layers: "Layers",
  basemaps: "Basemaps",
  scene: "Scene",
  project: "Project",
};

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const { project, log, edit, sync, attach, warning, setWarning } = useProject(demoProject);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [pane, setPane] = useState<PaneId>("layers");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>("density");
  const [camera, setCamera] = useState<Camera>({
    zoom: demoProject.view.zoom,
    latitude: demoProject.view.center[1],
    bearing: 0,
    pitch: 0,
  });
  const [pointer, setPointer] = useState<[number, number]>(demoProject.view.center);

  const readCamera = useCallback((map: MapLibreMap) => {
    setCamera({
      zoom: map.getZoom(),
      latitude: map.getCenter().lat,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
  }, []);

  useEffect(() => {
    if (!holder.current) return;

    const map = new MapLibreMap({
      container: holder.current,
      style: emptyStyle,
      center: demoProject.view.center,
      zoom: demoProject.view.zoom,
      attributionControl: false,
      maxPitch: 85,
      // Required if the canvas is ever to be read back, which Export map does.
      // MapLibre 5 moved these under canvasContextAttributes.
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });

    map.on("load", () => {
      const manager = new MapManager(map as unknown as Renderer, demoProject, {
        onWarning: (message) => setProblem(message),
      });
      watchStyleSwaps(map as never, manager);
      attach(manager);
      readCamera(map);
    });
    map.on("move", () => readCamera(map));
    // The document learns about a drag once it has finished, not sixty times a second.
    map.on("moveend", () => {
      const c = map.getCenter();
      sync({
        center: [Number(c.lng.toFixed(6)), Number(c.lat.toFixed(6))],
        zoom: Number(map.getZoom().toFixed(3)),
        pitch: Math.round(map.getPitch()),
        bearing: Math.round(map.getBearing()),
      });
    });
    map.on("mousemove", (e: MapMouseEvent) => setPointer([e.lngLat.lng, e.lngLat.lat]));
    // Without this, a failing tile request is invisible and looks like an empty map.
    map.on("error", (e: { error?: Error }) => {
      const message = e.error?.message ?? "The renderer reported a problem.";
      setProblem(message);
      console.error("[alidade]", e.error ?? e);
    });

    mapRef.current = map;
    return () => map.remove();
  }, [attach, readCamera, sync]);

  const flyTo = useCallback(
    (extent: { west: number; south: number; east: number; north: number }) => {
      mapRef.current?.fitBounds(
        [
          [extent.west, extent.south],
          [extent.east, extent.north],
        ],
        { padding: 60, duration: 600 },
      );
    },
    [],
  );

  const denominator = Math.round(denominatorAt(camera.zoom, camera.latitude));

  const exportImage = () => {
    const canvas = mapRef.current?.getCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `${project.id}.png`;
    link.click();
  };

  const goTo = (lon: number, lat: number) =>
    mapRef.current?.flyTo({ center: [lon, lat], zoom: Math.max(camera.zoom, 12), duration: 800 });

  const runAction = (id: string, action: string) => {
    const layer = findLayer(project, id);
    switch (action) {
      case "zoom":
        if (layer?.metadata?.extent) flyTo(layer.metadata.extent);
        else setProblem("That layer has no recorded extent to zoom to.");
        break;
      case "attributes":
        setTable(id);
        break;
      case "up":
        edit((d) => moveWithinSlot(d, id, -1));
        break;
      case "down":
        edit((d) => moveWithinSlot(d, id, 1));
        break;
      case "duplicate":
        edit((d) => duplicateNode(d, id));
        break;
      case "rename": {
        const name = window.prompt("Layer name", layer?.name ?? "");
        if (name) edit((d) => withNode(d, id, (n) => void (n.name = name)));
        break;
      }
      case "remove":
        edit((d) => removeNode(d, id));
        if (selected === id) setSelected(null);
        if (table === id) setTable(null);
        break;
    }
  };

  const actions = {
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
    resetNorth: () => mapRef.current?.easeTo({ bearing: 0, pitch: 0 }),
    locate: () =>
      navigator.geolocation?.getCurrentPosition((position) =>
        mapRef.current?.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 13,
        }),
      ),
    fullscreen: () =>
      document.fullscreenElement
        ? void document.exitFullscreen()
        : void document.documentElement.requestFullscreen(),
  };

  return (
    <div className="app">
      <TitleBar project={project} ops={log.length} />

      <div className="middle">
        <Rail active={pane} onSelect={setPane} />

        <aside className="panel">
          <div className="phead">
            {TITLES[pane]}
            {pane === "layers" && (
              <button className="add" onClick={() => setAdding(true)} title="Add data">
                +
              </button>
            )}
          </div>
          {pane === "layers" && (
            <LayerTree
              project={project}
              selected={selected}
              onSelect={setSelected}
              edit={edit}
              onMenu={(id, at) => setMenu({ id, at })}
            />
          )}
          {pane === "basemaps" && <BasemapGallery project={project} edit={edit} />}
          {pane === "scene" && (
            <ScenePanel
              project={project}
              edit={edit}
              denominator={denominator}
              onGoTo={goTo}
            />
          )}
          {pane === "project" && (
            <ProjectPanel project={project} log={log} onExportImage={exportImage} />
          )}
        </aside>

        <div className="mapwrap">
          <div className="map" ref={holder} />
          <MapChrome chrome={project.chrome} camera={camera} />
          <MapControls actions={actions} />
          {(problem ?? warning) && (
            <div className="problem">
              <span>{problem ?? warning}</span>
              <button
                onClick={() => {
                  setProblem(null);
                  setWarning(null);
                }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          <p className="attribution">{project.basemap.raster?.attribution}</p>
        </div>

        <Inspector
          project={project}
          selected={selected}
          edit={edit}
          denominator={denominator}
          onFlyTo={flyTo}
          onRemoved={() => setSelected(null)}
        />

        {menu && (
          <LayerMenu
            at={menu.at}
            onPick={(action) => runAction(menu.id, action)}
            onClose={() => setMenu(null)}
          />
        )}

        {adding && (
          <AddData
            edit={edit}
            onClose={() => setAdding(false)}
            onAdded={(id) => {
              setSelected(id);
              setTable(id);
            }}
            onFlyTo={flyTo}
          />
        )}
      </div>

      {table && (
        <AttributeTable
          layerId={table}
          title={findLayer(project, table)?.name ?? table}
          onClose={() => setTable(null)}
        />
      )}

      <footer className="status">
        <span>EPSG:4326</span>
        <span>{formatCoordinate(pointer[0], pointer[1], project.chrome.coordinates)}</span>
        <span>1:{denominator.toLocaleString("en-US").replace(/,/g, " ")}</span>
        <span>z {camera.zoom.toFixed(1)}</span>
        <span>
          pitch {Math.round(camera.pitch)}° · bearing {Math.round(camera.bearing)}°
        </span>
        <span className="grow" />
        <span>{project.basemap.name}</span>
      </footer>
    </div>
  );
}
