/**
 * The name of whatever the pointer is over, next to the pointer.
 *
 * Deliberately not a MapLibre Popup: a popup is anchored to a coordinate and
 * animates itself into place, which at mouse-move rate reads as a wobble. This
 * is a plain box at a pixel position, and it moves exactly as fast as the mouse.
 */
export interface Tip {
  name: string;
  layer: string;
  at: { x: number; y: number };
  viewport: { width: number; height: number };
}

/** Clear of the cursor, but close enough to read as attached to it. */
const OFFSET = { x: 14, y: 16 };

/**
 * Roughly how much room the box needs. It is measured after layout, not before,
 * so this only decides which side of the pointer to grow from; being a little
 * out means a tooltip flips a few pixels early, not that it runs off the screen.
 */
const ROOM = { width: 220, height: 52 };

export function FeatureTip({ name, layer, at, viewport }: Tip) {
  const flipX = at.x + OFFSET.x + ROOM.width > viewport.width;
  const flipY = at.y + OFFSET.y + ROOM.height > viewport.height;

  return (
    <div
      className="featuretip"
      role="tooltip"
      style={{
        left: at.x + (flipX ? -OFFSET.x : OFFSET.x),
        top: at.y + (flipY ? -OFFSET.y : OFFSET.y),
        transform: `translate(${flipX ? "-100%" : "0"}, ${flipY ? "-100%" : "0"})`,
      }}
    >
      <b>{name}</b>
      <span>{layer}</span>
    </div>
  );
}
