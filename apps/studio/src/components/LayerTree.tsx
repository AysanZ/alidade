import { useState } from "react";
import type { LayerNode, MapProject, Slot, TreeNode } from "@alidade/core";
import { representativeColor } from "@alidade/core";

import type { Extent } from "../layers";
import { withNode } from "../tree";
import { Catalogue } from "./Catalogue";

const SLOTS: { id: Slot; label: string; hint: string }[] = [
  { id: "overlay", label: "Overlay", hint: "Always on top" },
  { id: "labels", label: "Labels", hint: "Above your data" },
  { id: "data", label: "Data", hint: "Your layers" },
  { id: "base", label: "Base", hint: "Under everything" },
];

interface Props {
  project: MapProject;
  selected: string | null;
  onSelect: (id: string) => void;
  edit: (change: (draft: MapProject) => MapProject) => void;
  onMenu: (id: string, at: { x: number; y: number }) => void;
  onAdd: () => void;
  onFlyTo: (extent: Extent) => void;
}

/**
 * The table of contents.
 *
 * Rebuilt because the first version was unreadable: eleven pixel rows, a swatch
 * the size of a full stop, an add button that was a bare `+` in a corner, and no
 * way to reorder except a context menu two clicks deep. A table of contents is
 * the control surface of a GIS, not a list of names.
 */
export function LayerTree({ project, selected, onSelect, edit, onMenu, onAdd, onFlyTo }: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const slotOf = (node: TreeNode): Slot => {
    if (node.type === "layer") return node.slot;
    for (const child of node.children) {
      const slot = slotOf(child);
      if (slot) return slot;
    }
    return "data";
  };

  if (project.tree.length === 0) {
    return (
      <div className="tree">
        <div className="empty">
          <b>No layers yet</b>
        </div>
        <Catalogue
          project={project}
          edit={edit}
          onAdded={onSelect}
          onFlyTo={onFlyTo}
          onImport={onAdd}
          compact
        />
      </div>
    );
  }

  /** Dropping one node on another puts it where that one was. */
  const drop = (target: string) => {
    if (!dragging || dragging === target) return;
    edit((draft) => reorder(draft, dragging, target));
    setDragging(null);
    setOver(null);
  };

  /*
   * Searching hides layers rather than flattening the tree, so a match inside a
   * group keeps the group it belongs to. A group whose name matches keeps all of
   * its children, because that is what asking for the group means.
   */
  const matches = (node: TreeNode): boolean => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    if (node.name.toLowerCase().includes(term)) return true;
    return node.type === "group" && node.children.some(matches);
  };

  return (
    <div className="tree">
      <div className="treesearch">
        <input
          type="text"
          value={search}
          placeholder="Search layers"
          aria-label="Search layers"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {SLOTS.map((slot) => {
        const nodes = project.tree.filter((n) => slotOf(n) === slot.id).filter(matches);
        if (nodes.length === 0) return null;
        return (
          <div key={slot.id}>
            <div className="slot" title={slot.hint}>
              <span className="cap">{slot.label}</span>
              <i />
              <span className="tag">{nodes.length}</span>
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
                dragging={dragging}
                over={over}
                setDragging={setDragging}
                setOver={setOver}
                onDrop={drop}
              />
            ))}
          </div>
        );
      })}

      <div className="slot">
        <span className="cap">Basemap</span>
        <i />
      </div>
      <div className="node system">
        <span className="swatch" style={{ background: project.basemap.background }} />
        <span className="name">{project.basemap.name}</span>
        <span className="tag">locked</span>
      </div>
    </div>
  );
}

interface NodeProps {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
  edit: Props["edit"];
  onMenu: Props["onMenu"];
  dragging: string | null;
  over: string | null;
  setDragging: (id: string | null) => void;
  setOver: (id: string | null) => void;
  onDrop: (target: string) => void;
}

function Node(props: NodeProps) {
  const { node, depth, selected, onSelect, edit, onMenu, dragging, over, setDragging, setOver, onDrop } =
    props;

  const toggle = () =>
    edit((draft) =>
      withNode(draft, node.id, (n) => {
        n.visible = !n.visible;
      }),
    );

  const classes = [
    "node",
    node.id === selected ? "on" : "",
    node.visible ? "" : "off",
    dragging === node.id ? "lifting" : "",
    over === node.id && dragging !== node.id ? "target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div
        className={classes}
        style={{ paddingInlineStart: 9 + depth * 14 }}
        draggable
        onDragStart={() => setDragging(node.id)}
        onDragEnd={() => {
          setDragging(null);
          setOver(null);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(node.id);
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(node.id);
        }}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onSelect(node.id);
          onMenu(node.id, { x: e.clientX, y: e.clientY });
        }}
      >
        <span className="grip" aria-hidden="true">
          ⠿
        </span>
        <button
          className="eye"
          aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {node.visible ? <EyeOpen /> : <EyeShut />}
        </button>

        {node.type === "group" ? (
          <span className="swatch folder" />
        ) : (
          <span className="swatch" style={{ background: swatch(node) }} />
        )}

        <span className="name" title={`${node.name} · ${describe(node)}`}>
          {node.name}
        </span>

        {/*
          What the two-line row used to spell out under the name. One row is 26px
          rather than 34, which is eight more layers on the screen; the detail
          that will not fit is on the row's own tooltip and in the inspector.
        */}
        <span className="tag">{badge(node)}</span>

        <button
          className="more"
          aria-label={`Actions for ${node.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(node.id);
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onMenu(node.id, { x: box.right + 4, y: box.top });
          }}
        >
          ⋯
        </button>
      </div>

      {node.type === "group" &&
        node.children.map((child) => <Node {...props} key={child.id} node={child} depth={depth + 1} />)}
    </>
  );
}

/**
 * The short tag at the end of the row.
 *
 * Space for about six characters, so it carries the one fact that changes what
 * you would do next: how many layers a group holds, that a layer is filtered or
 * classified, or failing that what shape it is.
 */
function badge(node: TreeNode): string {
  if (node.type === "group") return String(node.children.length);
  if (node.filter) return "filter";
  const s = node.symbology;
  if (s.kind === "graduated") return `${s.breaks.length + 1} cls`;
  if (s.kind === "categorized") return `${s.categories.length} cat`;
  if (s.kind === "extrusion") return "ext";
  if (node.opacity < 1) return `${Math.round(node.opacity * 100)}%`;
  return node.geometry === "polygon" ? "area" : node.geometry;
}

/** The full description, used as the row's tooltip and nowhere else. */
function describe(node: TreeNode): string {
  if (node.type === "group") return `${node.children.length} layers`;
  const parts: string[] = [node.geometry];
  const s = node.symbology;
  if (s.kind === "graduated") parts.push(`${s.breaks.length + 1} classes · ${s.field}`);
  else if (s.kind === "categorized") parts.push(`${s.categories.length} categories`);
  else if (s.kind === "extrusion") parts.push("extruded");
  if (node.filter) parts.push("filtered");
  if (node.opacity < 1) parts.push(`${Math.round(node.opacity * 100)}%`);
  return parts.join(" · ");
}

function swatch(node: LayerNode): string {
  const s = node.symbology;
  if (s.kind === "graduated") return `linear-gradient(90deg, ${s.colors.join(", ")})`;
  if (s.kind === "categorized" && s.categories.length > 1) {
    return `linear-gradient(90deg, ${s.categories.map((c) => c.color).join(", ")})`;
  }
  return representativeColor(s);
}

/**
 * Move one node to where another sits.
 *
 * Only within the same list: dragging a layer out of a group, or into one, is a
 * different gesture and pretending a plain drop does it would move layers to
 * places nobody asked for.
 */
export function reorder(draft: MapProject, moving: string, target: string): MapProject {
  const walk = (nodes: TreeNode[]): boolean => {
    const from = nodes.findIndex((n) => n.id === moving);
    const to = nodes.findIndex((n) => n.id === target);
    if (from !== -1 && to !== -1) {
      const [node] = nodes.splice(from, 1);
      nodes.splice(to, 0, node!);
      return true;
    }
    return nodes.some((n) => n.type === "group" && walk(n.children));
  };
  walk(draft.tree);
  return draft;
}

const EyeOpen = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </svg>
);

const EyeShut = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3.5 8.5C5.6 12.9 8.6 15 12 15s6.4-2.1 8.5-6.5" />
    <path d="M12 15v3.5M6 13.6l-2 3M18 13.6l2 3" />
  </svg>
);
