import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { style } from "./style";

/** Scale denominator at the given zoom and latitude, at 96 dpi. */
function denominator(zoom: number, lat: number): number {
  const metresPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return Math.round(metresPerPixel / 0.00028);
}

export default function App() {
  const holder = useRef<HTMLDivElement>(null);
  const [readout, setReadout] = useState({ lon: 68.787, lat: 38.5598, scale: 25000 });

  useEffect(() => {
    if (!holder.current) return;

    const map = new maplibregl.Map({
      container: holder.current,
      style,
      center: [68.79, 38.5598],
      zoom: 11.5,
      attributionControl: false,
    });

    const update = (e?: maplibregl.MapMouseEvent) => {
      const c = e ? e.lngLat : map.getCenter();
      setReadout({
        lon: c.lng,
        lat: c.lat,
        scale: denominator(map.getZoom(), map.getCenter().lat),
      });
    };

    map.on("mousemove", update);
    map.on("move", () => update());
    map.on("load", () => update());

    return () => map.remove();
  }, []);

  return (
    <>
      <div className="map" ref={holder} />
      <div className="status">
        <span>EPSG:4326</span>
        <span>
          {readout.lat.toFixed(4)}° N · {readout.lon.toFixed(4)}° E
        </span>
        <span>1:{readout.scale.toLocaleString("en-US").replace(/,/g, " ")}</span>
        <span style={{ marginInlineStart: "auto" }}>ST_AsMVT · wards_1400</span>
      </div>
    </>
  );
}
