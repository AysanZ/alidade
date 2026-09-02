import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { WmsCapabilities } from "@alidade/core";

import {
  addFromUrl,
  listLayers,
  readCapabilities,
  readFeatures,
  readLayer,
  readStats,
  uploadFile,
  type FeaturePage,
  type FeatureQuery,
  type FieldStats,
  type RegisteredLayer,
} from "./api";

/**
 * Everything the studio knows about the server, in one place.
 *
 * The document — the tree, the symbology, the camera — is not in here and must
 * not be. That is client state: it is authored in the browser, the reconciler
 * diffs it, and there is no server copy to be stale against. Caching it would
 * mean two owners for one truth.
 *
 * What *is* here is genuinely server state: which layers exist, what is in them,
 * what a column contains. It goes stale on its own, several components want the
 * same answer, and the requests race. That is the whole case for a query layer,
 * and it is the only case.
 */

/**
 * Query keys, built rather than written out.
 *
 * A key typed by hand at each call site is a cache miss waiting to happen — one
 * `["layers"]` and one `["layer"]` are two caches for one thing, and an
 * invalidation that names the wrong one silently does nothing. Every key in the
 * application comes from here, so `invalidate(keys.layers.all)` provably reaches
 * everything under it.
 */
export const keys = {
  layers: {
    all: ["layers"] as const,
    list: () => [...keys.layers.all, "list"] as const,
    detail: (id: string) => [...keys.layers.all, "detail", id] as const,
    features: (id: string, query: FeatureQuery) =>
      [...keys.layers.all, "features", id, query] as const,
    stats: (id: string, field: string) => [...keys.layers.all, "stats", id, field] as const,
  },
  wms: {
    all: ["wms"] as const,
    capabilities: (url: string) => [...keys.wms.all, "capabilities", url] as const,
  },
} as const;

/** What is registered in the database. */
export function useLayers(): UseQueryResult<RegisteredLayer[]> {
  return useQuery({
    queryKey: keys.layers.list(),
    queryFn: ({ signal }) => listLayers({ signal }),
  });
}

/**
 * One page of a layer's attribute table.
 *
 * `placeholderData: keepPreviousData` is doing real work: without it, changing
 * the sort or the page empties the table for as long as the request takes, so a
 * click on a column header makes the rows vanish and come back. With it, the old
 * page stays under an `isFetching` flag and the columns do not jump.
 */
export function useFeatures(
  layerId: string,
  query: FeatureQuery,
): UseQueryResult<FeaturePage> {
  return useQuery({
    queryKey: keys.layers.features(layerId, query),
    queryFn: ({ signal }) => readFeatures(layerId, { ...query, signal }),
    placeholderData: keepPreviousData,
  });
}

/**
 * The range and the distinct values of one column.
 *
 * Long-lived on purpose. This is a scan of the table: it does not change while
 * somebody drags a colour ramp around, and re-reading it every time a panel
 * remounts is a full-table query to answer a question already answered.
 */
export function useFieldStats(
  layerId: string | null,
  field: string | null,
): UseQueryResult<FieldStats> {
  return useQuery({
    queryKey: keys.layers.stats(layerId ?? "", field ?? ""),
    queryFn: ({ signal }) => readStats(layerId!, field!, { signal }),
    enabled: Boolean(layerId && field),
    staleTime: 5 * 60 * 1000,
  });
}

/** What a WMS says it can serve. Only asked once the url has been submitted. */
export function useCapabilities(
  url: string | null,
): UseQueryResult<WmsCapabilities & { url: string }> {
  return useQuery({
    queryKey: keys.wms.capabilities(url ?? ""),
    queryFn: ({ signal }) => readCapabilities(url!, { signal }),
    enabled: Boolean(url),
    // A server that is not there is not going to be there in 400ms either, and
    // three silent retries turn a typo into a four second wait for an error.
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Bringing data in.
 *
 * Both routes end the same way — a new row in the registry — so both invalidate
 * the same key, and the catalogue is right without anyone remembering to refresh
 * it. That is the part a hand-rolled `load()` per component cannot do: the
 * import dialog does not know the catalogue exists.
 */
export function useImportLayer() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: keys.layers.all });

  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(file),
    onSuccess: invalidate,
  });

  const fromUrl = useMutation({
    mutationFn: ({ url, name }: { url: string; name?: string }) => addFromUrl(url, name),
    onSuccess: invalidate,
  });

  return { upload, fromUrl };
}

/**
 * A layer's full record, including the key column.
 *
 * Finding the key costs a query per candidate column, so the list endpoint does
 * not compute it and this is asked for late — after the layer is already drawn.
 * It is a plain function rather than a hook because the thing that needs it is
 * `place()`, which is an action and not a render.
 *
 * Going through `fetchQuery` rather than calling `readLayer` puts the answer in
 * the same cache everything else reads, so adding the same layer twice asks the
 * server once.
 */
export function fetchLayerDetail(
  client: QueryClient,
  id: string,
): Promise<RegisteredLayer> {
  return client.fetchQuery({
    queryKey: keys.layers.detail(id),
    queryFn: ({ signal }) => readLayer(id, { signal }),
    staleTime: 5 * 60 * 1000,
  });
}
