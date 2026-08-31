import { annotationsGeoJSON, describe, measurementOf, newAnnotation } from "./annotate";
import { ringPerimeter } from "./measure";
import type { Annotation, AnnotationKind, Annotations, DistanceUnits } from "./types/project";

export type ExchangeFormat = "geojson" | "kml" | "gpx" | "csv" | "wkt";

export interface Written {
  text: string;
  filename: string;
  mime: string;
}

/**
 * Drawings out, in whatever the next tool along wants to read.
 *
 * Everything is written in WGS 84 lon/lat, which is the only thing every one of
 * these formats agrees on.
 */
export function write(
  annotations: Annotations | undefined,
  format: ExchangeFormat,
  name = "drawings",
  units: DistanceUnits = "metric",
): Written {
  const features = annotations?.features ?? [];
  switch (format) {
    case "geojson":
      return {
        text: JSON.stringify(annotationsGeoJSON(annotations, units), null, 2),
        filename: `${name}.geojson`,
        mime: "application/geo+json",
      };
    case "kml":
      return { text: toKml(features, name, units), filename: `${name}.kml`, mime: "application/vnd.google-earth.kml+xml" };
    case "gpx":
      return { text: toGpx(features, name), filename: `${name}.gpx`, mime: "application/gpx+xml" };
    case "csv":
      return { text: toCsv(features, units), filename: `${name}.csv`, mime: "text/csv" };
    case "wkt":
      return { text: toWkt(features), filename: `${name}.wkt`, mime: "text/plain" };
  }
}

/* ---------------------------------------------------------------- writers */

function toKml(features: Annotation[], name: string, units: DistanceUnits): string {
  const placemarks = features
    .map((a) => {
      const coordinates = a.coordinates.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
      const body =
        a.kind === "point"
          ? `<Point><coordinates>${coordinates}</coordinates></Point>`
          : a.kind === "line"
            ? `<LineString><coordinates>${coordinates}</coordinates></LineString>`
            : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates} ${
                a.coordinates[0] ? `${a.coordinates[0][0]},${a.coordinates[0][1]},0` : ""
              }</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
      return [
        "    <Placemark>",
        `      <name>${escapeXml(a.name)}</name>`,
        `      <description>${escapeXml(describe(a, units))}</description>`,
        `      <Style><LineStyle><color>${kmlColor(a.color)}</color><width>2</width></LineStyle>`,
        `      <PolyStyle><color>${kmlColor(a.color, 0.35)}</color></PolyStyle></Style>`,
        `      ${body}`,
        "    </Placemark>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "  <Document>",
    `    <name>${escapeXml(name)}</name>`,
    placemarks,
    "  </Document>",
    "</kml>",
  ].join("\n");
}

function toGpx(features: Annotation[], name: string): string {
  const waypoints = features
    .filter((a) => a.kind === "point")
    .map((a) => {
      const [lon, lat] = a.coordinates[0] ?? [0, 0];
      return `  <wpt lat="${lat}" lon="${lon}"><name>${escapeXml(a.name)}</name></wpt>`;
    });

  const tracks = features
    .filter((a) => a.kind !== "point")
    .map((a) => {
      const points = a.coordinates
        .map(([lon, lat]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
        .join("\n");
      return `  <trk><name>${escapeXml(a.name)}</name><trkseg>\n${points}\n    </trkseg></trk>`;
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Alidade" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapeXml(name)}</name></metadata>`,
    ...waypoints,
    ...tracks,
    "</gpx>",
  ].join("\n");
}

/**
 * One row per drawing, with the geometry as WKT.
 *
 * A CSV of points only would lose every line and area the user drew, so the
 * geometry column carries whatever the shape actually is and a spreadsheet still
 * gets the name, the measurement and a representative position.
 */
function toCsv(features: Annotation[], units: DistanceUnits): string {
  const rows = [["name", "kind", "longitude", "latitude", "measurement", "value", "note", "wkt"]];
  for (const a of features) {
    const [lon, lat] = a.coordinates[0] ?? [0, 0];
    const value = measurementOf(a);
    rows.push([
      a.name,
      a.kind,
      String(lon),
      String(lat),
      describe(a, units),
      value === undefined ? "" : String(Math.round(value)),
      a.note ?? "",
      wktOf(a),
    ]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function toWkt(features: Annotation[]): string {
  return features.map(wktOf).join("\n");
}

function wktOf(a: Annotation): string {
  const pair = ([lon, lat]: [number, number]) => `${lon} ${lat}`;
  if (a.kind === "point") return `POINT (${pair(a.coordinates[0] ?? [0, 0])})`;
  if (a.kind === "line") return `LINESTRING (${a.coordinates.map(pair).join(", ")})`;
  const ring = [...a.coordinates, a.coordinates[0]!].filter(Boolean);
  return `POLYGON ((${ring.map(pair).join(", ")}))`;
}

/* ---------------------------------------------------------------- readers */

/**
 * Read drawings back in.
 *
 * The format is worked out from the text rather than the file extension, because
 * a file named `.txt` full of GeoJSON is still GeoJSON and refusing it helps
 * nobody.
 */
export function read(text: string, name = "Imported"): Annotation[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return fromGeoJSON(trimmed, name);
  if (/<kml[\s>]/i.test(trimmed)) return fromKml(trimmed);
  if (/<gpx[\s>]/i.test(trimmed)) return fromGpx(trimmed);
  if (/^\s*(POINT|LINESTRING|POLYGON)/im.test(trimmed)) return fromWkt(trimmed, name);
  return fromCsv(trimmed, name);
}

export function detectFormat(text: string): ExchangeFormat | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "geojson";
  if (/<kml[\s>]/i.test(trimmed)) return "kml";
  if (/<gpx[\s>]/i.test(trimmed)) return "gpx";
  if (/^\s*(POINT|LINESTRING|POLYGON)/im.test(trimmed)) return "wkt";
  if (trimmed.includes(",")) return "csv";
  return null;
}

function fromGeoJSON(text: string, fallbackName: string): Annotation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const collection = parsed as { type?: string; features?: unknown[]; geometry?: unknown };
  const list = Array.isArray(collection.features)
    ? collection.features
    : collection.geometry
      ? [collection]
      : Array.isArray(parsed)
        ? (parsed as unknown[])
        : [];

  const out: Annotation[] = [];
  for (const raw of list) {
    const feature = raw as {
      properties?: Record<string, unknown>;
      geometry?: { type?: string; coordinates?: unknown };
    };
    const geometry = feature.geometry;
    if (!geometry?.type) continue;
    const properties = feature.properties ?? {};

    for (const shape of explode(geometry.type, geometry.coordinates)) {
      const annotation = newAnnotation(shape.kind, String(properties["color"] ?? "#ffb454"));
      annotation.name = String(properties["name"] ?? properties["title"] ?? fallbackName);
      annotation.coordinates = shape.coordinates;
      if (properties["note"]) annotation.note = String(properties["note"]);
      out.push(annotation);
    }
  }
  return out;
}

/** One GeoJSON geometry can be several drawings; multi-parts are split. */
function explode(
  type: string,
  coordinates: unknown,
): { kind: AnnotationKind; coordinates: [number, number][] }[] {
  const positions = coordinates as never;
  switch (type) {
    case "Point":
      return [{ kind: "point", coordinates: [positions as unknown as [number, number]] }];
    case "MultiPoint":
      return (positions as unknown as [number, number][]).map((p) => ({
        kind: "point" as const,
        coordinates: [p],
      }));
    case "LineString":
      return [{ kind: "line", coordinates: positions as unknown as [number, number][] }];
    case "MultiLineString":
      return (positions as unknown as [number, number][][]).map((line) => ({
        kind: "line" as const,
        coordinates: line,
      }));
    case "Polygon":
      return [{ kind: "polygon", coordinates: openRing((positions as unknown as [number, number][][])[0] ?? []) }];
    case "MultiPolygon":
      return (positions as unknown as [number, number][][][]).map((polygon) => ({
        kind: "polygon" as const,
        coordinates: openRing(polygon[0] ?? []),
      }));
    case "GeometryCollection":
      return [];
    default:
      return [];
  }
}

function openRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

function fromKml(text: string): Annotation[] {
  const out: Annotation[] = [];
  const placemarks = text.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? [];
  for (const placemark of placemarks) {
    const name = placemark.match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? "Placemark";
    const kind: AnnotationKind = /<Polygon/i.test(placemark)
      ? "polygon"
      : /<LineString/i.test(placemark)
        ? "line"
        : "point";
    const raw = placemark.match(/<coordinates>([\s\S]*?)<\/coordinates>/i)?.[1] ?? "";
    const coordinates = parseKmlCoordinates(raw);
    if (coordinates.length === 0) continue;
    const annotation = newAnnotation(kind);
    annotation.name = name;
    annotation.coordinates = kind === "polygon" ? openRing(coordinates) : coordinates;
    out.push(annotation);
  }
  return out;
}

function parseKmlCoordinates(raw: string): [number, number][] {
  return raw
    .trim()
    .split(/\s+/)
    .map((triple) => triple.split(",").map(Number))
    .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
    .map((parts) => [parts[0]!, parts[1]!] as [number, number]);
}

function fromGpx(text: string): Annotation[] {
  const out: Annotation[] = [];
  for (const match of text.matchAll(/<wpt[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/wpt>/gi)) {
    const annotation = newAnnotation("point");
    annotation.name = match[3]?.match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? "Waypoint";
    annotation.coordinates = [[Number(match[2]), Number(match[1])]];
    out.push(annotation);
  }
  for (const track of text.match(/<trk>[\s\S]*?<\/trk>/gi) ?? []) {
    const coordinates: [number, number][] = [];
    for (const point of track.matchAll(/lat="([^"]+)"[^>]*lon="([^"]+)"/gi)) {
      coordinates.push([Number(point[2]), Number(point[1])]);
    }
    if (coordinates.length < 2) continue;
    const annotation = newAnnotation("line");
    annotation.name = track.match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.trim() ?? "Track";
    annotation.coordinates = coordinates;
    out.push(annotation);
  }
  return out;
}

function fromWkt(text: string, fallbackName: string): Annotation[] {
  const out: Annotation[] = [];
  for (const line of text.split(/\r?\n/)) {
    const annotation = parseWkt(line.trim(), fallbackName);
    if (annotation) out.push(annotation);
  }
  return out;
}

export function parseWkt(text: string, name = "Geometry"): Annotation | null {
  const match = text.match(/^\s*(POINT|LINESTRING|POLYGON)\s*(Z|M|ZM)?\s*\(([\s\S]*)\)\s*$/i);
  if (!match) return null;
  const type = match[1]!.toUpperCase();
  const body = match[3]!;

  const positions = (chunk: string): [number, number][] =>
    chunk
      .split(",")
      .map((pair) => pair.trim().split(/\s+/).map(Number))
      .filter((parts) => parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]))
      .map((parts) => [parts[0]!, parts[1]!] as [number, number]);

  if (type === "POINT") {
    const points = positions(body);
    if (points.length === 0) return null;
    const annotation = newAnnotation("point");
    annotation.name = name;
    annotation.coordinates = points;
    return annotation;
  }
  if (type === "LINESTRING") {
    const points = positions(body);
    if (points.length < 2) return null;
    const annotation = newAnnotation("line");
    annotation.name = name;
    annotation.coordinates = points;
    return annotation;
  }
  const ring = positions(body.replace(/^\s*\(/, "").replace(/\)\s*$/, "").split(/\)\s*,\s*\(/)[0] ?? "");
  if (ring.length < 3) return null;
  const annotation = newAnnotation("polygon");
  annotation.name = name;
  annotation.coordinates = openRing(ring);
  return annotation;
}

/**
 * A table of points, or a table with a WKT column.
 *
 * Column names are matched loosely, because every source spells latitude
 * differently and asking the user to rename headers before importing is a way of
 * telling them to go and use something else.
 */
function fromCsv(text: string, fallbackName: string): Annotation[] {
  const rows = text.split(/\r?\n/).filter((line) => line.trim());
  if (rows.length < 2) return [];
  const header = splitCsvRow(rows[0]!).map((cell) => cell.trim().toLowerCase());

  const find = (...candidates: string[]) =>
    header.findIndex((cell) => candidates.some((c) => cell === c || cell.includes(c)));

  const latAt = find("latitude", "lat", "y");
  const lonAt = find("longitude", "lon", "lng", "x");
  const nameAt = find("name", "title", "label");
  const wktAt = find("wkt", "geometry", "geom");

  const out: Annotation[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = splitCsvRow(rows[i]!);
    const name = nameAt >= 0 ? (cells[nameAt] ?? fallbackName) : `${fallbackName} ${i}`;

    if (wktAt >= 0 && cells[wktAt]) {
      const annotation = parseWkt(cells[wktAt]!, name);
      if (annotation) {
        out.push(annotation);
        continue;
      }
    }
    if (latAt < 0 || lonAt < 0) continue;
    const lat = Number(cells[latAt]);
    const lon = Number(cells[lonAt]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const annotation = newAnnotation("point");
    annotation.name = name;
    annotation.coordinates = [[lon, lat]];
    out.push(annotation);
  }
  return out;
}

/** Quoted cells may hold commas, which is the whole reason CSV is annoying. */
function splitCsvRow(row: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const character = row[i]!;
    if (quoted) {
      if (character === '"' && row[i + 1] === '"') {
        current += '"';
        i++;
      } else if (character === '"') quoted = false;
      else current += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** KML colours are aabbggrr, which is nobody's idea of a good time. */
function kmlColor(hex: string, alpha = 1): string {
  const value = hex.replace("#", "");
  const r = value.slice(0, 2) || "ff";
  const g = value.slice(2, 4) || "ff";
  const b = value.slice(4, 6) || "ff";
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${a}${b}${g}${r}`;
}

/** Everything the report needs about one drawing, for a summary table. */
export function summarise(a: Annotation, units: DistanceUnits = "metric") {
  return {
    name: a.name,
    kind: a.kind,
    measurement: describe(a, units),
    perimeter: a.kind === "polygon" ? ringPerimeter(a.coordinates) : undefined,
    vertices: a.coordinates.length,
  };
}
