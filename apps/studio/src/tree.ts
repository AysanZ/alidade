import type { LayerNode, MapProject, TreeNode } from "@alidade/core";
import { bundleFor } from "@alidade/core";

/** Depth first walk over the layer tree, groups included. */
export function walk(nodes: TreeNode[], visit: (node: TreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "group") walk(node.children, visit);
  }
}

export function findLayer(project: MapProject, id: string): LayerNode | undefined {
  let found: LayerNode | undefined;
  walk(project.tree, (n) => {
    if (n.type === "layer" && n.id === id) found = n;
  });
  return found;
}

/** Edits one node in place inside a draft the caller already owns. */
export function withNode(
  draft: MapProject,
  id: string,
  change: (node: TreeNode) => void,
): MapProject {
  walk(draft.tree, (n) => {
    if (n.id === id) change(n);
  });
  return draft;
}

/** Drop a node from the tree, and any source nothing reads any more. */
export function removeNode(draft: MapProject, id: string): MapProject {
  const prune = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .filter((n) => n.id !== id)
      .map((n) => (n.type === "group" ? { ...n, children: prune(n.children) } : n));

  draft.tree = prune(draft.tree);

  const used = new Set<string>();
  walk(draft.tree, (n) => {
    if (n.type === "layer") used.add(n.source);
  });
  /*
   * The elevation source belongs to the environment, not to any one layer, and
   * both terrain and hillshade read it. Only terrain was spared here, so removing
   * the last layer while hillshade was on pulled the source out from under a
   * layer that was still drawing from it.
   */
  if (draft.environment.terrain) used.add(draft.environment.terrain.source);
  if (draft.environment.hillshade) used.add(draft.environment.hillshade.source);

  for (const source of Object.keys(draft.sources)) {
    if (!used.has(source) && !source.startsWith("basemap:") && !source.startsWith("chrome:")) {
      delete draft.sources[source];
    }
  }
  return draft;
}

/**
 * A name nothing else in the project is using.
 *
 * Importing the same file twice produced the same slug twice, so the tree held
 * two nodes with one id. They compiled to two engine layers with one id, which a
 * renderer will not add and the reconciler cannot tell apart: the layer appeared
 * in the table of contents and nothing was drawn.
 */
export function uniqueId(project: MapProject, wanted: string): string {
  const taken = new Set<string>(Object.keys(project.sources));
  walk(project.tree, (n) => taken.add(n.id));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Copy a layer, its source reference included, and put it above the original. */
export function duplicateNode(draft: MapProject, id: string): MapProject {
  const copy = (nodes: TreeNode[]): boolean => {
    const index = nodes.findIndex((n) => n.id === id);
    if (index !== -1) {
      const original = nodes[index]!;
      const clone = JSON.parse(JSON.stringify(original)) as TreeNode;
      clone.id = `${original.id}_copy_${Math.random().toString(36).slice(2, 6)}`;
      clone.name = `${original.name} copy`;
      nodes.splice(index, 0, clone);
      return true;
    }
    return nodes.some((n) => n.type === "group" && copy(n.children));
  };
  copy(draft.tree);
  return draft;
}


/** Every layer in the tree, in table of contents order. */
export function allLayers(project: MapProject): LayerNode[] {
  const out: LayerNode[] = [];
  walk(project.tree, (n) => {
    if (n.type === "layer") out.push(n);
  });
  return out;
}

/** The engine layer ids one logical layer expands into. */
export function bundleIdsOf(layer: LayerNode): string[] {
  return bundleFor(layer);
}
