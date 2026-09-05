/**
 * One model, placed at every feature of a layer.
 *
 * The difference between a scene and a dataset. Forty turbines dropped by hand
 * is an afternoon and forty chances to put one in the wrong field; the same
 * forty taken from the layer that already knows where they are is a click, and
 * it is right by construction.
 *
 * This is an expansion rather than a binding: it runs once and produces
 * ordinary placements. A live binding would be tidier in the document and
 * worse everywhere else — the placements it made could not be nudged, deleted,
 * exported or undone one at a time, because they would not exist. These do.
 * The cost is that they do not follow the layer if it changes, which is the
 * right trade for a thing whose whole point is that you can then move one.
 */

import type { Model3D } from "./types/project";

/** A feature reduced to what a placement needs from it. */
export interface Placeable {
  position: [number, number];
  properties?: Record<string, unknown>;
}

export interface SpreadOptions {
  /**
   * How many to make.
   *
   * A point layer can hold a hundred thousand rows, and a hundred thousand
   * meshes is not a map, it is a stopped browser. The cap is part of the
   * request rather than a hidden safeguard, so the number that came back can
   * be compared with the number asked for.
   */
  limit: number;
  /** A column holding the bearing each one should face, in degrees. */
  headingField?: string;
  /** A column holding a per-feature multiplier on the template's scale. */
  scaleField?: string;
  /** A column holding metres above the ground. */
  altitudeField?: string;
}

/** What came back, and what did not. */
export interface Spread {
  models: Model3D[];
  /** Features there were, before the cap. */
  available: number;
}

/**
 * @param template A placement to copy. Its own position is ignored.
 * @param prefix Distinguishes one spread's ids from another's.
 */
export function spreadModels(
  template: Model3D,
  features: Placeable[],
  prefix: string,
  options: SpreadOptions,
): Spread {
  const models: Model3D[] = [];
  const taken = features.slice(0, Math.max(0, options.limit));

  taken.forEach((feature, index) => {
    const props = feature.properties ?? {};
    models.push({
      ...template,
      id: `${prefix}_${index}`,
      name: `${template.name} ${index + 1}`,
      position: feature.position,
      heading: numberFrom(props, options.headingField) ?? template.heading,
      /*
       * A scale column multiplies rather than replaces. The template's scale is
       * what makes the file life-sized in the first place — a model authored in
       * centimetres starts at a hundredth — and a column of turbine heights
       * that overwrote it would silently undo that.
       */
      scale: template.scale * (numberFrom(props, options.scaleField) ?? 1),
      altitude: numberFrom(props, options.altitudeField) ?? template.altitude,
    });
  });

  return { models, available: features.length };
}

/**
 * A property read as a number, or nothing.
 *
 * A vector tile hands back whatever the column held, which for a field someone
 * typed into is as likely to be "12 m" or an empty string as it is to be 12.
 * Anything that is not a finite number is no answer rather than a zero, because
 * a turbine facing due north because its bearing column was blank is a wrong
 * map that looks like a right one.
 */
function numberFrom(
  properties: Record<string, unknown>,
  field: string | undefined,
): number | undefined {
  if (!field) return undefined;
  const raw = properties[field];
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}
