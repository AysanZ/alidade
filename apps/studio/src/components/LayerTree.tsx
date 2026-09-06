import { useState } from "react";
import type { MapProject, Slot, TreeNode } from "@alidade/core";
import { assetCounts, hiddenBecause } from "@alidade/core";

import type { Extent } from "../layers";
import { withNode } from "../tree";
import { Catalogue } from "./Catalogue";
import { LayerSymbol } from "./LayerSymbol";
import { LIVE_ID, type FeedState } from "./LiveInspector";

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
  /** The scale the map is at, so a layer that is not drawn at it can say so. */
  denominator: number;
  /** Where the live feed's connection is, for the row's status light. */
  feed: FeedState;
}

/**
 * The table of contents.
 *
 * Rebuilt because the first version was unreadable: eleven pixel rows, a swatch
 * the size of a full stop, an add button that was a bare `+` in a corner, and no
 * way to reorder except a context menu two clicks deep. A table of contents is
 * the control surface of a GIS, not a list of names.
 */
export function LayerTree({
  project,
  selected,
  onSelect,
  edit,
  onMenu,
  onAdd,
  onFlyTo,
  denominator,
  feed,
}: Props) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /* Groups fold. A group of nine is nine rows you cannot get past otherwise. */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const slotOf = (node: TreeNode): Slot => {
    if (node.type === "layer") return node.slot;
    for (const child of node.children) {
      const slot = slotOf(child);
      if (slot) return slot;
    }
    return "data";
  };

  /*
   * With no layers yet the panel is a heading and the catalogue, and the live
   * row went underneath both — which put the one part of this panel that
   * reports a live status below the fold on a fresh install, where it looked
   * like the feature was missing rather than merely scrolled past. A row that
   * says whether data is arriving has to be visible without scrolling to it.
   */
  if (project.tree.length === 0) {
    return (
      <div className="tree">
        <div className="empty">
          <b>No layers yet</b>
        </div>
        <LiveRow
          project={project}
          edit={edit}
          feed={feed}
          selected={selected}
          onSelect={onSelect}
        />
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
                denominator={denominator}
                closed={closed}
                onToggleGroup={toggleGroup}
              />
            ))}
          </div>
        );
      })}

      <LiveRow project={project} edit={edit} feed={feed} selected={selected} onSelect={onSelect} />

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

/**
 * The live feed's row in the table of contents.
 *
 * A row and not a pane. Everything else that can be drawn on the map is in this
 * list, and a layer that lives somewhere else is a layer people do not find and
 * cannot reason about next to the rest: whether it is on, what draws over what.
 * It behaves like its neighbours — the eye hides it, clicking it puts it in the
 * inspector — and differs in the one way it has to, which is that it says
 * whether the data is arriving.
 *
 * The dot is the only piece of chrome here that is not about the map. It has to
 * be: a live layer that has quietly stopped receiving looks exactly like a live
 * layer where nothing happens to be moving, and no amount of looking at the
 * canvas tells the two apart.
 */
function LiveRow({
  project,
  edit,
  feed,
  selected,
  onSelect,
}: {
  project: MapProject;
  edit: Props["edit"];
  feed: FeedState;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const assets = project.assets;
  if (!assets) return null;

  const { total, stale } = assetCounts(assets);
  const toggle = () =>
    edit((draft) => {
      if (draft.assets) draft.assets.visible = !draft.assets.visible;
      return draft;
    });

  const classes = [
    "node",
    "live",
    selected === LIVE_ID ? "on" : "",
    assets.visible ? "" : "off",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className="slot" title="Positions arriving from a feed">
        <span className="cap">Live</span>
        <i />
        <span className={`dot ${feed}`} title={FEED_TITLES[feed]} aria-label={FEED_TITLES[feed]} />
      </div>
      <div
        className={classes}
        style={{ paddingInlineStart: 9 }}
        onClick={() => onSelect(LIVE_ID)}
      >
        <span className="grip" aria-hidden="true" />
        <span className="fold" aria-hidden="true" />
        <button
          className="eye"
          aria-label={assets.visible ? "Hide live assets" : "Show live assets"}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
        >
          {assets.visible ? <EyeOpen /> : <EyeShut />}
        </button>

        <span className="swatch" style={{ background: assets.color, borderRadius: "50%" }} />

        <span className="name" title={describeFeed(feed, total, stale)}>
          Live assets
        </span>

        {/*
          The count is the tag, and a count of what has gone quiet outranks it
          when there is one: forty assets of which twelve are stale is a
          different map from forty assets, and it is the fact you act on.
        */}
        <span className={stale > 0 ? "tag flag" : "tag"} title={describeFeed(feed, total, stale)}>
          {feed === "off" ? "off" : stale > 0 ? `${stale} old` : String(total)}
        </span>
      </div>
    </>
  );
}

const FEED_TITLES: Record<FeedState, string> = {
  off: "Not connected",
  connecting: "Connecting",
  live: "Receiving",
  retrying: "Connection dropped, retrying",
  failed: "Could not connect",
};

function describeFeed(feed: FeedState, total: number, stale: number): string {
  if (feed === "off") return "The feed is switched off";
  const counted = `${total} asset${total === 1 ? "" : "s"}`;
  const quiet = stale > 0 ? `, ${stale} gone quiet` : "";
  return `${FEED_TITLES[feed]} · ${counted}${quiet}`;
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
  denominator: number;
  closed: Set<string>;
  onToggleGroup: (id: string) => void;
}

function Node(props: NodeProps) {
  const {
    node,
    depth,
    selected,
    onSelect,
    edit,
    onMenu,
    dragging,
    over,
    setDragging,
    setOver,
    onDrop,
    denominator,
    closed,
    onToggleGroup,
  } = props;

  const folded = node.type === "group" && closed.has(node.id);
  /*
   * A layer that is on but not drawn at this scale is the commonest "why is my
   * data missing" in a GIS, and the answer is always in a panel nobody opened.
   * The row says so itself.
   */
  const outOfScale = node.type === "layer" && hiddenBecause(node, denominator) === "scale";

  const toggle = () =>
    edit((draft) =>
      withNode(draft, node.id, (n) => {
        n.visible = !n.visible;
      }),
    );

  const classes = [
    "node",
    node.type === "group" ? "group" : "",
    node.id === selected ? "on" : "",
    node.visible ? "" : "off",
    outOfScale ? "unscaled" : "",
    folded ? "closed" : "",
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

        {node.type === "group" ? (
          <button
            className="fold"
            aria-expanded={!folded}
            aria-label={folded ? `Open ${node.name}` : `Close ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroup(node.id);
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="fold" aria-hidden="true" />
        )}
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

        {/* The layer's real symbology, not a colour chip. */}
        <LayerSymbol node={node} />

        <span className="name" title={`${node.name} · ${describe(node)}`}>
          {node.name}
        </span>

        {/*
          One tag, not two. The row is 272px wide and a second one costs about
          six characters of layer name, which is the more useful of the two.
          "Not drawn here" outranks "five classes" when both are true.
        */}
        {outOfScale ? (
          <span className="tag flag" title="Not drawn at this scale">
            scale
          </span>
        ) : (
          <span className="tag">{badge(node)}</span>
        )}

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

      {node.type === "group" && !folded && (
        <div className="kids">
          {node.children.map((child) => (
            <Node {...props} key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
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
