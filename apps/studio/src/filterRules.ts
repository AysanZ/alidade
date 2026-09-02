import type { FilterNode, FilterValue } from "@alidade/core";

/**
 * Turning a filter tree into a list of rules, and back.
 *
 * Separated from the panel that shows it because none of it is about React and
 * all of it is worth testing: whether a value typed as `10` is stored as a
 * number or a string decides whether `>` compares arithmetic or text, and
 * `"5" > "10"` is true one way and false the other. A filter that is wrong only
 * for two-digit values is the worst kind of wrong.
 */

export type Comparison = Extract<FilterNode, { field: string }>;

/** The operators, in the order somebody scanning for one would look. */
export const OPERATORS: {
  op: Comparison["op"];
  label: string;
  takes: "value" | "list" | "none";
}[] = [
  { op: "=", label: "is", takes: "value" },
  { op: "!=", label: "is not", takes: "value" },
  { op: ">", label: "greater than", takes: "value" },
  { op: ">=", label: "at least", takes: "value" },
  { op: "<", label: "less than", takes: "value" },
  { op: "<=", label: "at most", takes: "value" },
  { op: "like", label: "contains", takes: "value" },
  { op: "in", label: "is one of", takes: "list" },
  { op: "notnull", label: "has a value", takes: "none" },
  { op: "isnull", label: "is empty", takes: "none" },
];

export const takesOf = (op: Comparison["op"]) =>
  OPERATORS.find((o) => o.op === op)?.takes ?? "value";

/**
 * Read the document's filter as a flat list, whatever shape it was written in.
 *
 * The document's `FilterNode` nests arbitrarily and the compiler handles that,
 * so a filter written elsewhere still applies. The editor is a list because a
 * nesting editor in a 290px panel is a worse tool than a list, and almost every
 * filter anybody writes is "these three things, all true".
 */
export function toRules(filter: FilterNode | undefined): {
  join: "and" | "or";
  rules: Comparison[];
} {
  if (!filter) return { join: "and", rules: [] };
  if (filter.op === "and" || filter.op === "or") {
    return {
      join: filter.op,
      rules: filter.children.filter((c): c is Comparison => "field" in c),
    };
  }
  return { join: "and", rules: "field" in filter ? [filter] : [] };
}

/** True when the document holds something the flat list cannot round-trip. */
export function isComplex(filter: FilterNode | undefined): boolean {
  if (!filter) return false;
  if ("field" in filter) return false;
  if (filter.op === "not") return true;
  return filter.children.some((c) => !("field" in c));
}

/** Build the filter a list of rules means, or nothing at all for an empty list. */
export function toFilter(join: "and" | "or", rules: Comparison[]): FilterNode | undefined {
  if (rules.length === 0) return undefined;
  // One rule is that rule, not a conjunction of one. Both compile the same, but
  // the document is read by people as well as by the compiler.
  if (rules.length === 1) return rules[0]!;
  return { op: join, children: rules };
}

/** Change the test, keeping the value if the new test can still use it. */
export function rebuild(rule: Comparison, op: Comparison["op"]): Comparison {
  const takes = takesOf(op);
  if (takes === "none") return { op, field: rule.field } as Comparison;
  if (takes === "list") return { op: "in", field: rule.field, value: listOf(rule) } as Comparison;

  const value = scalarOf(rule);
  if (op === "like") return { op, field: rule.field, value: String(value ?? "") };
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    return { op, field: rule.field, value: Number(value) || 0 };
  }
  return { op, field: rule.field, value: value ?? "" } as Comparison;
}

/**
 * Put the typed text back into the rule.
 *
 * Anything that reads as a number is stored as one, because a comparison against
 * a number has to hold a number. `like` is the exception: it is a text test, so
 * `contains 2024` is looking for the characters and not the quantity.
 */
export function withValue(rule: Comparison, text: string): Comparison {
  if (takesOf(rule.op) === "list") {
    return { ...rule, value: text.split(",").map((part) => coerce(part.trim())) } as Comparison;
  }
  if (rule.op === "like") return { ...rule, value: text } as Comparison;
  return { ...rule, value: coerce(text) } as Comparison;
}

export function coerce(text: string): FilterValue {
  if (text === "") return "";
  if (text === "true") return true;
  if (text === "false") return false;
  const asNumber = Number(text);
  return Number.isFinite(asNumber) && text.trim() !== "" ? asNumber : text;
}

export function displayValue(rule: Comparison): string {
  if (!("value" in rule)) return "";
  if (Array.isArray(rule.value)) return rule.value.join(", ");
  return String(rule.value ?? "");
}

const scalarOf = (rule: Comparison): FilterValue | undefined =>
  "value" in rule && !Array.isArray(rule.value) ? (rule.value as FilterValue) : undefined;

const listOf = (rule: Comparison): FilterValue[] =>
  "value" in rule && Array.isArray(rule.value) ? rule.value : [];
