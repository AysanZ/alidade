/**
 * Data sources the application declares for itself, rather than the user.
 *
 * Its own module because both the basemap catalogue and the blank project need
 * it, and having either import the other is a cycle: the catalogue would be
 * half-built at the moment the project read it, which is an `undefined` that
 * only shows up at run time.
 */

/**
 * The keyless vector tiles the canvas basemaps and the 3D buildings both read.
 *
 * Declared as a TileJSON URL rather than a tile template because OpenFreeMap
 * puts the build date in the tile path and rotates it every week; a template
 * written into the document would be correct until the following Wednesday.
 * Nothing is fetched from a source no layer reads, so declaring it is free.
 */
export const OSM_SOURCE_ID = "osm";

export const OSM_SOURCE = {
  type: "vector" as const,
  url: "https://tiles.openfreemap.org/planet",
  attribution: "OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors",
};

/** Open elevation tiles, no key required. Terrain and hillshade both read this. */
export const DEM_SOURCE = {
  type: "raster-dem" as const,
  tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
  encoding: "terrarium" as const,
  tileSize: 256,
  maxzoom: 14,
  attribution: "Elevation: Mapzen and partners",
};
