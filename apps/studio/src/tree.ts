import type { LayerNode, MapProject, TreeNode } from "@alidade/core";

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
