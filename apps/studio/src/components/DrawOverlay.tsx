import type { Annotation, Annotations, DistanceUnits, SnapTarget } from "@alidade/core";
import {
  circleRing,
  distance,
  formatArea,
  formatBearing,
  formatDistance,
  rectangleRing,
  ringArea,
  segmentsOf,
  type DraftReadout,
} from "@alidade/core";

/**
 * Everything about a drawing that is true only this frame.
 *
 * It is an SVG over the canvas rather than layers in the style, for two reasons.
 * The renderer's layers are compiled from the document by the reconciler, and
 * the rubber band is not in the document — it is where the mouse is. And a
 * source added behind the reconciler's back does not survive a basemap swap,
 * because a swap replaces the style wholesale.
 *
 * Being SVG also means the vertex handles are real DOM elements with real
 * pointer events, so dragging one is a `mousedown` on a circle rather than a
 * hit test against the map at every frame.
 */

export interface Props {
  annotations: Annotations | undefined;
  /** The drawing in progress, if there is one. */
  active: Annotation | undefined;
  /** Where the pointer is, already snapped. */
  cursor: [number, number] | null;
  snapAt: SnapTarget | null;
  readout: DraftReadout | null;
  /** Vertex handles are only shown when editing, or they are just clutter. */
  editing: boolean;
  selected: string | null;
  units: DistanceUnits;
  /** The first corner of a rectangle or circle, while the second is being aimed. */
  anchor: [number, number] | null;
  /** Which spanned tool is armed, if any. */
  spanning: "rectangle" | "circle" | null;
  /** lon/lat to pixels, from the map. */
  project: (position: [number, number]) => { x: number; y: number } | null;
  /** A mouse event's position back to lon/lat, for picking a shape up. */
  unproject: (event: MouseEvent) => [number, number] | null;
  onVertexDown: (of: string, index: number) => void;
  onMidpointDown: (of: string, segment: number, position: [number, number]) => void;
  onVertexRemove: (of: string, index: number) => void;
  onShapeDown: (of: string, from: [number, number]) => void;
  onSelect: (id: string) => void;
}

/** Handles smaller than this are not worth showing; the segment is too short. */
const MIDPOINT_MINIMUM_PIXELS = 34;

export function DrawOverlay(props: Props) {
  const { annotations, active, cursor, snapAt, readout, editing, units, project, anchor, spanning } =
    props;

  const to = (position: [number, number]) => project(position);
  const path = (points: [number, number][]) => {
    const screen = points.map(to);
    if (screen.some((p) => p === null)) return null;
    return screen.map((p, i) => `${i === 0 ? "M" : "L"}${p!.x} ${p!.y}`).join(" ");
  };

  /* ---------------------------------------------------------- rubber band */

  let band: string | null = null;
  let closing: string | null = null;
  if (active && cursor && active.kind !== "point") {
    const placed = active.coordinates;
    const last = placed[placed.length - 1];
    if (last) band = path([last, cursor]);
    // A ring is closed whether the user draws the last edge or not, so it is
    // shown. Drawing an area without it means guessing at the shape.
    if (active.kind === "polygon" && placed.length >= 2 && placed[0]) {
      closing = path([cursor, placed[0]]);
    }
  }

  const fill =
    active && cursor && active.kind === "polygon" && active.coordinates.length >= 2
      ? path([...active.coordinates, cursor, active.coordinates[0]!])
      : null;

  /*
   * A rectangle or a circle being spanned out of its anchor.
   *
   * Drawn from the anchor and the cursor, which are both this frame's business.
   * Nothing is written to the document until the second click, so the whole drag
   * costs one operation instead of one per frame.
   */
  let spanned: string | null = null;
  let spannedReadout: { label: string; value: string }[] = [];
  if (anchor && cursor && spanning) {
    const ring =
      spanning === "rectangle" ? rectangleRing(anchor, cursor) : circleRing(anchor, cursor, 64);
    if (ring.length >= 3) {
      spanned = path([...ring, ring[0]!]);
      spannedReadout =
        spanning === "circle"
          ? [
              { label: "radius", value: formatDistance(distance(anchor, cursor), units) },
              { label: "area", value: formatArea(ringArea(ring), units) },
            ]
          : [
              {
                label: "width",
                value: formatDistance(distance(ring[0]!, ring[1]!), units),
              },
              {
                label: "height",
                value: formatDistance(distance(ring[1]!, ring[2]!), units),
              },
              { label: "area", value: formatArea(ringArea(ring), units) },
            ];
    }
  }

  const snapped = snapAt ? to(snapAt.position) : null;

  return (
    <>
      <svg className="drawoverlay" aria-hidden="true">
        {fill && <path className="draftfill" d={`${fill} Z`} />}
        {spanned && (
          <>
            <path className="draftfill" d={`${spanned} Z`} />
            <path className="draftband" d={spanned} />
          </>
        )}
        {closing && <path className="draftclosing" d={closing} />}
        {band && <path className="draftband" d={band} />}

        {/* Where the click will actually land, which is not where the mouse is. */}
        {snapped && (
          <g className={`snap ${snapAt!.kind}`}>
            <circle cx={snapped.x} cy={snapped.y} r={7} />
            {snapAt!.kind === "vertex" ? (
              <path
                d={`M${snapped.x - 4} ${snapped.y - 4}L${snapped.x + 4} ${snapped.y + 4}M${
                  snapped.x + 4
                } ${snapped.y - 4}L${snapped.x - 4} ${snapped.y + 4}`}
              />
            ) : (
              <circle cx={snapped.x} cy={snapped.y} r={2} className="dot" />
            )}
          </g>
        )}

        {editing && annotations && (
          <Handles {...props} to={to} fromScreen={props.unproject} annotations={annotations} />
        )}
      </svg>

      {readout && cursor && (
        <Readout readout={readout} at={to(cursor)} units={units} kind={active?.kind ?? "line"} />
      )}

      {spannedReadout.length > 0 && cursor && <Rows rows={spannedReadout} at={to(cursor)} />}
    </>
  );
}

/**
 * The grab handles.
 *
 * Solid squares are vertices that exist. Hollow circles are midpoints, which
 * become vertices when they are grabbed — so adding detail to a shape is one
 * gesture rather than a mode plus a click.
 */
function Handles({
  annotations,
  selected,
  to,
  fromScreen,
  onVertexDown,
  onMidpointDown,
  onVertexRemove,
  onShapeDown,
  onSelect,
}: Props & {
  annotations: Annotations;
  to: (position: [number, number]) => { x: number; y: number } | null;
  fromScreen: (event: MouseEvent) => [number, number] | null;
}) {
  return (
    <g className="handles">
      {annotations.features.map((feature) => {
        const on = feature.id === selected;
        const outline = feature.coordinates.map(to);
        const grab =
          outline.length >= 2 && !outline.some((p) => p === null)
            ? outline.map((p, i) => `${i === 0 ? "M" : "L"}${p!.x} ${p!.y}`).join(" ") +
              (feature.kind === "polygon" ? " Z" : "")
            : null;

        return (
          <g key={feature.id} className={on ? "on" : ""}>
            {/*
              Something to pick the whole shape up by. A fat invisible stroke for
              a line, the interior for a ring: grabbing a shape by aiming at the
              hairline that draws it is not a gesture anyone can perform.
            */}
            {grab && (
              <path
                className={`shapegrab ${feature.kind}`}
                d={grab}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onSelect(feature.id);
                  const at = fromScreen(e.nativeEvent);
                  if (at) onShapeDown(feature.id, at);
                }}
              >
                <title>Drag to move {feature.name}</title>
              </path>
            )}

            {on &&
              segmentsOf(feature).map(([a, b], segment) => {
                const pa = to(a);
                const pb = to(b);
                if (!pa || !pb) return null;
                if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < MIDPOINT_MINIMUM_PIXELS) return null;
                const middle: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                const p = to(middle);
                if (!p) return null;
                return (
                  <circle
                    key={`m${segment}`}
                    className="midpoint"
                    cx={p.x}
                    cy={p.y}
                    r={4}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onMidpointDown(feature.id, segment, middle);
                    }}
                  >
                    <title>Drag to add a vertex here</title>
                  </circle>
                );
              })}

            {feature.coordinates.map((position, index) => {
              const p = to(position);
              if (!p) return null;
              return (
                <rect
                  key={index}
                  className="vertex"
                  x={p.x - 4}
                  y={p.y - 4}
                  width={8}
                  height={8}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSelect(feature.id);
                    // Alt-click removes, which is the gesture every editor uses.
                    if (e.altKey) return onVertexRemove(feature.id, index);
                    onVertexDown(feature.id, index);
                  }}
                >
                  <title>Drag to move · Alt-click to remove</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/**
 * The numbers, beside the pointer, while the shape is being made.
 *
 * A GIS reports the segment and the total separately because they answer
 * different questions: "where am I putting this next point" and "how big is this
 * so far". Reporting only the total is how you end up re-drawing a line because
 * you could not tell whether the last leg was 90 m or 900.
 */
function Readout({
  readout,
  at,
  units,
  kind,
}: {
  readout: DraftReadout;
  at: { x: number; y: number } | null;
  units: DistanceUnits;
  kind: Annotation["kind"];
}) {
  if (!at || readout.placed === 0) return null;
  return (
    <div className="drawreadout" style={{ left: at.x + 16, top: at.y + 16 }}>
      <div>
        <span>segment</span>
        <b>{formatDistance(readout.segment, units)}</b>
      </div>
      <div>
        <span>bearing</span>
        <b>{formatBearing(readout.heading)}</b>
      </div>
      <div>
        <span>{kind === "polygon" ? "perimeter" : "total"}</span>
        <b>{formatDistance(readout.total, units)}</b>
      </div>
      {readout.area !== undefined && (
        <div>
          <span>area</span>
          <b>{formatArea(readout.area, units)}</b>
        </div>
      )}
    </div>
  );
}

/**
 * A small table of numbers beside the pointer.
 *
 * The same box as the drawing readout, fed by a spanned shape rather than a
 * traced one: a circle reports its radius, a rectangle its sides, and both their
 * area, because those are the numbers somebody dragging one out is watching.
 */
function Rows({
  rows,
  at,
}: {
  rows: { label: string; value: string }[];
  at: { x: number; y: number } | null;
}) {
  if (!at) return null;
  return (
    <div className="drawreadout" style={{ left: at.x + 16, top: at.y + 16 }}>
      {rows.map((row) => (
        <div key={row.label}>
          <span>{row.label}</span>
          <b>{row.value}</b>
        </div>
      ))}
    </div>
  );
}
