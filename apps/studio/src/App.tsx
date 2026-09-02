import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Bookmark, Extent, LayerNode, Projection, Selection } from "@alidade/core";
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
import { FeatureTip, type Tip } from "./components/FeatureTip";
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
import { featureLabel } from "./label";
import { markerImageFor, registerMarkers } from "./markers";
import { useDrawing } from "./useDrawing";
import { useProject } from "./useProject";
import { stampedPng } from "./export";

/**
 * How far off a feature the pointer may be and still count as over it.
 *
 * Only used when an exact query found nothing, so it never steals a click from
 * something the user really is pointing at. Four pixels is about the slack a
 * hand has on a mouse, and it is the difference between a hairline coastline
 * being identifiable and being decoration.
 */
const HIT_TOLERANCE = 4;

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
  /*
   * Where the tooltip goes, kept apart from what it says.
   *
   * The pointer moves sixty times a second and the feature under it changes
   * perhaps twice; putting both in one piece of state made every frame look like
   * a new hover, and a new hover writes a highlight to the document. This one
   * re-renders, `hover` reconciles.
   */
  const [tipAt, setTipAt] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

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

    /** The same query with a few pixels of slack, for geometry too thin to hit. */
    const nearby = (event: MapMouseEvent, layers: string[]) => {
      const { x, y } = event.point;
      const box: [[number, number], [number, number]] = [
        [x - HIT_TOLERANCE, y - HIT_TOLERANCE],
        [x + HIT_TOLERANCE, y + HIT_TOLERANCE],
      ];
      return map.queryRenderedFeatures(box, { layers });
    };

    /*
     * What the pointer is over.
     *
     * A query at a single point asks whether that exact pixel was painted, which
     * is a fair question for a country and an impossible one for a 0.8px
     * coastline: a line layer could not be hovered or identified at all, because
     * hitting it needed pixel-perfect aim. Ask the precise question first, so a
     * click between two touching polygons still lands on the one under the
     * cursor, and only widen the net when nothing was there.
     */
    const hit = (event: MapMouseEvent) => {
      const layers = dataLayers();
      if (layers.length === 0) return null;
      const exact = map.queryRenderedFeatures(event.point, { layers });
      const feature = exact[0] ?? nearby(event, layers)[0];
      if (!feature) return null;
      const owner = allLayers(latest.current).find((node) =>
        bundleIdsOf(node).includes(feature.layer.id),
      );
      return owner ? { owner, feature } : null;
    };

    /** What `hover` is currently describing, so an unchanged feature is left alone. */
    const hovering = { key: null as string | null };

    const clearHover = () => {
      if (hovering.key !== null) {
        hovering.key = null;
        setHover(null);
      }
      setTipAt(null);
    };

    map.on("mousemove", (e: MapMouseEvent) => {
      setPointer([e.lngLat.lng, e.lngLat.lat]);
      if (drawingNow.current) return clearHover();
      const under = hit(e);
      map.getCanvas().style.cursor = under ? "pointer" : "";
      if (!under) return clearHover();

      const properties = (under.feature.properties ?? {}) as Record<string, unknown>;
      const key = `${under.owner.id}\u0000${JSON.stringify(properties)}`;
      if (hovering.key !== key) {
        hovering.key = key;
        setHover({ layer: under.owner.id, properties });
      }
      const canvas = map.getCanvas();
      setTipAt({
        x: e.point.x,
        y: e.point.y,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    });

    // Leaving the canvas is not a mousemove, so without this the tooltip and the
    // highlight stayed behind on whatever was under the pointer as it left.
    map.on("mouseout", clearHover);

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
    /*
     * The renderer asking for a picture it does not have is not an error, it is
     * a question, and the id it asks with says exactly what to draw. Answering
     * here rather than only in an effect means a marker cannot disappear for the
     * frame between changing its colour and the effect that registers the new
     * image running.
     */
    map.on("styleimagemissing", (e: { id: string }) => {
      if (map.hasImage(e.id)) return;
      const image = markerImageFor(e.id);
      if (image) map.addImage(e.id, image, { pixelRatio: 2 });
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
   * turns into a highlight layer.
   *
   * It used to be keyed on one column — the layer's `key` if the server had
   * found one, and otherwise whatever field came first. For Natural Earth the
   * first field is `scalerank`, which every feature shares with dozens of
   * others, so pointing at one airport ringed every airport of the same rank.
   * The identity of the feature under the pointer is now taken from the feature
   * itself, so the highlight is the thing being pointed at and nothing else.
   */
  useEffect(() => {
    if (found) return;
    const node = hover ? findLayer(project, hover.layer) : undefined;
    const wanted =
      hover && node ? selectionFor(hover.layer, node, hover.properties) : undefined;

    edit((d) => {
      // Only touch the document when the highlight is actually different, or a
      // mouse moving across a polygon would emit an edit per frame.
      const now = d.selection;
      if (!wanted) {
        if (now?.hover) delete d.selection;
      } else if (now?.hover !== true || fingerprint(now) !== fingerprint(wanted)) {
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
    // `isStyleLoaded` was the guard here, and it is false for a moment after
    // every basemap swap, so the registration that mattered was the one that got
    // skipped. `styleimagemissing` is the backstop either way.
    if (!map?.style) return;
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

  /*
   * The hover tooltip.
   *
   * Suppressed while the identify popup is open, because that panel is already
   * showing this feature's attributes and a tooltip over it is noise, and while
   * a drawing is in progress, when the pointer means "put a vertex here" rather
   * than "what is this".
   */
  const hoverNode = hover ? findLayer(project, hover.layer) : undefined;
  const hoverName = hover ? featureLabel(hoverNode, hover.properties) : null;
  const tip: Tip | null =
    hover && tipAt && hoverName && !found && !drawing.session.mode
      ? {
          name: hoverName,
          layer: hoverNode?.name ?? hover.layer,
          at: { x: tipAt.x, y: tipAt.y },
          viewport: { width: tipAt.width, height: tipAt.height },
        }
      : null;

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
          {/*
            The heading is fixed and the body scrolls, rather than the whole
            panel scrolling under a sticky heading. With a long Appearance panel
            open the two are indistinguishable until the panel is short, when a
            sticky heading floats above nothing.
          */}
          <div className="phead">
            <span className="cap">{TITLES[pane]}</span>
            {pane === "layers" && (
              <button className="add" onClick={() => setAdding(true)} title="Add data" aria-label="Add data">
                +
              </button>
            )}
          </div>
          <div className="pbody">
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
          </div>
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
          {tip && (
            <FeatureTip name={tip.name} layer={tip.layer} at={tip.at} viewport={tip.viewport} />
          )}
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

/**
 * How many of a feature's own columns are used to tell it apart from its
 * neighbours when the table has no key.
 *
 * Every column would be exact and would also put a filter the size of the
 * attribute row into the style on every mouse move. A dozen is far more than
 * enough to separate two features that a person could confuse.
 */
const IDENTIFYING_FIELDS = 12;

/**
 * A selection that names one feature.
 *
 * With a real key column this is one equality and nothing more. Without one —
 * and most imported tables have none — the feature's own attributes are the
 * identity: two rows that agree on a dozen columns are the same row for any
 * purpose a highlight serves.
 */
function selectionFor(
  layerId: string,
  node: LayerNode,
  properties: Record<string, unknown>,
): Selection | undefined {
  const scalar = (value: unknown): value is string | number | boolean =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean";

  const key = node.metadata?.key;
  if (key && scalar(properties[key])) {
    const value = properties[key];
    return { layer: layerId, field: key, values: [value as string | number], hover: true };
  }

  /*
   * The declared field order, so the same feature produces the same filter
   * whichever tile it arrived in. `Object.keys` on a decoded tile feature is not
   * guaranteed to be stable, and an unstable filter is an edit per frame.
   */
  const fields = (node.metadata?.fields ?? Object.keys(properties))
    .filter((field) => scalar(properties[field]))
    .slice(0, IDENTIFYING_FIELDS);
  if (fields.length === 0) return undefined;

  const [first, ...rest] = fields as [string, ...string[]];
  return {
    layer: layerId,
    field: first,
    values: [properties[first] as string | number],
    where: rest.map((field) => ({ field, value: properties[field] as string | number | boolean })),
    hover: true,
  };
}

/** Enough of a selection to tell whether the highlight would actually change. */
function fingerprint(selection: Selection): string {
  const where = (selection.where ?? []).map((c) => `${c.field}=${String(c.value)}`).join("\u0000");
  return `${selection.layer}\u0000${selection.field}\u0000${selection.values.join(",")}\u0000${where}`;
}
