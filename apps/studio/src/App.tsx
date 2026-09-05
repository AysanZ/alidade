import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import type { Bookmark, Extent, LayerNode, Model3D, Projection, Selection } from "@alidade/core";
import {
  GLOBE_IS_ROUND_BELOW,
  denominatorAt,
  findModel,
  formatCoordinate,
  gridKey,
  newModel,
  padded,
  needsFraming,
  removeModel,
  toleranceInMetres,
  utmCell,
  viewForExtent,
  withMinimumSize,
  withModel,
} from "@alidade/core";
import { MapManager, watchStyleSwaps, type Renderer } from "@alidade/maplibre";
import { ThreeModelHost } from "@alidade/three";

import { AddData } from "./components/AddData";
import { AttributeTable } from "./components/AttributeTable";
import { LayerMenu, moveWithinSlot } from "./components/LayerMenu";
import { BasemapGallery } from "./components/BasemapGallery";
import { DrawOverlay } from "./components/DrawOverlay";
import { DrawPanel } from "./components/DrawPanel";
import { FeatureTip, type Tip } from "./components/FeatureTip";
import { Identify, type Identified } from "./components/Identify";
import { Inspector } from "./components/Inspector";
import { Legend } from "./components/Legend";
import { LayerTree } from "./components/LayerTree";
import { MapChrome, type Camera } from "./components/MapChrome";
import { MapControls } from "./components/MapControls";
import { Minimap } from "./components/Minimap";
import { ModelInspector } from "./components/ModelInspector";
import { ModelsPanel } from "./components/ModelsPanel";
import { ProjectPanel } from "./components/ProjectPanel";
import { Rail, type PaneId } from "./components/Rail";
import { ScenePanel } from "./components/ScenePanel";
import { TitleBar } from "./components/TitleBar";
import { emptyProject, emptyStyle, migrate } from "./project";
import { allLayers, bundleIdsOf, duplicateNode, findLayer, removeNode, withNode } from "./tree";
import { featureLabel } from "./label";
import { markerImageFor, registerMarkers } from "./markers";
import type { ModelStatus } from "./models";
import { useDrawing } from "./useDrawing";
import { useProject } from "./useProject";
import { stampedPng } from "./export";
import { forget, makeAutosave, parseProject, restore, save } from "./storage";

/**
 * How far off a feature the pointer may be and still count as over it.
 *
 * Only used when an exact query found nothing, so it never steals a click from
 * something the user really is pointing at. Four pixels is about the slack a
 * hand has on a mouse, and it is the difference between a hairline coastline
 * being identifiable and being decoration.
 */
const HIT_TOLERANCE = 4;

/**
 * How near a vertex the pointer has to be for a snap to take, in pixels.
 *
 * Pixels rather than metres because it is a fact about aim, not about the world:
 * the same hand is equally accurate at every zoom. It is converted against the
 * current scale before the geometry ever sees it.
 */
const SNAP_PIXELS = 12;

const TITLES: Record<PaneId, string> = {
  layers: "Layers",
  basemaps: "Basemaps",
  scene: "Scene",
  models: "3D models",
  draw: "Draw and measure",
  project: "Project",
};

/**
 * Where the camera goes to look at a model.
 *
 * Close enough that a lorry is a lorry and not a pixel, tilted enough that it
 * has a side, and no closer: at zoom 18 the sample lantern fills the screen.
 */
const MODEL_ZOOM = 17;
const MODEL_PITCH = 60;

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const {
    project,
    log,
    edit,
    transient,
    checkpoint,
    sync,
    attach,
    warning,
    setWarning,
    history,
    open,
    adopt,
  } = useProject(emptyProject);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [pane, setPane] = useState<PaneId>("layers");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } } | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
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
  /*
   * The 3D models. One host for the life of the map, made before the map is:
   * the manager is built with it, and a project restored from storage with
   * models in it replays them into the host on the first pass like anything
   * else. What the host learns about each file comes back as status, which is
   * React's, so the panel can say "loading", "failed" or "4.2 m tall".
   */
  const host = useRef<ThreeModelHost | null>(null);
  const [modelStatus, setModelStatus] = useState<Record<string, ModelStatus>>({});
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  /** The model the next click on the map will move. */
  const [placing, setPlacing] = useState<string | null>(null);
  /** The scene is being skipped because the map is a sphere. */
  const [globe, setGlobe] = useState(false);
  const [modelHover, setModelHover] = useState<string | null>(null);
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

  const drawing = useDrawing(project, edit, transient, checkpoint);

  /*
   * The map survives a refresh.
   *
   * Autosave rather than a Save button that must be remembered: the document is
   * forty kilobytes of JSON with no geometry in it, so writing it costs nothing
   * and losing it costs an afternoon. Save is still there for people who want to
   * be sure, and Export is the copy that outlives the browser.
   */
  const autosave = useRef(makeAutosave((message) => setProblem(message)));
  const restored = useRef(false);

  useEffect(() => {
    // Nothing to save before the manager exists, and nothing worth saving until
    // the restored document has been put back.
    if (!restored.current) return;
    autosave.current.schedule(project);
    setSavedAt(Date.now());
  }, [project]);

  const keep = useCallback(() => {
    if (save(project, setProblem)) setSavedAt(Date.now());
  }, [project]);

  const reopen = useCallback(
    (text: string, filename: string) => {
      try {
        open(migrate(parseProject(text)));
      } catch (error) {
        setProblem(
          `${filename} could not be opened: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [open],
  );

  const exportProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.id}.alidade.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [project]);

  /*
   * The map is built once and lives in a ref, but the handlers it registers need
   * to reach state that changes. Anything a handler reads goes through a ref that
   * is written on every render, rather than through the closure it was born with.
   */
  const onClick = useRef(drawing.click);
  onClick.current = drawing.click;
  const onDrawMove = useRef(drawing.move);
  onDrawMove.current = drawing.move;
  const onDrawFinish = useRef(drawing.finish);
  onDrawFinish.current = drawing.finish;
  const drawingNow = useRef(false);
  drawingNow.current = drawing.session.mode !== null;
  /** Editing or drawing: either way the pointer is a tool, not a pan handle. */
  const editingNow = useRef(false);
  editingNow.current = drawing.editing;
  /** The scale the snap tolerance is measured against, read at pointer time. */
  const scale = useRef({ zoom: 1, latitude: 0 });
  scale.current = { zoom: camera.zoom, latitude: camera.latitude };
  const latest = useRef(project);
  latest.current = project;
  const placingNow = useRef<string | null>(null);
  placingNow.current = placing;
  const onPlaced = useRef((_id: string, _at: [number, number]) => {});
  const onModelPicked = useRef((_id: string) => {});

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

    const models = new ThreeModelHost({
      onLoaded: (id, info) => setModelStatus((was) => ({ ...was, [id]: { state: "ready", info } })),
      onFailed: (id, reason) => setModelStatus((was) => ({ ...was, [id]: { state: "failed", reason } })),
      onGlobe: setGlobe,
    });
    host.current = models;

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
      /*
       * Whatever was on the screen last time, if it is still readable. It is put
       * back through the manager rather than into React state, so the reconciler
       * builds the map from it exactly as it would from any other edit.
       */
      const saved = restore(emptyProject.schema);
      const manager = new MapManager(map as unknown as Renderer, migrate(saved ?? emptyProject), {
        onWarning: (message) => setProblem(message),
        host: models,
      });
      watchStyleSwaps(map as never, manager);
      attach(manager);
      if (saved) {
        adopt(saved);
        map.jumpTo({
          center: saved.view.center,
          zoom: saved.view.zoom,
          pitch: saved.view.pitch,
          bearing: saved.view.bearing,
        });
      }
      restored.current = true;
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
      if (drawingNow.current || editingNow.current) {
        onDrawMove.current(
          [e.lngLat.lng, e.lngLat.lat],
          toleranceInMetres(SNAP_PIXELS, scale.current.zoom, scale.current.latitude),
        );
      }
      if (drawingNow.current || placingNow.current) return clearHover();
      /*
       * A model stands over whatever is under it, so it is asked first. The
       * quick test is a box per model, which is what a pointer can afford at
       * frame rate; the click that follows tests the triangles.
       */
      const model = latest.current.models?.items.length ? models.pick(e.point.x, e.point.y) : null;
      if (model) {
        map.getCanvas().style.cursor = "pointer";
        if (hovering.key !== null) {
          hovering.key = null;
          setHover(null);
        }
        setModelHover(model);
        const canvas = map.getCanvas();
        setTipAt({ x: e.point.x, y: e.point.y, width: canvas.clientWidth, height: canvas.clientHeight });
        return;
      }
      setModelHover(null);
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
    map.on("mouseout", () => {
      setModelHover(null);
      clearHover();
    });

    /*
     * A double click finishes the shape, because that is what every GIS does and
     * because Enter is not reachable with a mouse in one hand and a plan in the
     * other. MapLibre's own double-click zoom would fire underneath it, so the
     * event is stopped rather than merely handled.
     */
    map.on("dblclick", (e: MapMouseEvent) => {
      if (!drawingNow.current) return;
      e.preventDefault();
      onDrawFinish.current();
    });

    map.on("click", (e: MapMouseEvent) => {
      if (drawingNow.current) return onClick.current([e.lngLat.lng, e.lngLat.lat]);
      // A placement in progress owns the click: the model goes where it landed.
      if (placingNow.current) return onPlaced.current(placingNow.current, [e.lngLat.lng, e.lngLat.lat]);
      if (latest.current.models?.items.length) {
        const model = models.pick(e.point.x, e.point.y, true);
        if (model) return onModelPicked.current(model);
      }
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
      models.dispose();
      host.current = null;
    };
  }, [adopt, attach, readCamera, sync]);

  /*
   * A dropped placement lands here from the map's own click handler, through a
   * ref, because that handler was registered once and this closure changes.
   */
  onPlaced.current = (id, at) => {
    edit((d) => withModel(d, id, (m) => void (m.position = [Number(at[0].toFixed(7)), Number(at[1].toFixed(7))])));
    setPlacing(null);
  };
  onModelPicked.current = (id) => {
    setSelectedModel(id);
    setSelected(null);
    setFound(null);
    setPane("models");
  };

  /* The outline follows the selection, and a selection of a model is not one of a layer. */
  useEffect(() => {
    host.current?.select(selectedModel);
  }, [selectedModel]);

  /* A selected model that is no longer in the document is no longer selected. */
  useEffect(() => {
    if (selectedModel && !findModel(project, selectedModel)) setSelectedModel(null);
    if (placing && !findModel(project, placing)) setPlacing(null);
    // Status for models that are gone is not worth keeping, however cheap.
    setModelStatus((was) => {
      const ids = new Set((project.models?.items ?? []).map((m) => m.id));
      const kept = Object.fromEntries(Object.entries(was).filter(([id]) => ids.has(id)));
      return Object.keys(kept).length === Object.keys(was).length ? was : kept;
    });
  }, [project, selectedModel, placing]);

  /* The pointer becomes a crosshair while a placement is waiting for a click. */
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas && !drawing.session.mode) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing, drawing.session.mode]);

  /**
   * Put a file on the map.
   *
   * At the centre of the view, because that is the one place the user is
   * certainly looking at, and then the camera comes in to where the thing has a
   * size, unless it is already there. Adding a lorry at zoom 3 and leaving the
   * camera where it was is adding an invisible lorry.
   */
  const addModel = useCallback(
    (partial: Pick<Model3D, "url" | "name"> & Partial<Model3D>) => {
      const map = mapRef.current;
      if (!map) return;
      const centre = map.getCenter();
      const model = newModel({
        ...partial,
        position: [Number(centre.lng.toFixed(7)), Number(centre.lat.toFixed(7))],
      });
      edit((d) => {
        d.models ??= { visible: true, items: [] };
        d.models.visible = true;
        d.models.items.push(model);
        return d;
      });
      setSelectedModel(model.id);
      setSelected(null);
      if (map.getZoom() < MODEL_ZOOM - 1.5 || map.getPitch() < 20) {
        map.easeTo({ zoom: Math.max(map.getZoom(), MODEL_ZOOM), pitch: MODEL_PITCH, duration: 1100 });
      }
    },
    [edit],
  );

  const zoomToModel = useCallback(
    (id: string) => {
      const model = findModel(project, id);
      const map = mapRef.current;
      if (!model || !map) return;
      map.flyTo({
        center: model.position,
        zoom: Math.max(map.getZoom(), MODEL_ZOOM),
        pitch: Math.max(map.getPitch(), MODEL_PITCH),
        duration: 900,
      });
    },
    [project],
  );

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

    // Transient: a highlight is where the pointer is, not something that was
    // done to the map, and it must not be a step in the history.
    transient((d) => {
      // Only touch the document when the highlight is actually different, or a
      // mouse moving across a polygon would emit an operation per frame.
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
  }, [hover, found, transient]);

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
   * Dragging a vertex must not also drag the map. The handle swallows the event,
   * but MapLibre listens on the canvas underneath and would pan anyway.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (drawing.dragging) map.dragPan.disable();
    else if (!locks.pan) map.dragPan.enable();
  }, [drawing.dragging, locks.pan]);

  /*
   * Escape steps back out of whatever is open, in the order a person expects:
   * the popup first, then presentation mode. Drawing has its own escape.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (placing) setPlacing(null);
      else if (found) setFound(null);
      else if (presenting) setPresenting(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [found, presenting, placing]);

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

  /**
   * Selecting from the table.
   *
   * Transient either way. Pointing at a row is not an edit to the map, and a
   * history full of "you looked at row 41" is a history with your actual work
   * pushed off the end of it.
   */
  const select = useCallback(
    (layer: string, field: string, values: (string | number)[], hover: boolean) => {
      transient((d) => {
        if (values.length === 0) delete d.selection;
        else d.selection = { layer, field, values, hover };
        return d;
      });
    },
    [transient],
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
  const hoveredModel = modelHover ? findModel(project, modelHover) : undefined;
  const tip: Tip | null =
    hoveredModel && tipAt && !found && !drawing.session.mode && !placing
      ? {
          name: hoveredModel.name,
          layer: "3D model",
          at: { x: tipAt.x, y: tipAt.y },
          viewport: { width: tipAt.width, height: tipAt.height },
        }
      : hover && tipAt && hoverName && !found && !drawing.session.mode
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
      <TitleBar
        project={project}
        ops={log.length}
        edit={edit}
        history={history}
        savedAt={savedAt}
        onSave={keep}
        onOpen={reopen}
        onExport={exportProject}
      />

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
              <button className="add" onClick={() => setAdding(true)} title="Add a layer to the map">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5.5v13M5.5 12h13" />
                </svg>
                Add layer
              </button>
            )}
          </div>
          <div className="pbody">
          {pane === "layers" && (
            <LayerTree
              project={project}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setSelectedModel(null);
              }}
              edit={edit}
              onMenu={(id, at) => setMenu({ id, at })}
              onAdd={() => setAdding(true)}
              onFlyTo={(extent) => flyTo(extent, true)}
              denominator={denominator}
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
          {pane === "models" && (
            <ModelsPanel
              project={project}
              edit={edit}
              status={modelStatus}
              selected={selectedModel}
              onSelect={(id) => {
                setSelectedModel(id);
                if (id) setSelected(null);
              }}
              onAdd={addModel}
              onZoomTo={zoomToModel}
              onRemove={(id) => {
                edit((d) => removeModel(d, id));
                if (selectedModel === id) setSelectedModel(null);
              }}
              onProblem={setProblem}
              globe={globe}
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
              snapping={drawing.snapping}
              onSnapping={drawing.setSnapping}
              editing={drawing.editing}
              onEditing={drawing.setEditing}
              selected={drawing.selected}
              onSelect={drawing.setSelected}
              onUndo={drawing.undo}
            />
          )}
          {pane === "project" && (
            <ProjectPanel
              project={project}
              log={log}
              onExportImage={exportImage}
              onDiscard={() => {
                autosave.current.cancel();
                forget();
                open(emptyProject);
                setSavedAt(null);
              }}
            />
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
          {placing && !drawing.session.mode && (
            <div className="drawhint">
              <b>Placing {findModel(project, placing)?.name ?? "model"}</b>
              <span>Click the map to put it there · Escape keeps it where it is</span>
            </div>
          )}
          {(drawing.session.mode || drawing.editing) && (
            <div className="drawhint">
              <b>
                {drawing.editing
                  ? "Editing shapes"
                  : drawing.session.measure
                    ? `Measuring ${drawing.session.measure}`
                    : `Drawing a ${drawing.session.tool}`}
              </b>
              <span>
                {drawing.editing
                  ? "Drag the shape to move it · drag a square for a vertex · Alt-click to remove"
                  : drawing.session.tool === "rectangle"
                    ? "Click one corner, then the opposite one · Escape cancels"
                    : drawing.session.tool === "circle"
                      ? "Click the centre, then a point on the edge · Escape cancels"
                      : drawing.session.mode === "point"
                        ? "Click to place · Escape to stop"
                        : "Click to add · Backspace undoes · double click or Enter finishes"}
              </span>
            </div>
          )}

          {/*
            Live feedback sits above the canvas rather than in the style. The
            rubber band follows the mouse, and the mouse is not part of the map.
          */}
          <DrawOverlay
            annotations={project.annotations}
            active={drawing.active}
            cursor={drawing.cursor}
            snapAt={drawing.snapAt}
            readout={drawing.readout}
            editing={drawing.editing}
            selected={drawing.selected}
            units={project.chrome.scaleBar.units}
            anchor={drawing.anchor}
            spanning={
              drawing.session.tool === "rectangle" || drawing.session.tool === "circle"
                ? drawing.session.tool
                : null
            }
            project={(position) => {
              const map = mapRef.current;
              if (!map) return null;
              const point = map.project(position);
              return { x: point.x, y: point.y };
            }}
            unproject={(event) => {
              const map = mapRef.current;
              if (!map) return null;
              const box = map.getCanvas().getBoundingClientRect();
              const at = map.unproject([event.clientX - box.left, event.clientY - box.top]);
              return [at.lng, at.lat];
            }}
            onVertexDown={drawing.vertex.begin}
            onMidpointDown={drawing.vertex.beginMidpoint}
            onVertexRemove={drawing.vertex.drop}
            onShapeDown={drawing.vertex.beginShape}
            onSelect={drawing.setSelected}
          />
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

        {selectedModel ? (
          <ModelInspector
            project={project}
            id={selectedModel}
            status={modelStatus[selectedModel]}
            edit={edit}
            placing={placing === selectedModel}
            onPlace={(on) => setPlacing(on ? selectedModel : null)}
            onZoomTo={() => zoomToModel(selectedModel)}
            onSelect={setSelectedModel}
          />
        ) : (
          <Inspector
            project={project}
            selected={selected}
            edit={edit}
            denominator={denominator}
            onFlyTo={flyTo}
            onRemoved={() => setSelected(null)}
            onAttributes={setTable}
          />
        )}

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
              setSelectedModel(null);
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
            transient((d) => {
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
