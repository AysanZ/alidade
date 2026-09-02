import type { LayerNode } from "@alidade/core";

/**
 * What to call one feature.
 *
 * Imported data does not agree on where a name lives. Natural Earth uses `name`,
 * an OS extract uses `NAME`, a French dataset uses `nom`, a census table has
 * nothing but codes. So this is an ordered search rather than a lookup, and it
 * is allowed to fail: a tooltip that says nothing is better than one that says
 * `3`.
 */

/** Columns that are a name, most specific first. Compared case-insensitively. */
const NAMED = [
  "name",
  "title",
  "label",
  "nom",
  "nombre",
  "nome",
  "name_en",
  "name_long",
  "display_name",
  "admin",
  "city",
  "place",
  "description",
];

/**
 * Columns that identify rather than name.
 *
 * They are perfectly good keys and perfectly useless labels, so they are only
 * reached for once everything else has failed.
 */
const IDENTIFIERS = /(^|_)(id|fid|gid|uid|code|key|ref|uuid)($|_)/i;

const scalar = (value: unknown): value is string | number =>
  (typeof value === "string" && value.trim() !== "") ||
  (typeof value === "number" && Number.isFinite(value));

const text = (value: string | number): string => String(value).trim();

/**
 * Fill `{field}` placeholders from the feature's own attributes.
 *
 * The same templating the label layer uses, so a layer with labels turned on
 * reads the same on hover as it does on the map. A placeholder with no value
 * behind it drops out rather than printing itself.
 */
function fromTemplate(template: string, properties: Record<string, unknown>): string | null {
  if (!template.includes("{")) return template.trim() || null;
  let missing = false;
  const filled = template.replace(/\{([^{}]+)\}/g, (_, field: string) => {
    const value = properties[field.trim()];
    if (!scalar(value)) {
      missing = true;
      return "";
    }
    return text(value);
  });
  // A template of nothing but missing fields is a template that does not apply.
  const cleaned = filled.replace(/\s*·\s*(?=·|$)/g, "").trim();
  if (!cleaned) return null;
  return missing && cleaned === template ? null : cleaned;
}

/** The name to show for a hovered feature, or null when nothing reads as one. */
export function featureLabel(
  node: LayerNode | undefined,
  properties: Record<string, unknown>,
): string | null {
  if (node?.labels?.template) {
    const label = fromTemplate(node.labels.template, properties);
    if (label) return label;
  }

  const keys = Object.keys(properties);
  const byName = new Map(keys.map((key) => [key.toLowerCase(), key]));

  for (const wanted of NAMED) {
    const key = byName.get(wanted);
    if (key && scalar(properties[key])) return text(properties[key] as string | number);
  }

  // `place_name`, `NAME_EN`, `station_name`: anything with name in it will do.
  for (const key of keys) {
    if (/name/i.test(key) && scalar(properties[key])) {
      return text(properties[key] as string | number);
    }
  }

  // Any plain text column that is not obviously an identifier.
  for (const key of keys) {
    if (typeof properties[key] === "string" && !IDENTIFIERS.test(key) && scalar(properties[key])) {
      return text(properties[key] as string);
    }
  }

  // The column the map is coloured by says more about this feature than an
  // arbitrary number would, so it is named rather than shown bare.
  const symbology = node?.symbology;
  const field =
    symbology && (symbology.kind === "graduated" || symbology.kind === "categorized")
      ? symbology.field
      : undefined;
  if (field && scalar(properties[field])) return `${field}: ${text(properties[field] as never)}`;

  const key = node?.metadata?.key;
  if (key && scalar(properties[key])) return text(properties[key] as string | number);

  return null;
}
