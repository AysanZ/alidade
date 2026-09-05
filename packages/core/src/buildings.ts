/**
 * Extruded building footprints.
 *
 * The arithmetic of turning a `Buildings` into one engine layer, kept away from
 * the compiler so it can be read and tested on its own. Nothing here knows what
 * MapLibre is; it produces the same expression data every other layer produces.
 */

import type { EngineLayer } from "./types/ops";
import type { Buildings } from "./types/project";

export const BUILDINGS_LAYER_ID = "environment:buildings";

/**
 * OpenMapTiles over a keyless service.
 *
 * `render_height` is the schema's own answer to a building that states its
 * levels but not its height: the tile carries the metres either way, so the
 * client never has to guess what a storey is.
 */
export const defaultBuildings = (source = "osm"): Buildings => ({
  source,
  sourceLayer: "building",
  heightField: "render_height",
  baseField: "render_min_height",
  color: "#8a8f98",
  roofColor: "#b7bcc4",
  opacity: 0.92,
  minzoom: 14,
  exaggeration: 1,
  defaultHeight: 8,
  verticalGradient: true,
});

/**
 * Metres to the top of a building, as an expression.
 *
 * `coalesce` rather than a filter on the field: a footprint with no height is
 * still a building, and dropping it leaves a hole in the street where everyone
 * can see there is a building. It is drawn at `defaultHeight` instead, which is
 * a guess, and a guess that looks like a two-storey block is a better map than
 * a gap.
 */
export function heightExpression(buildings: Buildings): unknown {
  const raw = metres(buildings.heightField, buildings.defaultHeight);
  return buildings.exaggeration === 1 ? raw : ["*", raw, buildings.exaggeration];
}

/** Metres to the bottom. A building on stilts, or a floor of a larger one. */
export function baseExpression(buildings: Buildings): unknown {
  if (!buildings.baseField) return 0;
  const raw = metres(buildings.baseField, 0);
  return buildings.exaggeration === 1 ? raw : ["*", raw, buildings.exaggeration];
}

/**
 * Colour by height, so a city reads as a city.
 *
 * A single flat colour over every extrusion is a grey field with edges in it.
 * Interpolating from the wall colour up to the roof colour over the first
 * eighty metres separates the low blocks from the towers without inventing a
 * classification the user did not ask for.
 */
export function colorExpression(buildings: Buildings): unknown {
  if (!buildings.roofColor) return buildings.color;
  return [
    "interpolate",
    ["linear"],
    metres(buildings.heightField, buildings.defaultHeight),
    0,
    buildings.color,
    80,
    buildings.roofColor,
  ];
}

/**
 * Fade the extrusions in over the half zoom above `minzoom`.
 *
 * Without it a whole city appears between one frame and the next, which reads
 * as a glitch. The fade is on opacity rather than on height because growing
 * buildings out of the ground is an animation, and an animation that happens
 * every time you cross zoom 14 is a distraction.
 */
export function opacityExpression(buildings: Buildings): unknown {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    buildings.minzoom,
    0,
    buildings.minzoom + 0.5,
    buildings.opacity,
  ];
}

/**
 * A field read as metres, with a fallback for the footprints that have none.
 *
 * The `coalesce` has to come before the `to-number` and not after it: `to-number`
 * turns null into 0 rather than failing, so a fallback given as its second
 * argument never fires and every unsurveyed building is flattened to the ground.
 */
function metres(field: string, fallback: number): unknown {
  return ["to-number", ["coalesce", ["get", field], fallback]];
}

/** The one engine layer the whole 3D basemap is. */
export function buildingsLayer(buildings: Buildings): EngineLayer {
  return {
    id: BUILDINGS_LAYER_ID,
    type: "fill-extrusion",
    source: buildings.source,
    sourceLayer: buildings.sourceLayer,
    slot: "labels",
    minzoom: buildings.minzoom,
    paint: {
      "fill-extrusion-color": colorExpression(buildings),
      "fill-extrusion-height": heightExpression(buildings),
      "fill-extrusion-base": baseExpression(buildings),
      "fill-extrusion-opacity": opacityExpression(buildings),
      "fill-extrusion-vertical-gradient": buildings.verticalGradient,
    },
    layout: {},
  };
}
