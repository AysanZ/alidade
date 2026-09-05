import { Matrix4, Quaternion, Vector3 } from "three";
import { toMercator, unitsPerMetre, type Frame } from "@alidade/core";

/**
 * The two matrices that put a metric scene onto a mercator map.
 *
 * The map hands a custom layer one matrix, which takes mercator coordinates —
 * a unit square, y down, z conformal — to the screen. A mesh does not live in
 * mercator: it is built in metres, y up, and a truck is a few of them. The
 * scene is therefore drawn in a metric frame pinned at `origin`, and the
 * camera is given the map's matrix with the change of frame folded into it.
 *
 * Folding is the point, not a convenience. The map's matrix carries values in
 * the millions at street zoom, and a mesh's coordinates are fractions of a
 * metre; multiply the two in single precision on the GPU and a building
 * twitches as the camera moves. Composed here in double precision, with the
 * origin at the map centre so every mesh coordinate is small, the product the
 * GPU sees is well conditioned and the building stands still.
 */

const UP = new Vector3(0, 1, 0);
const TILT = new Matrix4().makeRotationX(Math.PI / 2);

/**
 * The map's matrix for a scene in metres at `origin`.
 *
 * Right to left: tip the scene so its y is the map's z, scale metres to
 * mercator units — negative in y because mercator y runs south and the scene's
 * z, which lands there, runs south too, so the sign puts it back — and move it
 * to the origin. Then whatever the map does.
 */
export function cameraMatrix(
  mapMatrix: ArrayLike<number>,
  origin: { lon: number; lat: number },
  target = new Matrix4(),
): Matrix4 {
  const o = toMercator(origin.lon, origin.lat);
  const k = unitsPerMetre(origin.lat);
  const local = new Matrix4()
    .makeTranslation(o.x, o.y, o.z)
    .scale(new Vector3(k, -k, k))
    .multiply(TILT);
  return target.fromArray(mapMatrix).multiply(local);
}

/** A frame as an object's matrix: translate, then turn, then scale the mesh. */
export function placementMatrix(frame: Frame, target = new Matrix4()): Matrix4 {
  const [x, y, z] = frame.offset;
  return target.compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(UP, frame.yaw),
    new Vector3(frame.scale, frame.scale, frame.scale),
  );
}

/**
 * How much bigger than life something must be drawn to stay findable.
 *
 * One, almost always. At any scale where the object already covers its floor
 * this is exactly one and what is drawn is the truth. It only departs from the
 * truth when the alternative is drawing something nobody can see — a four metre
 * lorry at zoom 10 is a third of a pixel, which reads as a model that failed to
 * load — and it departs by the least that fixes that, so the object grows no
 * further as you zoom out past the threshold: it holds.
 *
 * A floor of zero turns it off, for a scene where being true to scale at every
 * zoom matters more than being able to find anything.
 */
export function visibilityBoost(
  heightMetres: number,
  pixelsPerMetre: number,
  floorPixels: number,
): number {
  if (floorPixels <= 0) return 1;
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return 1;
  if (!Number.isFinite(heightMetres) || heightMetres <= 0) return 1;
  const pixels = heightMetres * pixelsPerMetre;
  return pixels >= floorPixels ? 1 : floorPixels / pixels;
}
