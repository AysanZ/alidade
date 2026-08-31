import type {
  CategorizedSymbol,
  Geometry,
  GraduatedSymbol,
  SingleSymbol,
  Symbology,
} from "./types/project";

/**
 * The colours new layers are given, in order.
 *
 * Every import used to arrive as the same blue, so three layers on top of each
 * other were one indistinguishable blue smear and the table of contents was the
 * only way to tell them apart. These are picked to stay apart on a dark canvas
 * and to survive the usual colour vision deficiencies: no red next to green.
 */
export const LAYER_COLORS = [
  "#4c8dff",
  "#ffb454",
  "#5ad19a",
  "#e06c9f",
  "#c792ea",
  "#54c7d9",
  "#f0616b",
  "#a3be5c",
  "#f2c14e",
  "#8d9bff",
] as const;

/**
 * The next colour nothing else is wearing.
 *
 * Falls back to walking the palette once every colour is taken, rather than
 * repeating the first one, so the fourteenth layer still differs from the
 * thirteenth.
 */
export function nextColor(taken: readonly string[]): string {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  const free = LAYER_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free ?? LAYER_COLORS[taken.length % LAYER_COLORS.length]!;
}

/** Sequential ramps, for a graduated classification. */
export const RAMPS: Record<string, string[]> = {
  Blue: ["#0f2438", "#1b4674", "#2e6fe0", "#6fa8ff", "#bbdaff"],
  Ember: ["#2b1206", "#6b2d0e", "#b8531b", "#ea8f3c", "#ffd08a"],
  Viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
  Teal: ["#08282e", "#0f4c5c", "#177e89", "#4fb3bf", "#a8dadc"],
  Grey: ["#1a1a1c", "#3a3a40", "#66666d", "#9a9aa0", "#d6d6da"],
};

/** Qualitative colours, for a categorized classification. */
export const CATEGORY_COLORS = [
  "#4c8dff",
  "#ffb454",
  "#5ad19a",
  "#e06c9f",
  "#c792ea",
  "#54c7d9",
  "#f0616b",
  "#a3be5c",
  "#f2c14e",
  "#8d9bff",
  "#d98f4e",
  "#7fd1b9",
];

export function singleSymbol(color: string, geometry: Geometry): SingleSymbol {
  // A point with a polygon's hairline stroke draws a ring nobody asked for.
  return geometry === "point" || geometry === "raster"
    ? { kind: "single", color }
    : { kind: "single", color, stroke: { color: "#0a0a0b", width: 0.6 } };
}

/**
 * Class breaks by equal interval.
 *
 * Quantiles need the values, which the client does not have; equal interval
 * needs only the range, which the attribute table already knows. It is the wrong
 * classifier for a skewed distribution and the right one for a first guess the
 * user then drags into shape.
 */
export function equalIntervalBreaks(low: number, high: number, classes: number): number[] {
  if (!(high > low) || classes < 2) return [];
  const step = (high - low) / classes;
  return Array.from({ length: classes - 1 }, (_, i) => round(low + step * (i + 1)));
}

export function graduatedSymbol(
  field: string,
  low: number,
  high: number,
  classes: number,
  ramp: string[],
): GraduatedSymbol {
  const breaks = equalIntervalBreaks(low, high, classes);
  return {
    kind: "graduated",
    field,
    breaks,
    colors: rampOf(ramp, breaks.length + 1),
    noDataColor: "#3a3a40",
    stroke: { color: "#0a0a0b", width: 0.6 },
  };
}

export function categorizedSymbol(
  field: string,
  values: (string | number)[],
  fallbackColor = "#3a3a40",
): CategorizedSymbol {
  const unique = [...new Set(values.map((v) => String(v)))].slice(0, 24);
  return {
    kind: "categorized",
    field,
    categories: unique.map((value, i) => ({
      value,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!,
      label: value,
    })),
    fallbackColor,
    stroke: { color: "#0a0a0b", width: 0.6 },
  };
}

/**
 * A ramp resampled to the number of classes asked for.
 *
 * Ramps are written with five stops because that is what reads well on a legend;
 * a seven class map needs seven, and repeating the last colour twice is worse
 * than interpolating.
 */
export function rampOf(ramp: string[], classes: number): string[] {
  if (ramp.length === 0) return [];
  if (classes <= 1) return [ramp[Math.floor(ramp.length / 2)]!];
  return Array.from({ length: classes }, (_, i) => {
    const at = (i / (classes - 1)) * (ramp.length - 1);
    const low = Math.floor(at);
    const high = Math.min(ramp.length - 1, low + 1);
    return mix(ramp[low]!, ramp[high]!, at - low);
  });
}

/** The colour a swatch should show for a symbology, without a renderer. */
export function representativeColor(symbology: Symbology): string {
  if (symbology.kind === "graduated") return symbology.colors[Math.floor(symbology.colors.length / 2)] ?? "#4c8dff";
  if (symbology.kind === "categorized") return symbology.categories[0]?.color ?? symbology.fallbackColor;
  return symbology.color;
}

function mix(a: string, b: string, t: number): string {
  const from = rgb(a);
  const to = rgb(b);
  const channel = (i: number) => Math.round(from[i]! + (to[i]! - from[i]!) * t);
  return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ];
}

const round = (n: number) => Number(n.toPrecision(4));
