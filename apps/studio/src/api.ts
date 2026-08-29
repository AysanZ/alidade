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
