import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Bookmark, Extent, Projection } from "@alidade/core";
import {
  GLOBE_IS_ROUND_BELOW,
  denominatorAt,
  formatCoordinate,
  gridKey,
  padded,
  needsFraming,
  utmCell,
  viewForExtent,
  withMinimumSize,
} from "@alidade/core";
import { MapManager, watchStyleSwaps, type Renderer } from "@alidade/maplibre";

import { AddData } from "./components/AddData";
import { AttributeTable } from "./components/AttributeTable";
import { LayerMenu, moveWithinSlot } from "./components/LayerMenu";
import { BasemapGallery } from "./components/BasemapGallery";
import { DrawPanel } from "./components/DrawPanel";
import { Identify, type Identified } from "./components/Identify";
import { Inspector } from "./components/Inspector";
import { Legend } from "./components/Legend";
import { LayerTree } from "./components/LayerTree";
import { MapChrome, type Camera } from "./components/MapChrome";
import { MapControls } from "./components/MapControls";
import { Minimap } from "./components/Minimap";
import { ProjectPanel } from "./components/ProjectPanel";
import { Rail, type PaneId } from "./components/Rail";
import { ScenePanel } from "./components/ScenePanel";
import { TitleBar } from "./components/TitleBar";
import { emptyProject, emptyStyle } from "./project";
import { allLayers, bundleIdsOf, duplicateNode, findLayer, removeNode, withNode } from "./tree";
import { registerMarkers } from "./markers";
import { useDrawing } from "./useDrawing";
import { useProject } from "./useProject";
import { stampedPng } from "./export";

const TITLES: Record<PaneId, string> = {
  layers: "Layers",
  basemaps: "Basemaps",
  scene: "Scene",
  draw: "Draw and measure",
  project: "Project",
};

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const { project, log, edit, sync, attach, warning, setWarning } = useProject(emptyProject);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [pane, setPane] = useState<PaneId>("layers");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [locks, setLocks] = useState({ zoom: false, pan: false });
  const [camera, setCamera] = useState<Camera>({
    zoom: emptyProject.view.zoom,
    latitude: emptyProject.view.center[1],
    bearing: 0,
    pitch: 0,
  });
  const [centre, setCentre] = useState<[number, number]>(emptyProject.view.center);
  const [pointer, setPointer] = useState<[number, number]>(emptyProject.view.center);
  const [found, setFound] = useState<Identified | null>(null);
  const [focus, setFocus] = useState<{ field: string; value: string } | null>(null);
  const [hover, setHover] = useState<{ layer: string; properties: Record<string, unknown> } | null>(
    null,
  );

  const drawing = useDrawing(project, edit);

  /*
   * The map is built once and lives in a ref, but the handlers it registers need
   * to reach state that changes. Anything a handler reads goes through a ref that
   * is written on every render, rather than through the closure it was born with.
   */
  const onClick = useRef(drawing.click);
  onClick.current = drawing.click;
  const drawingNow = useRef(false);
  drawingNow.current = drawing.session.mode !== null;
  const latest = useRef(project);
  latest.current = project;

  const readCamera = useCallback((map: MapLibreMap) => {
    const middle = map.getCenter();
    setCamera({
      zoom: map.getZoom(),
      latitude: middle.lat,
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    });
    setCentre([middle.lng, middle.lat]);
  }, []);

  useEffect(() => {
    if (!holder.current) return;
    /*
     * Strict mode mounts, unmounts and mounts again. Without this flag the first
     * map's load handler could still fire after `remove()` and hand the
     * application a manager bound to a map that is no longer on the screen.
     */
    let cancelled = false;

    const map = new MapLibreMap({
      container: holder.current,
      style: emptyStyle,
      center: emptyProject.view.center,
      zoom: emptyProject.view.zoom,
      attributionControl: false,
      maxPitch: 85,
      // Required if the canvas is ever to be read back, which Export map does.
      // MapLibre 5 moved these under canvasContextAttributes.
      canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
    });

    map.on("load", () => {
      if (cancelled) return;
      const manager = new MapManager(map as unknown as Renderer, emptyProject, {
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
    /*
     * Hover and identify. The layers to test are worked out from the project each
     * time rather than captured once, because the set changes as layers come and
     * go and a stale list means hovering silently stops working.
     */
    const dataLayers = () => {
      const ids: string[] = [];
      for (const node of allLayers(latest.current)) {
        if (node.geometry === "raster") continue;
        for (const id of bundleIdsOf(node)) {
          if (id.endsWith(":label")) continue;
          if (map.getLayer(id)) ids.push(id);
        }
      }
      return ids;
    };

    const hit = (event: MapMouseEvent) => {
      const layers = dataLayers();
      if (layers.length === 0) return null;
      const features = map.queryRenderedFeatures(event.point, { layers });
      const feature = features[0];
      if (!feature) return null;
      const owner = allLayers(latest.current).find((node) =>
        bundleIdsOf(node).includes(feature.layer.id),
      );
      return owner ? { owner, feature } : null;
    };

    map.on("mousemove", (e: MapMouseEvent) => {
      setPointer([e.lngLat.lng, e.lngLat.lat]);
      if (drawingNow.current) return;
      const under = hit(e);
      map.getCanvas().style.cursor = under ? "pointer" : "";
      setHover(under ? { layer: under.owner.id, properties: under.feature.properties ?? {} } : null);
    });

    map.on("click", (e: MapMouseEvent) => {
      if (drawingNow.current) return onClick.current([e.lngLat.lng, e.lngLat.lat]);
      const under = hit(e);
      if (!under) return setFound(null);
      setFound({
        layer: under.owner,
        properties: (under.feature.properties ?? {}) as Record<string, unknown>,
        // e.point is relative to the map container, which is what the popup is
        // positioned inside. clientX/clientY are relative to the window, so the
        // popup landed the width of the rail and sidebar away from the click.
        at: { x: e.point.x, y: e.point.y },
        viewport: { width: map.getCanvas().clientWidth, height: map.getCanvas().clientHeight },
        position: [e.lngLat.lng, e.lngLat.lat],
      });
    });
    // Without this, a failing tile request is invisible and looks like an empty map.
    map.on("error", (e: { error?: Error }) => {
      const message = e.error?.message ?? "The renderer reported a problem.";
      setProblem(message);
      console.error("[alidade]", e.error ?? e);
    });

    mapRef.current = map;
    return () => {
      cancelled = true;
      mapRef.current = null;
      map.remove();
    };
  }, [attach, readCamera, sync]);

  /*
   * The hover becomes a selection on the project, which is what the compiler
   * turns into a highlight layer. It is keyed on the layer's first field, the
   * same column the attribute table matches on, so hovering the map and hovering
   * a row light up the same feature.
   */
  useEffect(() => {
    if (found) return;
    // The layer's key column, not whatever field happened to be first: for
    // Natural Earth that is `scalerank`, so hovering one country used to light up
    // every country that shared its rank.
    const node = hover ? findLayer(project, hover.layer) : undefined;
    const key = node?.metadata?.key ?? node?.metadata?.fields?.[0];
    const value = key ? hover?.properties[key] : undefined;
    edit((d) => {
      const wanted =
        hover && key && (typeof value === "string" || typeof value === "number")
          ? { layer: hover.layer, field: key, values: [value], hover: true }
          : undefined;
      // Only touch the document when the highlight is actually different, or a
      // mouse moving across a polygon would emit an edit per frame.
      const now = d.selection;
      if (!wanted && now?.hover) delete d.selection;
      else if (wanted && (now?.hover !== true || now.values[0] !== wanted.values[0] || now.layer !== wanted.layer)) {
        d.selection = wanted;
      }
      return d;
    });
    // `project` is deliberately not a dependency: this reacts to the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover, found, edit]);

  /*
   * Marker images have to exist before the layer that names them is drawn, so
   * they are registered ahead of every edit rather than in response to one.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    registerMarkers(map, project);
  }, [project]);

  /* the pointer becomes a crosshair while a drawing is open */
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = drawing.session.mode ? "crosshair" : "";
  }, [drawing.session.mode]);

  /*
   * Escape steps back out of whatever is open, in the order a person expects:
   * the popup first, then presentation mode. Drawing has its own escape.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (found) setFound(null);
      else if (presenting) setPresenting(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [found, presenting]);

  /* navigation locks */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const control of [map.scrollZoom, map.doubleClickZoom, map.boxZoom, map.keyboard]) {
      if (locks.zoom) control.disable();
      else control.enable();
    }
    if (locks.pan) map.dragPan.disable();
    else map.dragPan.enable();
  }, [locks]);

  /*
   * The metric grid is built for a patch of world, not for the whole one, so it
   * has to be rebuilt when the view leaves the patch. `gridKey` decides when that
   * is, which keeps an ordinary pan from emitting a source operation per frame.
   */
  useEffect(() => {
    const grids = project.chrome.grids;
    const map = mapRef.current;
    if (!map || !grids?.square.enabled) return;
    const bounds = map.getBounds();
    const now = {
      west: bounds.getWest(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      north: bounds.getNorth(),
    };
    const built = grids.squareBounds;
    if (built && gridKey(built, grids.square.spacing) === gridKey(padded(now), grids.square.spacing)) {
      return;
    }
    edit((d) => {
      d.chrome.grids = { ...d.chrome.grids, squareBounds: padded(now) };
      return d;
    });
  }, [centre, camera.zoom, project.chrome.grids, edit]);

  /**
   * Put the camera where an extent fills the screen.
   *
   * This was `fitBounds`, which frames on the mercator y axis and has no answer
   * at all past ±85°. Given a worldwide point layer that puts the centre well
   * north of the middle of the data, and a globe then draws half of itself off
   * the screen. The arithmetic now lives in the core, where the projection is
   * part of the question and the whole thing can be tested.
   */
  const flyTo = useCallback(
    (extent: Extent, onlyIfItHelps = false) => {
      const map = mapRef.current;
      if (!map) return;
      const canvas = map.getCanvas();
      const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
      const now = {
        center: [map.getCenter().lng, map.getCenter().lat] as [number, number],
        zoom: map.getZoom(),
      };
      /*
       * Adding a worldwide layer while looking at a globe used to pull the camera
       * out until the whole extent fitted, shrinking the planet to show data that
       * was already on the screen. An explicit "zoom to layer" always moves; the
       * automatic one after an import only moves when it would help.
       */
      if (onlyIfItHelps && !needsFraming(extent, now, viewport)) return;
      const view = viewForExtent(
        withMinimumSize(extent),
        viewport,
        {
          center: [map.getCenter().lng, map.getCenter().lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        },
        { projection: project.environment.projection, maxZoom: 16, padding: 0.1 },
      );
      map.easeTo({ ...view, duration: 800 });
    },
    [project.environment.projection],
  );

  /** Selecting from the table: a hover is quiet and a click is not. */
  const select = useCallback(
    (layer: string, field: string, values: (string | number)[], hover: boolean) => {
      edit((d) => {
        if (values.length === 0) delete d.selection;
        else d.selection = { layer, field, values, hover };
        return d;
      });
    },
    [edit],
  );

  const denominator = Math.round(denominatorAt(camera.zoom, camera.latitude));

  const exportImage = () => {
    const map = mapRef.current;
    if (!map) return;
    map.once("idle", () => stampedPng(map, project, camera, setProblem));
    map.triggerRepaint();
  };

  const goTo = (lon: number, lat: number) =>
    mapRef.current?.flyTo({ center: [lon, lat], zoom: Math.max(camera.zoom, 12), duration: 800 });

  /**
   * Switching projection is a camera decision as much as a rendering one.
   *
   * MapLibre's `globe` is a sphere below about zoom 9 and mercator above it, so
   * asking for a globe from street level used to change precisely nothing and
   * look like a bug. Take the camera somewhere the choice is visible.
   */
  const setProjection = (projection: Projection) => {
    edit((d) => {
      d.environment.projection = projection;
      // A sphere against a black void reads as a bug, not a planet.
      if (projection === "mercator") delete d.environment.sky;
      else d.environment.sky = true;
      return d;
    });
    const map = mapRef.current;
    if (!map) return;
    /*
     * Far enough out that the sphere reads as one, and no further. Going to 2.2
     * threw the camera into orbit; the sphere is still perfectly round at 4 and
     * you can still see where you were.
     */
    if (projection !== "mercator" && map.getZoom() > GLOBE_IS_ROUND_BELOW) {
      map.easeTo({ zoom: 4, pitch: 0, bearing: 0, duration: 1200 });
    }
  };

  const recall = (bookmark: Bookmark) =>
    mapRef.current?.flyTo({ ...bookmark.view, duration: 1200 });

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
    present: () => setPresenting((on) => !on),
    lockZoom: () => setLocks((l) => ({ ...l, zoom: !l.zoom })),
    lockPan: () => setLocks((l) => ({ ...l, pan: !l.pan })),
  };

  return (
    <div className={`app${presenting ? " presenting" : ""}`}>
      <TitleBar project={project} ops={log.length} edit={edit} />

      <div className="middle">
        <Rail active={pane} onSelect={setPane} />

        <aside className="panel">
          <div className="phead">{TITLES[pane]}</div>
          {pane === "layers" && (
            <LayerTree
              project={project}
              selected={selected}
              onSelect={setSelected}
              edit={edit}
              onMenu={(id, at) => setMenu({ id, at })}
              onAdd={() => setAdding(true)}
              onFlyTo={(extent) => flyTo(extent, true)}
            />
          )}
          {pane === "basemaps" && <BasemapGallery project={project} edit={edit} />}
          {pane === "scene" && (
            <ScenePanel
              project={project}
              edit={edit}
              denominator={denominator}
              onGoTo={goTo}
              onProjection={setProjection}
              onRecall={recall}
            />
          )}
          {pane === "draw" && (
            <DrawPanel
              project={project}
              edit={edit}
              session={drawing.session}
              active={drawing.active}
              onStart={drawing.start}
              onStop={drawing.stop}
              onFinish={drawing.finish}
              onCancel={drawing.cancel}
              onGoTo={goTo}
              onProblem={setProblem}
            />
          )}
          {pane === "project" && (
            <ProjectPanel project={project} log={log} onExportImage={exportImage} />
          )}
        </aside>

        <div className="mapwrap">
          <div className="map" ref={holder} />
          <MapChrome chrome={project.chrome} camera={camera} />
          <MapControls actions={actions} locks={locks} presenting={presenting} />
          {project.chrome.overview && (
            <Minimap
              basemap={project.basemap}
              centre={centre}
              zoom={camera.zoom}
              bearing={camera.bearing}
              onGoTo={goTo}
            />
          )}
          {drawing.session.mode && (
            <div className="drawhint">
              <b>
                {drawing.session.measure
                  ? `Measuring ${drawing.session.measure}`
                  : `Drawing a ${drawing.session.mode}`}
              </b>
              <span>
                {drawing.session.mode === "point"
                  ? "Click to place. Escape to stop."
                  : "Click to add points · Enter to finish · Escape to cancel"}
              </span>
            </div>
          )}
          {project.chrome.legend && <Legend project={project} />}
          {found && (
            <Identify
              found={found}
              onClose={() => setFound(null)}
              onZoom={() =>
                mapRef.current?.easeTo({
                  center: found.position,
                  zoom: Math.max(mapRef.current.getZoom(), 9),
                  duration: 700,
                })
              }
              onOpenTable={() => {
                const key = found.layer.metadata?.key ?? (found.layer.metadata?.fields ?? [])[0];
                const value = key ? found.properties[key] : undefined;
                setTable(found.layer.id);
                if (key && (typeof value === "string" || typeof value === "number")) {
                  setFocus({ field: key, value: String(value) });
                }
                setFound(null);
              }}
            />
          )}
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
          onAttributes={setTable}
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
            project={project}
            edit={edit}
            onClose={() => setAdding(false)}
            onAdded={(id) => {
              setSelected(id);
              setTable(id);
            }}
            onFlyTo={(extent) => flyTo(extent, true)}
          />
        )}
      </div>

      {table && (
        <AttributeTable
          layerId={table}
          title={findLayer(project, table)?.name ?? table}
          focus={focus}
          onSelect={(field, values, hover) => select(table, field, values, hover)}
          onZoom={flyTo}
          onClose={() => {
            setTable(null);
            edit((d) => {
              delete d.selection;
              return d;
            });
          }}
        />
      )}

      <footer className="status">
        <span>EPSG:4326</span>
        <span>{formatCoordinate(pointer[0], pointer[1], project.chrome.coordinates)}</span>
        <span>{utmCell(pointer[0], pointer[1])}</span>
        <span>1:{denominator.toLocaleString("en-US").replace(/,/g, " ")}</span>
        <span>z {camera.zoom.toFixed(1)}</span>
        <span>
          pitch {Math.round(camera.pitch)}° · bearing {Math.round(camera.bearing)}°
        </span>
        <span className="grow" />
        {locks.zoom && <span className="lock">zoom locked</span>}
        {locks.pan && <span className="lock">pan locked</span>}
        <span>{project.basemap.name}</span>
      </footer>
    </div>
  );
}
