import type { FilterNode, FilterValue } from "./types/project";

/**
 * The filter tree is a structure, not a string, so one user-authored filter
 * compiles two ways: to a renderer expression and to SQL.
 */

export function toExpression(node: FilterNode): unknown {
  switch (node.op) {
    case "and":
    case "or":
      return [node.op === "and" ? "all" : "any", ...node.children.map(toExpression)];
    case "not":
      return ["!", toExpression(node.child)];
    case "isnull":
      return ["==", ["typeof", ["get", node.field]], "null"];
    case "notnull":
      return ["!=", ["typeof", ["get", node.field]], "null"];
    case "in":
      return ["in", ["get", node.field], ["literal", node.value]];
    case "like":
      return ["in", stripWildcards(node.value), ["get", node.field]];
    /*
     * The document spells equality `=`, because that is what a person writing a
     * filter types. A renderer expression spells it `==`, and rejects `=` as an
     * unknown operator — which failed the *whole* filter, so `setFilter` threw
     * and the layer went on showing everything. Every other comparison happens
     * to be spelled the same both ways.
     */
    case "=":
      return ["==", ["get", node.field], node.value];
    default:
      return [node.op, ["get", node.field], node.value];
  }
}

export interface SqlFilter {
  /** Placeholders only. Nothing derived from user text is ever concatenated in. */
  where: string;
  params: FilterValue[];
}

export function toSql(node: FilterNode, startAt = 1): SqlFilter {
  const params: FilterValue[] = [];
  const bind = (v: FilterValue) => {
    params.push(v);
    return `$${startAt + params.length - 1}`;
  };

  const walk = (n: FilterNode): string => {
    switch (n.op) {
      case "and":
      case "or":
        if (n.children.length === 0) return "TRUE";
        return `(${n.children.map(walk).join(n.op === "and" ? " AND " : " OR ")})`;
      case "not":
        return `NOT (${walk(n.child)})`;
      case "isnull":
        return `${ident(n.field)} IS NULL`;
      case "notnull":
        return `${ident(n.field)} IS NOT NULL`;
      case "in":
        return `${ident(n.field)} IN (${n.value.map(bind).join(", ")})`;
      case "like":
        return `${ident(n.field)} LIKE ${bind(n.value)}`;
      case "!=":
        return `${ident(n.field)} IS DISTINCT FROM ${bind(n.value)}`;
      default:
        return `${ident(n.field)} ${n.op} ${bind(n.value)}`;
    }
  };

  return { where: walk(node), params };
}

/** Identifiers are quoted, and anything but a plain column name is rejected. */
function ident(field: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(field)) {
    throw new Error(`Not a column name: ${field}`);
  }
  return `"${field}"`;
}

const stripWildcards = (s: string) => s.replace(/%/g, "");
