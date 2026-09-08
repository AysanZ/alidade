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
    </svg>
  );
}
