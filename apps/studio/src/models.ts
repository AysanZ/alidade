import type { LoadedInfo } from "@alidade/three";

/**
 * Models the studio knows about before the user has brought any.
 *
 * Most of these are built by the application rather than downloaded. The
 * catalogue used to be somebody's renderer test assets — a fox, and a lorry
 * with the vendor's logo down the side — which prove that a glTF loader works
 * and are the wrong objects for a map: placing forty of them puts forty copies
 * of another company's branding on your data, and none of them is a thing
 * anybody surveys.
 *
 * The built-ins are made from primitives at their real size in metres, so a
 * turbine is eighty metres to the hub because that is what a turbine is, and a
 * scale of 1 is already right. Nothing is fetched, so nothing here can go stale
 * or be rate-limited, and there is no texture carrying anyone's mark.
 *
 * Two downloads are kept, because a built-in cube cannot prove that the loader,
 * the Draco decoder and the physically based materials work on a real file.
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
    id: "turbine",
    name: "Wind turbine",
    url: "builtin:turbine",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "120 m to the blade tip. The one to place over a point layer.",
  },
  {
    id: "block",
    name: "Massing block",
    url: "builtin:block",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "10 × 10 × 20 m. A proposal that has a height and no design yet.",
  },
  {
    id: "mast",
    name: "Lattice mast",
    url: "builtin:mast",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "40 m with a dish. For a telecoms or sensor site.",
  },
  {
    id: "marker",
    name: "Survey marker",
    url: "builtin:marker",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "3.5 m. Visible from a distance and obviously not a building.",
  },
  {
    id: "tree",
    name: "Street tree",
    url: "builtin:tree",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "8 m. Mostly here for the shadow it throws.",
  },
  {
    id: "cone",
    name: "Traffic cone",
    url: "builtin:cone",
    size: "built in",
    attribution: "Alidade · Apache-2.0",
    hint: "0.7 m. The one that shows whether your scale is honest.",
  },
  {
    id: "person",
    name: "Person",
    url: `${KHRONOS}/CesiumMan/glTF-Binary/CesiumMan.glb`,
    size: "500 KB",
    attribution: "Cesium · CC BY 4.0",
    hint: "About 1.8 m. The reference every other height is read against.",
  },
  {
    id: "lantern",
    name: "Street lantern",
    url: `${KHRONOS}/Lantern/glTF-Binary/Lantern.glb`,
    size: "9.6 MB",
    attribution: "Microsoft · CC0",
    hint: "A real file with physically based materials, to check the sun against.",
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
