import { describe, expect, it } from "vitest";

import { wmsFeatureInfoUrl, wmsSource, wmsTileUrl } from "../src/wms";

const base = { url: "https://gis.example.org/geoserver/wms", layers: "alidade:landcover" };

describe("wms", () => {
  it("asks for the version it says it asks for", () => {
    expect(wmsTileUrl(base)).toContain("version=1.3.0");
  });

  it("names the projection parameter the way the version does", () => {
    expect(wmsTileUrl(base)).toContain("crs=EPSG%3A3857");
    expect(wmsTileUrl({ ...base, version: "1.1.1" })).toContain("srs=EPSG%3A3857");
    expect(wmsTileUrl({ ...base, version: "1.1.1" })).not.toContain("crs=");
  });

  it("leaves the bounding box placeholder for the renderer to fill", () => {
    expect(wmsTileUrl(base).endsWith("&bbox={bbox-epsg-3857}")).toBe(true);
  });

  it("escapes layer names with a colon in them", () => {
    expect(wmsTileUrl(base)).toContain("layers=alidade%3Alandcover");
  });

  it("drops a query string the server already put on its own URL", () => {
    const url = wmsTileUrl({ ...base, url: `${base.url}?service=WMS&request=GetCapabilities` });
    expect(url.match(/\?/g)).toHaveLength(1);
  });

  it("asks for transparent PNG tiles by default", () => {
    const url = wmsTileUrl(base);
    expect(url).toContain("format=image%2Fpng");
    expect(url).toContain("transparent=true");
  });

  it("builds a source the compiler can take as it is", () => {
    const source = wmsSource({ ...base, attribution: "Example" });
    expect(source).toMatchObject({ type: "raster", tileSize: 256, attribution: "Example" });
    expect(source.tiles).toHaveLength(1);
  });

  it("uses i and j for feature info in 1.3.0 and x and y before that", () => {
    const args = { ...base, x: 128, y: 64, bbox: [1, 2, 3, 4] as [number, number, number, number] };
    expect(wmsFeatureInfoUrl(args)).toContain("i=128");
    expect(wmsFeatureInfoUrl({ ...args, version: "1.1.1" })).toContain("x=128");
  });
});
