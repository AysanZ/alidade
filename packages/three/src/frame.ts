import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { toMercator, unitsPerMetre, type Frame } from "@alidade/core";

/**
 * The two matrices that put a metric scene onto a mercator map.
 *
 * Folded together here, in double precision, with the origin at the map centre:
 * the same product in single precision on the GPU makes a building twitch.
 */

const UP = new Vector3(0, 1, 0);
const TILT = new Matrix4().makeRotationX(Math.PI / 2);

/**
 * The map's matrix for a scene in metres at `origin`. Right to left: tip, scale
 * metres to mercator units, translate. The y is negative because mercator runs south.
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

/**
 * A frame as an object's matrix: translate, turn, scale.
 *
 * `YXZ` is bank inside pitch inside heading, as an aircraft's are; any other
 * order makes an aeroplane that banks while descending come out yawed. The
 * signs are non-obvious — the frame reaches the map through a mirror in y — and
 * are pinned by tests that push a nose and a wingtip vector through the matrix.
 */
export function placementMatrix(frame: Frame, target = new Matrix4()): Matrix4 {
  const [x, y, z] = frame.offset;
  const turn =
    frame.pitch === 0 && frame.roll === 0
      ? new Quaternion().setFromAxisAngle(UP, frame.yaw)
      : new Quaternion().setFromEuler(new Euler(-frame.pitch, frame.yaw, frame.roll, "YXZ"));
  return target.compose(
    new Vector3(x, y, z),
    turn,
    new Vector3(frame.scale, frame.scale, frame.scale),
  );
}

/**
 * How much bigger than life something must be drawn to stay findable. One,
 * unless it is under the floor: a 4 m lorry at zoom 10 is a third of a pixel,
 * which reads as a model that failed to load. A floor of zero turns it off.
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
