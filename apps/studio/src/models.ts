import type { LoadedInfo } from "@alidade/three";

/**
 * Models the studio knows about before the user has brought any.
 *
 * The same rule as the basemaps: nothing here needs a key or an account, and
 * every file is openly licensed with its attribution carried on the placement.
 * They are the Khronos sample assets, served from the repository they live in,
 * chosen for being small, well made and different from each other: a vehicle,
 * an animal, a piece of street furniture and a cube for checking scale.
 */
const KHRONOS = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models";

export interface Sample {
  id: string;
  name: string;
  url: string;
  /** Shown before the download, so a nine megabyte file is not a surprise. */
  size: string;
  attribution: string;
  hint: string;
  /**
   * The file's own units are not always metres, whatever the specification
   * says. A starting scale that makes the thing life-sized, when it is known.
   */
  scale?: number;
}

export const SAMPLES: Sample[] = [
  {
    id: "truck",
    name: "Milk truck",
    url: `${KHRONOS}/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb`,
    size: "370 KB",
    attribution: "Cesium · CC BY 4.0",
    hint: "A lorry, a few metres long. Faces along its own +z.",
  },
  {
    id: "fox",
    name: "Fox",
    url: `${KHRONOS}/Fox/glTF-Binary/Fox.glb`,
    size: "160 KB",
    attribution: "PixelMannen, tomkranis, AsoboStudio · CC0, CC BY 4.0",
    hint: "Modelled in centimetres, so it starts at a hundredth.",
    scale: 0.01,
  },
  {
    id: "lantern",
    name: "Lantern",
    url: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`,
    size: "9.6 MB",
    attribution: "Microsoft · CC0",
    hint: "Street furniture with physically based materials.",
  },
  {
    id: "cube",
    name: "Calibration cube",
    url: `${KHRONOS}/BoxTextured/glTF-Binary/BoxTextured.glb`,
    size: "6 KB",
    attribution: "Cesium · CC BY 4.0",
    hint: "One metre a side. For checking that a scale is right.",
  },
];

/* ---------------------------------------------------------------- status */

/**
 * What the application knows about a placement's file. Absent means the file
 * is still on its way, which is the state every placement starts in.
 */
export type ModelStatus =
  | { state: "ready"; info: LoadedInfo }
  | { state: "failed"; reason: string };

/** A file's height in metres at a scale, for the panel to say out loud. */
export function heightOf(info: LoadedInfo, scale: number): number {
  return info.size[1] * scale;
}

/** Metres, to as many places as are worth saying. */
export function metres(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(2)} km`;
  if (abs >= 10) return `${n.toFixed(1)} m`;
  if (abs >= 0.1) return `${n.toFixed(2)} m`;
  return `${(n * 100).toFixed(1)} cm`;
}

/* ---------------------------------------------------------------- upload */

export interface StoredModel {
  id: string;
  name: string;
  url: string;
  bytes: number;
}

/**
 * Put a file on the server so it has a URL the project can keep.
 *
 * The alternative is an object URL, which is a name for a blob in this tab's
 * memory: it works until the page is refreshed, and a project saved with one
 * in it reopens with a model that cannot be found. The server is what makes a
 * placement durable, and the studio falls back to the tab only when it has to.
 */
export async function uploadModel(file: File): Promise<StoredModel> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/models", { method: "POST", body });
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error(
        "The API does not have the models endpoint. Rebuild it: docker compose -f deploy/docker-compose.yml up -d --build api",
      );
    }
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(detail?.detail ?? `The server answered ${response.status}.`);
  }
  return (await response.json()) as StoredModel;
}
