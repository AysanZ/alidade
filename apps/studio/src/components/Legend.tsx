import type { MapProject, LayerNode, TreeNode } from "@alidade/core";
import { formatDistance } from "@alidade/core";

/**
 * A legend, read straight off the classifications.
 *
 * `chrome.legend` has been in the schema since the beginning and has never drawn
 * anything. A choropleth without one is decoration: the reader can see that the
 * colours differ and not what they mean.
 */
export function Legend({ project }: { project: MapProject }) {
  const layers = visibleLayers(project.tree).filter((l) => l.geometry !== "raster");
  if (layers.length === 0) return null;

  return (
    <aside className="legend" aria-label="Legend">
      <h3>Legend</h3>
      {layers.slice(0, 4).map((layer) => (
        <section key={layer.id}>
          <b title={layer.name}>{layer.name}</b>
          {keysFor(layer).map((key, i) => (
            <div className="key" key={i}>
              {key.glyph ? (
                <i className="glyph" aria-hidden>
                  {key.glyph}
                </i>
              ) : (
                <i style={{ background: key.color }} />
              )}
              <span title={key.label}>{key.label}</span>
            </div>
          ))}
        </section>
      ))}
      {layers.length > 4 && <p className="hint">and {layers.length - 4} more</p>}
    </aside>
  );
}

interface Key {
  color: string;
  label: string;
  /** Set for a marker, which is a picture rather than a colour. */
  glyph?: string;
}

function keysFor(layer: LayerNode): Key[] {
  const marker = layer.marker;
  if (!marker) return classificationKeys(layer);

  /*
   * On a point layer the marker replaces the dot, so the classification draws
   * nothing and listing its colours would be a legend for a map that is not
   * there. On a line or an area both are drawn, so both are listed.
   */
  const key: Key = { color: marker.color, label: layer.name, glyph: marker.glyph };
  return layer.geometry === "point" ? [key] : [...classificationKeys(layer), key];
}

function classificationKeys(layer: LayerNode): Key[] {
  const s = layer.symbology;

  if (s.kind === "graduated") {
    // n colours and n-1 breaks describe n bands; the ends are open.
    return s.colors.map((color, i) => {
      const low = i === 0 ? undefined : s.breaks[i - 1];
      const high = i === s.colors.length - 1 ? undefined : s.breaks[i];
      const label =
        low === undefined ? `under ${format(high)}`
        : high === undefined ? `${format(low)} and over`
        : `${format(low)} – ${format(high)}`;
      return { color, label };
    });
  }

  if (s.kind === "categorized") {
    const shown = s.categories.slice(0, 8).map((c) => ({
      color: c.color,
      label: c.label ?? String(c.value),
    }));
    if (s.categories.length > 8) {
      shown.push({ color: s.fallbackColor, label: `and ${s.categories.length - 8} more` });
    }
    return shown;
  }

  if (s.kind === "extrusion") {
    return [{ color: s.color, label: `height from ${s.heightField}` }];
  }

  return [{ color: s.color, label: layer.geometry }];
}

function visibleLayers(nodes: TreeNode[], visible = true): LayerNode[] {
  const out: LayerNode[] = [];
  for (const node of nodes) {
    if (node.type === "group") out.push(...visibleLayers(node.children, visible && node.visible));
    else if (visible && node.visible) out.push(node);
  }
  return out;
}

const format = (n: number | undefined) => {
  if (n === undefined) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

/** Exported for the same reason the legend exists: so a scale can be read. */
export const legendDistance = formatDistance;
