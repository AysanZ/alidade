import {
  defaultAnnotations,
  defaultBuildings,
  defaultChrome,
  defaultModels,
  type MapProject,
} from "@alidade/core";

import { BASEMAPS } from "./basemaps";
import { DEM_SOURCE, OSM_SOURCE, OSM_SOURCE_ID } from "./sources";

/**
 * What the application opens with.
 *
 * It used to open with a Tehran density map hard-coded into it, title and all,
 * which made a general purpose tool look like one specific map that happened to
 * let you add layers to it. The project starts empty and unnamed, and the
 * database ships empty to match: every layer on the map is one you put there.
 */
export const emptyProject: MapProject = {
  schema: 3,
  id: "untitled",
  name: "Untitled map",
  view: { center: [20, 25], zoom: 1.9, pitch: 0, bearing: 0 },
  basemap: BASEMAPS[0]!,
  /*
   * The sky is on from the start. Without it a globe hangs in a flat black
   * rectangle, which reads as a rendering fault rather than as space, and the
   * atmosphere is the one cue that makes the sphere look like a planet.
   */
  environment: { sky: true },
  chrome: { ...defaultChrome(), overview: true },
  annotations: defaultAnnotations(),
  models: defaultModels(),
  bookmarks: [],
  sources: {
    dem: DEM_SOURCE,
    [OSM_SOURCE_ID]: OSM_SOURCE,
  },
  tree: [],
};

/**
 * The 3D basemap, off until asked for.
 *
 * The colours are read off the basemap rather than fixed, because a light grey
 * block on a dark canvas is a hole in the map and the same block on imagery is
 * a cloud. `dark` is the pair for a dark background; the studio picks between
 * them from the basemap the project is wearing.
 */
export const BUILDINGS = (dark: boolean) => ({
  ...defaultBuildings("osm"),
  color: dark ? "#2a2e36" : "#c9ccd2",
  roofColor: dark ? "#4c525d" : "#eceef1",
});

export const HILLSHADE = {
  source: "dem",
  illumination: 315,
  intensity: 0.5,
  shadowColor: "#000000",
  highlightColor: "#5a6470",
};

/**
 * An empty style. Everything on the map is put there by the adapter.
 *
 * The projection is declared here as well as applied through an operation, because
 * a style replaces it wholesale and the document has to win.
 */
export const emptyStyle = {
  version: 8 as const,
  /*
   * Fonts come from the same service as the tiles. The demo endpoint this used
   * to point at publishes a different set of stacks, and a label asking for a
   * stack the service does not have is not an error anyone sees — the glyphs
   * 404 and the label is simply absent. Everything that emits a symbol layer
   * names `LABEL_FONT` for the same reason.
   */
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  projection: { type: emptyProject.environment.projection ?? "mercator" },
  sources: {},
  layers: [],
};

/**
 * Bring a document forward to what the current code expects.
 *
 * A project saved before the vector basemap and the 3D buildings existed has no
 * `osm` source, and both of them read one. Without this the buildings switch
 * writes itself into the document and nothing appears on the map, because the
 * compiler will not point a layer at a source that was never declared — which
 * is the right thing for it to do and the wrong thing to leave unexplained.
 *
 * Additive only. It never removes or rewrites anything the user put there.
 */
export function migrate(project: MapProject): MapProject {
  const sources = project.sources[OSM_SOURCE_ID]
    ? project.sources
    : { ...project.sources, [OSM_SOURCE_ID]: OSM_SOURCE };
  return { ...project, sources, basemap: refreshBasemap(project.basemap) };
}

/**
 * Take the catalogue's current copy of a basemap the document already names.
 *
 * The document holds the whole basemap object, tile URLs included, which is
 * what lets a project carry a basemap this build has never heard of. The cost
 * is that a basemap which has gone bad stays bad: CARTO began watermarking
 * unkeyed tiles, the catalogue moved off it, and every saved document went on
 * asking CARTO for tiles anyway, because that is what was written in it. New
 * code, old document, and no way for the user to tell which one they were
 * looking at.
 *
 * So a basemap the catalogue still recognises by id is re-read from the
 * catalogue. What the user chose — the fade, whether names are drawn — is
 * theirs and survives; where the pixels come from is the application's and is
 * allowed to change underneath them. A basemap with an id the catalogue does
 * not know is left exactly as it was.
 */
function refreshBasemap(basemap: MapProject["basemap"]): MapProject["basemap"] {
  const current = BASEMAPS.find((b) => b.id === basemap.id);
  if (!current) return basemap;
  return { ...current, labels: basemap.labels, opacity: basemap.opacity };
}
