import type { MapProject, Slot, TreeNode } from "@alidade/core";

import { withNode } from "../tree";

const SLOTS: { id: Slot; label: string }[] = [
  { id: "overlay", label: "Overlay" },
  { id: "labels", label: "Labels" },
  { id: "data", label: "Data" },
  { id: "base", label: "Base" },
];

interface Props {
  project: MapProject;
  selected: string | null;
  onSelect: (id: string) => void;
  edit: (change: (draft: MapProject) => MapProject) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
}

/** The table of contents, grouped by slot so the ordering rule is visible. */
export function LayerTree({ project, selected, onSelect, edit, onMenu }: Props) {
  const slotOf = (node: TreeNode): Slot =>
    node.type === "layer" ? node.slot : (slotOf(node.children[0]!) ?? "data");

  return (
    <div className="tree">
      {SLOTS.map((slot) => {
        const nodes = project.tree.filter((n) => slotOf(n) === slot.id);
        if (nodes.length === 0) return null;
        return (
          <div key={slot.id}>
            <div className="slot">
              <span>{slot.label}</span>
              <i />
            </div>
            {nodes.map((node) => (
              <Node
                key={node.id}
                node={node}
                depth={0}
                selected={selected}
                onSelect={onSelect}
                edit={edit}
                onMenu={onMenu}
              />
            ))}
          </div>
        );
      })}

      <div className="slot">
        <span>Base</span>
        <i />
      </div>
      <div className="node system">
        <span className="swatch" style={{ background: project.basemap.background }} />
        <span className="name">Basemap · {project.basemap.name}</span>
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  selected,
  onSelect,
  edit,
  onMenu,
}: {
  node: TreeNode;
  depth: number;
} & Omit<Props, "project">) {
  const toggle = () =>
    edit((draft) =>
      withNode(draft, node.id, (n) => {
        n.visible = !n.visible;
      }),
    );

  return (
    <>
      <div
        className={`node${node.id === selected ? " on" : ""}${node.visible ? "" : " off"}`}
        style={{ paddingInlineStart: 8 + depth * 13 }}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(node.id);
          onMenu(node.id, { x: e.clientX, y: e.clientY });
        }}
      >
        <button
          className="eye"
          aria-label={node.visible ? "Hide" : "Show"}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {node.visible ? "◉" : "○"}
        </button>
        {node.type === "group" ? (
          <span className="swatch folder" />
        ) : (
          <span className="swatch" style={{ background: swatch(node) }} />
        )}
        <span className="name">{node.name}</span>
        {node.type === "layer" && node.filter && <span className="tag">filtered</span>}
        <button
          className="more"
          aria-label="Layer actions"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(node.id);
            const box = (e.target as HTMLElement).getBoundingClientRect();
            onMenu(node.id, { x: box.right + 4, y: box.top });
          }}
        >
          ⋯
        </button>
      </div>
      {node.type === "group" &&
        node.children.map((child) => (
          <Node
            key={child.id}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            edit={edit}
            onMenu={onMenu}
          />
        ))}
    </>
  );
}

function swatch(node: Extract<TreeNode, { type: "layer" }>): string {
  const s = node.symbology;
  if (s.kind === "graduated") return `linear-gradient(90deg, ${s.colors.join(", ")})`;
  if (s.kind === "categorized") return s.categories[0]?.color ?? s.fallbackColor;
  return s.color;
}
