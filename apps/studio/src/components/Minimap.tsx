import { useEffect, useRef } from "react";
import { Map as MapLibreMap } from "maplibre-gl";
import type { Basemap } from "@alidade/core";

/** How far out the overview sits from the main map. */
const ZOOM_BEHIND = 4.5;

/**
 * A second, smaller map showing where the main one is looking.
 *
 * It is a separate MapLibre instance rather than a rendering of the same one,
 * because there is no way to draw one map twice; it carries only the basemap,
 * because an overview cluttered with the data you are already looking at tells
 * you nothing you did not know.
 */
export function Minimap({
  basemap,
  centre,
  zoom,
  bearing,
  onGoTo,
}: {
  basemap: Basemap;
  centre: [number, number];
  zoom: number;
  bearing: number;
  onGoTo: (lon: number, lat: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const jump = useRef(onGoTo);
  jump.current = onGoTo;

  useEffect(() => {
    if (!holder.current) return;
    let cancelled = false;

    const overview = new MapLibreMap({
      container: holder.current,
      style: { version: 8, sources: {}, layers: [] },
      center: centre,
      zoom: Math.max(0, zoom - ZOOM_BEHIND),
      attributionControl: false,
      interactive: false,
    });

    /*
     * Held straight away rather than on `load`. The basemap effect runs in the
     * same commit as this one and would find a null ref, and since the basemap
     * has not changed it would never run again: an overview that stayed black.
     */
    map.current = overview;

    // Clicking the overview is the fastest way to move a long distance.
    overview.getCanvas().style.cursor = "pointer";
    overview.getContainer().addEventListener("click", (event) => {
      const box = overview.getContainer().getBoundingClientRect();
      const at = overview.unproject([event.clientX - box.left, event.clientY - box.top]);
      jump.current(at.lng, at.lat);
    });

    return () => {
      cancelled = true;
      map.current = null;
      overview.remove();
    };
    // Built once. The camera and the basemap are pushed in by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Rebuilt only when the basemap really changes.
   *
   * The dependency was the basemap object, and every edit to the project — every
   * mouse move that changed a hover highlight — produced a fresh one, because the
   * manager deep-clones on update. So the overview tore down and rebuilt its
   * layers continuously and flashed black. Identity is not change; the tiles are.
   */
  const tiles = basemap.raster ?? basemap.overview;
  const signature = `${basemap.id}|${basemap.background}|${(tiles?.tiles ?? []).join(",")}`;

  useEffect(() => {
    const overview = map.current;
    if (!overview) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      if (overview.getLayer("mini:raster")) overview.removeLayer("mini:raster");
      if (overview.getSource("mini:raster")) overview.removeSource("mini:raster");
      if (overview.getLayer("mini:background")) overview.removeLayer("mini:background");

      overview.addLayer({
        id: "mini:background",
        type: "background",
        paint: { "background-color": basemap.background },
      });
      /*
       * A vector basemap has no pictures to put here, and this box is never at
       * street zoom, so it draws the shallow raster the basemap carries for it.
       */
      if (!tiles) return;
      overview.addSource("mini:raster", {
        type: "raster",
        tiles: tiles.tiles,
        tileSize: tiles.tileSize ?? 256,
      });
      overview.addLayer({ id: "mini:raster", type: "raster", source: "mini:raster", paint: {} });
    };
    if (overview.isStyleLoaded()) apply();
    else overview.once("load", apply);
    return () => {
      cancelled = true;
    };
    // Keyed on what the overview actually draws, not on the object holding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  /* follow the main camera */
  useEffect(() => {
    const overview = map.current;
    if (!overview) return;
    overview.jumpTo({ center: centre, zoom: Math.max(0, zoom - ZOOM_BEHIND), bearing });
  }, [centre, zoom, bearing]);

  return (
    <div className="minimap">
      <div className="minimapholder" ref={holder} />
      <span className="minimapbox" />
    </div>
  );
}
