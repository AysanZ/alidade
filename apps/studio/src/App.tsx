import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { denominatorAt, formatCoordinate } from "@alidade/core";
import { MapManager, watchStyleSwaps, type Renderer } from "@alidade/maplibre";

import { AddData } from "./components/AddData";
import { BasemapGallery } from "./components/BasemapGallery";
import { Inspector } from "./components/Inspector";
import { LayerTree } from "./components/LayerTree";
import { MapChrome, type Camera } from "./components/MapChrome";
import { ProjectPanel } from "./components/ProjectPanel";
import { Rail, type PaneId } from "./components/Rail";
import { ScenePanel } from "./components/ScenePanel";
import { TitleBar } from "./components/TitleBar";
import { demoProject, emptyStyle } from "./project";
import { useProject } from "./useProject";

const TITLES: Record<PaneId, string> = {
  layers: "Layers",
  basemaps: "Basemaps",
  scene: "Scene",
  project: "Project",
};

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const { project, log, edit, attach } = useProject(demoProject);
  const [pane, setPane] = useState<PaneId>("layers");
  const [adding, setAdding] = useState(false);
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
      maxPitch: 75,
    });

    map.on("load", () => {
      const manager = new MapManager(map as unknown as Renderer, demoProject);
      watchStyleSwaps(map as never, manager);
      attach(manager);
      readCamera(map);
    });
    map.on("move", () => readCamera(map));
    map.on("mousemove", (e: MapMouseEvent) => setPointer([e.lngLat.lng, e.lngLat.lat]));

    return () => map.remove();
  }, [attach, readCamera]);

  const denominator = Math.round(denominatorAt(camera.zoom, camera.latitude));

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
            <LayerTree project={project} selected={selected} onSelect={setSelected} edit={edit} />
          )}
          {pane === "basemaps" && <BasemapGallery project={project} edit={edit} />}
          {pane === "scene" && <ScenePanel project={project} edit={edit} />}
          {pane === "project" && <ProjectPanel project={project} log={log} />}
        </aside>

        <div className="mapwrap">
          <div className="map" ref={holder} />
          <MapChrome chrome={project.chrome} camera={camera} />
          <p className="attribution">{project.basemap.raster?.attribution}</p>
        </div>

        <Inspector project={project} selected={selected} edit={edit} />

        {adding && (
          <AddData edit={edit} onClose={() => setAdding(false)} onAdded={setSelected} />
        )}
      </div>

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
