/**
 * The imagery catalogue, from the studio's side.
 *
 * The registry answers with STAC Items, so this is mostly a translation into the
 * flat record the panels want plus the queries that keep it fresh. What is
 * deliberately *not* here is any copy of the catalogue in the project document:
 * the document holds the rule and the rendering, and the list of images is
 * whatever the server has when it is asked.
 */

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  defaultImagery,
  imagerySource,
  nativeZoom,
  type ImageRecord,
  type ImagerySettings,
  type MapProject,
} from "@alidade/core";

import type { Extent } from "./layers";
import { uniqueId } from "./tree";

/** The layer every image is drawn through. One row, however many files. */
export const IMAGERY_LAYER = "imagery";

interface StacItem {
  id: string;
  bbox: number[];
  geometry: { type: string; coordinates: number[][][] };
  properties: Record<string, unknown>;
}

/** A STAC Item as the panels want it. */
function fromItem(item: StacItem): ImageRecord {
  const p = item.properties;
  const num = (key: string): number | null => {
    const value = p[key];
    return typeof value === "number" ? value : null;
  };
  const str = (key: string): string | undefined => {
    const value = p[key];
    return typeof value === "string" ? value : undefined;
  };
  return {
    id: item.id,
    title: str("title") ?? item.id,
    file: str("alidade:file") ?? item.id,
    datetime: (p["datetime"] as string | null) ?? null,
    datetimeFrom: (p["alidade:datetime_from"] as ImageRecord["datetimeFrom"]) ?? null,
    gsd: num("gsd") ?? 1,
    epsg: num("proj:epsg"),
    cloudCover: num("eo:cloud_cover"),
    bands: num("alidade:bands") ?? 1,
    dtype: str("alidade:dtype") ?? "Byte",
    bbox: item.bbox.slice(0, 4) as [number, number, number, number],
    footprint: (item.geometry?.coordinates?.[0] ?? []) as [number, number][],
    coverage: num("alidade:coverage") ?? undefined,
    sensor: str("alidade:sensor"),
    note: str("alidade:note"),
  };
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `The server answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function searchImagery(
  bbox: Extent | null,
  signal?: AbortSignal,
): Promise<ImageRecord[]> {
  const query = bbox
    ? `?bbox=${[bbox.west, bbox.south, bbox.east, bbox.north].join(",")}`
    : "";
  const found = await json<{ features: StacItem[] }>(
    await fetch(`/api/rasters/search${query}`, { signal }),
  );
  return found.features.map(fromItem);
}

export async function uploadImage(file: File): Promise<ImageRecord> {
  const body = new FormData();
  body.append("file", file);
  return fromItem(await json<StacItem>(await fetch("/api/rasters", { method: "POST", body })));
}

export interface ImageEdit {
  title?: string;
  captured_at?: string | null;
  sensor?: string | null;
  note?: string | null;
  cloud_cover?: number | null;
  clear_date?: boolean;
}

export async function editImage(id: string, changes: ImageEdit): Promise<ImageRecord> {
  return fromItem(
    await json<StacItem>(
      await fetch(`/api/rasters/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      }),
    ),
  );
}

export async function removeImage(id: string): Promise<void> {
  await json(await fetch(`/api/rasters/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/**
 * The images covering a view.
 *
 * Keyed on the box rounded to three decimals — about a hundred metres — so that
 * a slow pan is a handful of requests rather than one per frame, and
 * `keepPreviousData` so the strip does not empty and refill while the map is
 * still moving.
 */
export function useImagery(bbox: Extent | null): UseQueryResult<ImageRecord[]> {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const key = bbox ? [round(bbox.west), round(bbox.south), round(bbox.east), round(bbox.north)] : null;
  return useQuery({
    queryKey: ["imagery", "search", key],
    queryFn: ({ signal }) => searchImagery(bbox, signal),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/* ---------------------------------------------------------------- the layer */

export const imageryLayerOf = (project: MapProject) =>
  project.tree.find((node) => node.type === "layer" && node.id === IMAGERY_LAYER);

/**
 * Put the imagery layer on the map, or leave it where it is.
 *
 * One row in the table of contents however many files there are. A row per
 * image would be a table of contents nobody can reorder — the order is decided
 * by the mosaic rule, not by dragging — and a legend nobody can read.
 */
export function addImageryLayer(
  edit: (change: (draft: MapProject) => MapProject) => void,
  finest: number,
): string {
  edit((draft) => {
    if (imageryLayerOf(draft)) return draft;
    const id = uniqueId(draft, IMAGERY_LAYER);
    const settings: ImagerySettings = defaultImagery();
    draft.sources[id] = imagerySource(settings, { maxzoom: nativeZoom(finest) });
    draft.tree.unshift({
      type: "layer",
      id,
      name: "Imagery",
      slot: "data",
      source: id,
      geometry: "raster",
      visible: true,
      opacity: 1,
      symbology: { kind: "single", color: "#ffffff" },
      imagery: settings,
    });
    return draft;
  });
  return IMAGERY_LAYER;
}

/** Change the settings of the imagery layer, leaving everything else alone. */
export function editImagery(
  edit: (change: (draft: MapProject) => MapProject) => void,
  change: (settings: ImagerySettings) => ImagerySettings,
): void {
  edit((draft) => {
    const layer = draft.tree.find(
      (node) => node.type === "layer" && node.imagery !== undefined,
    );
    if (layer && layer.type === "layer" && layer.imagery) {
      layer.imagery = change(layer.imagery);
    }
    return draft;
  });
}

/* ---------------------------------------------------------------- display */

/** Ground sample distance, in the unit a person would say it in. */
export const gsdLabel = (gsd: number): string =>
  gsd < 1 ? `${Math.round(gsd * 100)} cm` : `${Number(gsd.toFixed(1))} m`;

/** Just the date. The time an image was taken is rarely what anyone is reading for. */
export const dateLabel = (iso: string | null): string | null =>
  iso ? iso.slice(0, 10) : null;

/**
 * Where a date came from, said plainly.
 *
 * A date somebody typed must never be indistinguishable from one the file
 * stated, and a date read out of a filename is worth a second look: the pattern
 * that found it cannot tell an acquisition date from a processing date.
 */
export const provenance = (
  from: ImageRecord["datetimeFrom"],
): { label: string; tone: "good" | "mine" | "none"; note: string } => {
  switch (from) {
    case "tag":
      return { label: "TIFFTAG", tone: "good", note: "Read from the file's own metadata." };
    case "filename":
      return {
        label: "filename",
        tone: "good",
        note: "The file carried no date tag; this came from its name. Worth a glance.",
      };
    case "user":
      return {
        label: "yours",
        tone: "mine",
        note: "You set this. The file is untouched — what it said is kept beside what you said.",
      };
    default:
      return {
        label: "no date",
        tone: "none",
        note: "Neither the file nor its name gives a date. It is on the map either way, and sorts last.",
      };
  }
};

export type SortKey = "date" | "dateasc" | "coverage" | "gsd" | "title";

/**
 * The catalogue in the order the browser is showing it.
 *
 * Undated images sort last rather than being hidden. A panel whose heading says
 * nine images and whose list shows seven is a number nobody can reconcile with
 * what is on the screen, and the two that vanished are exactly the ones somebody
 * needs to go and fix.
 */
export function sortImages(images: ImageRecord[], key: SortKey): ImageRecord[] {
  const at = (image: ImageRecord) => (image.datetime ? Date.parse(image.datetime) : null);
  const list = images.slice();

  if (key === "title") return list.sort((a, b) => a.title.localeCompare(b.title));
  if (key === "gsd") return list.sort((a, b) => a.gsd - b.gsd);
  if (key === "coverage") return list.sort((a, b) => (b.coverage ?? 0) - (a.coverage ?? 0));

  const dated = list.filter((image) => at(image) !== null);
  const undated = list.filter((image) => at(image) === null);
  dated.sort((a, b) => (key === "dateasc" ? at(a)! - at(b)! : at(b)! - at(a)!));
  return [...dated, ...undated];
}
