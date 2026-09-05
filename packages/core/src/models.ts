import type { MapProject, Model3D, ModelAnchor } from "./types/project";

/**
 * 3D models, the part of them that is arithmetic.
 *
 * Nothing here knows what a mesh is. This is the maths that turns a placement
 * — a position, a height, a bearing, a scale — into a frame a renderer can put
 * a mesh into, and it lives in the core so it can be tested without a GPU and
 * so the renderer package is left with nothing to get wrong but the rendering.
 */

/** The engine layer the scene is drawn into. One layer, however many models. */
export const MODELS_LAYER_ID = "models:scene";

/* ---------------------------------------------------------------- mercator */

/**
 * Web mercator as the renderer sees it: a unit square with x east, y south and
 * z up, where one unit of z is the same distance on the ground as one unit of
 * x at that latitude. The constants are the renderer's own, so a coordinate
 * computed here lands exactly where the renderer would have put it.
 */
export const EARTH_RADIUS = 6371008.8;
const CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS;
const MAX_LATITUDE = 85.051129;

export interface Mercator {
  x: number;
  y: number;
  z: number;
}

/** How many mercator units one metre is at a latitude. Grows towards the poles. */
export function unitsPerMetre(latitude: number): number {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  return 1 / (CIRCUMFERENCE * Math.cos((clamped * Math.PI) / 180));
}

export function toMercator(lon: number, lat: number, altitude = 0): Mercator {
  const clamped = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const phi = (clamped * Math.PI) / 180;
  return {
    x: (lon + 180) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + phi / 2))) / 360,
    z: altitude * unitsPerMetre(clamped),
  };
}

/* ---------------------------------------------------------------- frame */

/**
 * A model as a renderer wants it: an offset in metres from a local origin, a
 * yaw about the vertical, and a scale.
 *
 * The local frame is metric, with x east, y up and z south, so a mesh built in
 * metres with y up — which is what glTF specifies — drops in with no
 * conversion. It is anchored at `origin` rather than at the model, because a
 * scene is drawn with one camera and every model in it has to agree on where
 * zero is. The origin is wherever the renderer says; the map centre is a good
 * choice, because then every number is small and single-precision arithmetic
 * on the GPU stays exact at building scale.
 */
export interface Frame {
  /** Metres east, up and south of the origin. */
  offset: [number, number, number];
  /** Radians about the vertical, applied to the mesh in its own frame. */
  yaw: number;
  /** Multiplies the mesh's own units. */
  scale: number;
}

/**
 * Where a placement sits relative to an origin.
 *
 * `ground` is the height of the terrain under the model in metres, when there
 * is terrain and the model follows it. The scale is corrected for latitude so
 * a model at a different latitude from the origin is still the right size on
 * the ground: mercator stretches towards the poles, and a metre at the model
 * is more mercator units than a metre at the origin.
 */
export function frameOf(
  model: Model3D,
  origin: { lon: number; lat: number },
  ground = 0,
): Frame {
  const [lon, lat] = model.position;
  const o = toMercator(origin.lon, origin.lat);
  const m = toMercator(lon, lat, model.altitude + ground);
  const k = unitsPerMetre(origin.lat);
  return {
    offset: [(m.x - o.x) / k, m.z / k, (m.y - o.y) / k],
    yaw: yawOf(model.heading),
    scale: (model.scale * unitsPerMetre(lat)) / k,
  };
}

/**
 * A bearing as a rotation about the vertical.
 *
 * glTF puts a model's front on +z. In the local frame +z is south, so a model
 * with no rotation faces south, and facing north — heading 0, the way a
 * bearing is stated — is half a turn. Increasing the heading turns the model
 * clockwise seen from above, which is what increasing a bearing does.
 */
export function yawOf(heading: number): number {
  return Math.PI - (heading * Math.PI) / 180;
}

/* ---------------------------------------------------------------- document */

let counter = 0;

/**
 * A new placement with everything a renderer needs to draw it.
 *
 * The id is time and a counter rather than a random string, so two models
 * added in the same millisecond are still different and the order they were
 * added in can be read off the id in a bug report.
 */
/** Small enough to be honest at working zooms, big enough to find. */
export const DEFAULT_MIN_PIXELS = 26;

export function newModel(
  partial: Partial<Model3D> & Pick<Model3D, "url" | "position">,
): Model3D {
  counter = (counter + 1) % 1000;
  return {
    id: `model_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}`,
    name: partial.name ?? nameFromUrl(partial.url),
    url: partial.url,
    position: partial.position,
    altitude: partial.altitude ?? 0,
    heading: partial.heading ?? 0,
    scale: partial.scale ?? 1,
    anchor: partial.anchor ?? "base",
    clamp: partial.clamp ?? true,
    visible: partial.visible ?? true,
    opacity: partial.opacity ?? 1,
    /*
     * On by default. A placement that is true to scale and half a pixel wide is
     * indistinguishable from one that failed to load, and the first thing
     * anybody does after adding a model is look for it.
     */
    minPixels: partial.minPixels ?? DEFAULT_MIN_PIXELS,
    ...(partial.attribution !== undefined ? { attribution: partial.attribution } : {}),
  };
}

/** `https://x/y/CesiumMilkTruck.glb?v=2` is a milk truck. */
export function nameFromUrl(url: string): string {
  const last = url.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "Model";
  const stem = decodeURIComponent(last).replace(/\.(glb|gltf)$/i, "");
  // CamelCase and snake_case both come out as words.
  return stem.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim() || "Model";
}

export function findModel(project: MapProject, id: string): Model3D | undefined {
  return project.models?.items.find((m) => m.id === id);
}

/** Edits one model in place inside a draft the caller already owns. */
export function withModel(
  draft: MapProject,
  id: string,
  change: (model: Model3D) => void,
): MapProject {
  const model = findModel(draft, id);
  if (model) change(model);
  return draft;
}

export function removeModel(draft: MapProject, id: string): MapProject {
  if (draft.models) draft.models.items = draft.models.items.filter((m) => m.id !== id);
  return draft;
}

/** A copy beside the original, a few metres east so the two can be told apart. */
export function duplicateModel(draft: MapProject, id: string): MapProject {
  const model = findModel(draft, id);
  if (!model || !draft.models) return draft;
  const east = 8 / (111_320 * Math.cos((model.position[1] * Math.PI) / 180));
  const copy = newModel({
    ...model,
    name: `${model.name} copy`,
    position: [model.position[0] + east, model.position[1]],
  });
  const at = draft.models.items.findIndex((m) => m.id === id);
  draft.models.items.splice(at + 1, 0, copy);
  return draft;
}

/** Whether the file is one a glTF loader can read, judged by its name. */
export function looksLikeModel(url: string): boolean {
  return /\.(glb|gltf)(\?|#|$)/i.test(url) || url.startsWith("blob:");
}

/**
 * The placement in words, for a list.
 *
 * Coordinates to four places, which is eleven metres and enough to tell two
 * placements apart; the inspector has the full figure. Heading only when it is
 * not north, height only when it is not on the ground: the common case reads
 * as a position and nothing else.
 */
export function describeModel(model: Model3D): string {
  const [lon, lat] = model.position;
  const parts = [`${lat.toFixed(4)}, ${lon.toFixed(4)}`];
  if (model.altitude !== 0) parts.push(`${model.altitude >= 0 ? "+" : ""}${round(model.altitude)} m`);
  if (model.heading !== 0) parts.push(`${Math.round(model.heading)}°`);
  if (model.scale !== 1) parts.push(`×${round(model.scale)}`);
  return parts.join(" · ");
}

function round(n: number): string {
  return Math.abs(n) >= 100 ? Math.round(n).toString() : Number(n.toPrecision(3)).toString();
}

/**
 * How far off the ground to draw the mesh so that the anchor holds.
 *
 * `low` is the bottom of the mesh in its own units, from a bounding box the
 * renderer measured once the file arrived. With `base` the mesh is raised by
 * that amount so its lowest point is at altitude zero; a file whose origin is
 * already at the base has `low` near zero and moves by nothing.
 */
export function anchorLift(anchor: ModelAnchor, low: number): number {
  return anchor === "base" ? 0 - low : 0;
}
