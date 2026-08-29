import type { MapProject } from "@alidade/core";

export interface LayerAction {
  id: string;
  label: string;
  danger?: boolean;
}

/**
 * What can be done to a layer. Rendered where the user clicked, because a table of
 * contents without a context menu is a list, not a table of contents.
 */
export const ACTIONS: LayerAction[] = [
  { id: "zoom", label: "Zoom to layer" },
  { id: "attributes", label: "Open attribute table" },
  { id: "up", label: "Move up" },
  { id: "down", label: "Move down" },
  { id: "duplicate", label: "Duplicate" },
  { id: "rename", label: "Rename…" },
  { id: "remove", label: "Remove", danger: true },
];

export function LayerMenu({
  at,
  onPick,
  onClose,
}: {
  at: { x: number; y: number };
  onPick: (action: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="menuscrim" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <menu className="layermenu" style={{ top: at.y, left: at.x }}>
        {ACTIONS.map((action) => (
          <li key={action.id}>
            <button
              className={action.danger ? "danger" : ""}
              onClick={() => {
                onPick(action.id);
                onClose();
              }}
            >
              {action.label}
            </button>
          </li>
        ))}
      </menu>
    </>
  );
}

/** Moving a layer inside its own slot. Across slots is a phase 4 problem. */
export function moveWithinSlot(draft: MapProject, id: string, delta: number): MapProject {
  const move = (nodes: MapProject["tree"]): boolean => {
    const index = nodes.findIndex((n) => n.id === id);
    if (index !== -1) {
      const target = index + delta;
      if (target < 0 || target >= nodes.length) return true;
      const [node] = nodes.splice(index, 1);
      nodes.splice(target, 0, node!);
      return true;
    }
    return nodes.some((n) => n.type === "group" && move(n.children));
  };
  move(draft.tree);
  return draft;
}
