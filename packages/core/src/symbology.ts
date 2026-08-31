import type { Geometry, LabelStyle, Symbology } from "./types/project";

/** Symbology plus the effective opacity becomes a paint object. */
export function paintFor(
  sym: Symbology,
  geometry: Geometry,
  opacity: number,
): Record<string, unknown> {
  // A marker is drawn from an image, so it has no colour of its own to set.
  if (sym.kind === "marker") return { "icon-opacity": opacity };

  if (sym.kind === "extrusion") {
    return {
      "fill-extrusion-color": sym.color,
      "fill-extrusion-opacity": opacity,
      "fill-extrusion-height": [
        "*",
        ["coalesce", ["get", sym.heightField], 0],
        sym.heightScale ?? 1,
      ],
    };
  }

  const color = colorExpression(sym);

  switch (geometry) {
    case "polygon":
      return { "fill-color": color, "fill-opacity": opacity };
    case "line":
      return { "line-color": color, "line-opacity": opacity };
    case "point":
      return {
        "circle-color": color,
        "circle-opacity": opacity,
        "circle-radius": 4,
      };
    case "raster":
      return { "raster-opacity": opacity };
  }
}

/**
 * Graduated and categorized both fold into one data-driven colour expression, so a
 * break change is a single paint operation rather than a rebuild.
 */
export function colorExpression(sym: Symbology): unknown {
  switch (sym.kind) {
    case "marker":
      return sym.color;

    case "single":
      return sym.color;

    case "graduated": {
      // A classification with no breaks is one class, and `step` needs at least
      // one stop, so it degrades to the flat colour rather than to an error.
      if (sym.breaks.length === 0) return sym.colors[0] ?? sym.noDataColor;
      const steps: unknown[] = ["step", ["to-number", ["get", sym.field], -1], sym.colors[0]];
      sym.breaks.forEach((b, i) => steps.push(b, sym.colors[i + 1] ?? sym.colors[sym.colors.length - 1]));
      // A missing value is its own class, never the bottom one.
      return ["case", ["==", ["typeof", ["get", sym.field]], "null"], sym.noDataColor, steps];
    }

    case "categorized": {
      /*
       * `match` needs at least one label and output. An empty classification
       * compiled to `["match", input, fallback]`, which the renderer rejects as
       * a malformed expression — so switching a layer to Categories threw inside
       * setPaintProperty and the layer silently kept the colour it already had.
       * Switching to a classification you have not filled in yet is a normal
       * intermediate state, not an error.
       */
      if (sym.categories.length === 0) return sym.fallbackColor;
      const match: unknown[] = ["match", ["to-string", ["get", sym.field], ""]];
      for (const c of sym.categories) match.push(String(c.value), c.color);
      match.push(sym.fallbackColor);
      return match;
    }

    case "extrusion":
      return sym.color;
  }
}

export function strokePaint(sym: Symbology, opacity: number): Record<string, unknown> | null {
  if (sym.kind === "extrusion" || sym.kind === "marker" || !sym.stroke) return null;
  const paint: Record<string, unknown> = {
    "line-color": sym.stroke.color,
    "line-width": sym.stroke.width,
    "line-opacity": opacity,
  };
  if (sym.stroke.dash) paint["line-dasharray"] = sym.stroke.dash;
  return paint;
}

export function labelLayout(labels: LabelStyle): Record<string, unknown> {
  return {
    "text-field": templateToExpression(labels.template),
    "text-size": labels.size,
    "text-allow-overlap": labels.allowOverlap ?? false,
    "symbol-placement": labels.placement ?? "point",
  };
}

export function labelPaint(labels: LabelStyle, opacity: number): Record<string, unknown> {
  return {
    "text-color": labels.color,
    "text-opacity": opacity,
    "text-halo-color": labels.haloColor ?? "#000000",
    "text-halo-width": labels.haloWidth ?? 1,
  };
}

/** "{name} · {density}" becomes a concat expression over the fields. */
export function templateToExpression(template: string): unknown {
  const parts: unknown[] = ["concat"];
  const re = /\{([a-z0-9_]+)\}/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) parts.push(template.slice(last, m.index));
    parts.push(["coalesce", ["to-string", ["get", m[1]]], ""]);
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts.length === 2 && typeof parts[1] === "string" ? parts[1] : parts;
}
