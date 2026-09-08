import type { ImageRecord } from "@alidade/core";

/**
 * Where each image actually is.
 *
 * An SVG over the canvas rather than layers in the style, for the reason the
 * drawing overlay gives: this is not in the document. It is a function of what
 * the server answered for the current view, it changes without anyone editing
 * anything, and a source added behind the reconciler's back would not survive a
 * basemap swap. It also costs no operations, so panning does not fill the undo
 * history with outlines.
 *
 * The link runs both ways — hovering a card lights its outline, clicking an
 * outline selects its card — because without it the catalogue is a list of
 * filenames and nobody can tell which is which.
 */

interface Props {
  images: ImageRecord[];
  selected: string | null;
  hovered: string | null;
  /** Which images the mosaic rule is actually drawing with. */
  drawn: Set<string>;
  /** lon/lat to pixels, from the map. */
  project: (position: [number, number]) => { x: number; y: number } | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** The position someone pressed and held, if there is one. */
  at?: [number, number] | null;
  /** The area being searched, or the one being dragged out. */
  area?: { west: number; south: number; east: number; north: number } | null;
}

export function FootprintOverlay(props: Props) {
  /*
   * The selected outline is drawn last so it is on top. Painter's order is the
   * only ordering an SVG has, and an outline hidden under four others is an
   * outline the user cannot click.
   */
  const order = [...props.images].sort((a, b) => {
    const rank = (image: ImageRecord) =>
      image.id === props.hovered ? 3 : image.id === props.selected ? 2 : props.drawn.has(image.id) ? 1 : 0;
    return rank(a) - rank(b);
  });

  // Where the question was asked. Without it the panel reports on a position the
  // user can no longer point to, and panning makes it a mystery.
  const pin = props.at ? props.project(props.at) : null;

  const area = props.area
    ? (() => {
        const a = props.project([props.area.west, props.area.north]);
        const b = props.project([props.area.east, props.area.south]);
        return a && b
          ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
          : null;
      })()
    : null;

  return (
    <svg className="footprints" aria-hidden>
      {order.map((image) => {
        const points = image.footprint
          .map((position) => props.project(position))
          .filter((point): point is { x: number; y: number } => point !== null);

        // A footprint whose corners will not project is off the globe's edge
        // rather than a bug, and drawing three of its four corners would be a
        // triangle nobody asked for.
        if (points.length < image.footprint.length || points.length < 4) return null;

        const state =
          image.id === props.hovered
            ? "hover"
            : image.id === props.selected
              ? "sel"
              : props.drawn.has(image.id)
                ? "drawn"
                : "other";

        return (
          <polygon
            key={image.id}
            className={`footprint ${state}`}
            points={points.map((point) => `${point.x},${point.y}`).join(" ")}
            onClick={() => props.onSelect(image.id)}
            onMouseEnter={() => props.onHover(image.id)}
            onMouseLeave={() => props.onHover(null)}
          >
            <title>
              {image.title}
              {image.datetime ? ` · ${image.datetime.slice(0, 10)}` : " · no date"}
            </title>
          </polygon>
        );
      })}

      {area && (
        <rect
          className="searcharea"
          x={area.x}
          y={area.y}
          width={area.w}
          height={area.h}
        />
      )}

      {pin && (
        <g className="pin" transform={`translate(${pin.x} ${pin.y})`}>
          <circle r="13" />
          <path d="M-9 0h5M4 0h5M0 -9v5M0 4v5" />
        </g>
      )}
    </svg>
  );
}
