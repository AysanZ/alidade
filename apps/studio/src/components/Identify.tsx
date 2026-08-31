import type { LayerNode } from "@alidade/core";

export interface Identified {
  layer: LayerNode;
  properties: Record<string, unknown>;
  at: { x: number; y: number };
  viewport?: { width: number; height: number };
  position: [number, number];
}

/**
 * What is under the cursor.
 *
 * A GIS without identify is a picture of a map. Clicking a feature has to say
 * what it is without making you find it in a table of nine thousand rows first —
 * and then offer to do exactly that, for when you do want the table.
 */
export function Identify({
  found,
  onClose,
  onOpenTable,
  onZoom,
}: {
  found: Identified;
  onClose: () => void;
  onOpenTable: () => void;
  onZoom: () => void;
}) {
  const entries = Object.entries(found.properties).filter(
    ([key]) => !key.startsWith("__"),
  );
  const title = pickTitle(found.properties) ?? found.layer.name;

  /*
   * Positioned in the map container's coordinates, beside the feature, and
   * flipped to the other side of the cursor when there is no room.
   */
  const flipX = found.at.x > (found.viewport?.width ?? 0) - 300;
  const flipY = found.at.y > (found.viewport?.height ?? 0) - 260;
  const style = flipX
    ? { right: (found.viewport?.width ?? 0) - found.at.x + 14 }
    : { left: found.at.x + 14 };
  const vertical = flipY
    ? { bottom: (found.viewport?.height ?? 0) - found.at.y + 14 }
    : { top: found.at.y - 10 };

  return (
    <div className="identify" style={{ ...style, ...vertical }}>
      <header>
        <span className="swatch" style={{ background: found.layer.symbology.kind === "single" ? found.layer.symbology.color : "#4c8dff" }} />
        <b>{title}</b>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <dl>
        {entries.length === 0 && <p className="hint">This feature carries no attributes.</p>}
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt title={key}>{key}</dt>
            <dd title={String(value ?? "")}>{value === null || value === "" ? "—" : String(value)}</dd>
          </div>
        ))}
      </dl>

      <footer>
        <button onClick={onZoom}>Zoom here</button>
        <button onClick={onOpenTable}>Find in table</button>
      </footer>
    </div>
  );
}

/** The field most likely to be what a person calls this feature. */
function pickTitle(properties: Record<string, unknown>): string | null {
  for (const candidate of ["name", "NAME", "title", "name_en", "nameascii", "label", "admin"]) {
    const value = properties[candidate];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
