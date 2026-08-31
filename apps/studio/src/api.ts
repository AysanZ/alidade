import type { WmsCapabilities } from "@alidade/core";

export interface RegisteredLayer {
  id: string;
  title: string;
  table: string;
  geometryType: string | null;
  sourceCrs: string | null;
  featureCount: number | null;
  fields: string[];
  extent: { west: number; south: number; east: number; north: number } | null;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 405 || response.status === 404) {
      throw new Error(
        "The API does not have this endpoint. Rebuild it: docker compose -f deploy/docker-compose.yml up -d --build api",
      );
    }
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `The server answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export async function uploadFile(file: File): Promise<RegisteredLayer> {
  const body = new FormData();
  body.append("file", file);
  return json<RegisteredLayer>(await fetch("/api/layers/upload", { method: "POST", body }));
}

export async function addFromUrl(url: string, name?: string): Promise<RegisteredLayer> {
  return json<RegisteredLayer>(
    await fetch("/api/layers/from-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, name }),
    }),
  );
}

export type Cell = string | number | boolean | null;

export interface FeatureRow {
  values: Record<string, Cell>;
  /** Enough to aim the camera at the row. Null for a feature with no geometry. */
  bounds: { west: number; south: number; east: number; north: number } | null;
}

export interface FeaturePage {
  fields: string[];
  rows: FeatureRow[];
  total: number;
  /** The column to match on when highlighting a row on the map. */
  key: string | null;
}

export async function readFeatures(
  id: string,
  options: {
    limit?: number;
    offset?: number;
    order?: string;
    descending?: boolean;
    search?: string;
  } = {},
): Promise<FeaturePage> {
  const query = new URLSearchParams();
  if (options.limit) query.set("limit", String(options.limit));
  if (options.offset) query.set("offset", String(options.offset));
  if (options.order) query.set("order", options.order);
  if (options.descending) query.set("descending", "true");
  if (options.search) query.set("search", options.search);
  const body = await json<unknown>(await fetch(`/api/layers/${id}/features?${query}`));
  return normaliseFeaturePage(body);
}

/**
 * Make whatever the API sent look like a FeaturePage.
 *
 * A client and an API that disagree about a shape is a normal state of affairs —
 * the studio reloads on save and the container does not — and it should not be
 * fatal. It was: this endpoint used to return flat rows, the table started
 * reading `row.values[field]`, and against an API container that had not been
 * rebuilt every row was `undefined`, which threw inside a `map` during render
 * and took the whole application down to a black screen.
 */
export function normaliseFeaturePage(body: unknown): FeaturePage {
  const source = (body ?? {}) as Record<string, unknown>;
  const fields = Array.isArray(source["fields"]) ? (source["fields"] as string[]) : [];
  const rawRows = Array.isArray(source["rows"]) ? (source["rows"] as unknown[]) : [];

  const rows: FeatureRow[] = rawRows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    // The new shape nests the attributes; the old one was the attributes.
    const values =
      row["values"] && typeof row["values"] === "object"
        ? (row["values"] as Record<string, Cell>)
        : (row as Record<string, Cell>);
    const bounds = row["bounds"] as FeatureRow["bounds"] | undefined;
    return {
      values: values ?? {},
      bounds: bounds && Number.isFinite(bounds.west) ? bounds : null,
    };
  });

  return {
    fields,
    rows,
    total: typeof source["total"] === "number" ? (source["total"] as number) : rows.length,
    key: typeof source["key"] === "string" ? (source["key"] as string) : (fields[0] ?? null),
  };
}

export async function listLayers(): Promise<RegisteredLayer[]> {
  const { layers } = await json<{ layers: RegisteredLayer[] }>(await fetch("/api/layers"));
  return layers;
}

export async function readCapabilities(
  url: string,
): Promise<WmsCapabilities & { url: string }> {
  const query = new URLSearchParams({ url });
  return json<WmsCapabilities & { url: string }>(
    await fetch(`/api/services/wms/capabilities?${query}`),
  );
}
