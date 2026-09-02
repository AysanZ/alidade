import { useState } from "react";
import type { FilterNode, FilterValue, LayerNode } from "@alidade/core";
import { toSql } from "@alidade/core";

import {
  OPERATORS,
  isComplex,
  displayValue,
  rebuild,
  takesOf,
  toFilter,
  toRules,
  withValue,
  type Comparison,
} from "../filterRules";
import { Field, Section } from "./Field";

/**
 * Building a filter.
 *
 * The compiler for this has been in `packages/core` since the beginning, with
 * tests, and the reconciler has always honoured `node.filter` — there was simply
 * no way in the interface to write one. A tested capability with no door is
 * worse than one that was never built, because it looks finished.
 *
 * The editor is deliberately a flat list of rules joined by one connective
 * rather than a tree. The document's `FilterNode` nests arbitrarily and the
 * compiler handles that, so a filter written elsewhere still works; but a
 * nesting editor in a 290px panel is a worse tool than a list, and almost every
 * filter anyone actually writes is "these three things, all true".
 */

export function FilterEditor({
  layer,
  edit,
}: {
  layer: LayerNode;
  edit: (change: (node: LayerNode) => void) => void;
}) {
  const fields = layer.metadata?.fields ?? [];
  const { join, rules } = toRules(layer.filter);
  const complex = isComplex(layer.filter);
  const [showSql, setShowSql] = useState(false);

  const write = (nextJoin: "and" | "or", nextRules: Comparison[]) =>
    edit((node) => {
      const next = toFilter(nextJoin, nextRules);
      if (next) node.filter = next;
      else delete node.filter;
    });

  const change = (index: number, next: Comparison) =>
    write(
      join,
      rules.map((rule, i) => (i === index ? next : rule)),
    );

  if (fields.length === 0) {
    return (
      <Section title="Filter">
        <p className="hint">
          This layer has no recorded columns, so there is nothing to filter on. Layers imported
          through Add data carry their columns; one added by hand may not.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Filter" extra={rules.length > 0 ? String(rules.length) : undefined}>
      {complex && (
        <p className="warn">
          This layer carries a filter with nesting that this editor cannot show. It is still being
          applied. Editing here will replace it.
        </p>
      )}

      {rules.length > 1 && (
        <Field label="Match">
          <div className="seg">
            {(["and", "or"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={join === option ? "on" : ""}
                onClick={() => write(option, rules)}
              >
                {option === "and" ? "All of these" : "Any of these"}
              </button>
            ))}
          </div>
        </Field>
      )}

      <ul className="rules">
        {rules.map((rule, index) => {
          const takes = takesOf(rule.op);
          return (
            <li key={index}>
              <select
                value={rule.field}
                aria-label="Column"
                onChange={(e) => change(index, { ...rule, field: e.target.value } as Comparison)}
              >
                {fields.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              <select
                value={rule.op}
                aria-label="Test"
                onChange={(e) =>
                  change(index, rebuild(rule, e.target.value as Comparison["op"]))
                }
              >
                {OPERATORS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>

              {takes !== "none" && (
                <input
                  type="text"
                  className="text"
                  aria-label="Value"
                  placeholder={takes === "list" ? "a, b, c" : "value"}
                  value={displayValue(rule)}
                  onChange={(e) => change(index, withValue(rule, e.target.value))}
                />
              )}

              <button
                className="danger"
                title="Remove this rule"
                aria-label="Remove this rule"
                onClick={() => write(join, rules.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="row buttons">
        <button
          onClick={() =>
            write(join, [...rules, { op: "=", field: fields[0]!, value: "" } as Comparison])
          }
        >
          Add a rule
        </button>
        {rules.length > 0 && (
          <button className="danger" onClick={() => write(join, [])}>
            Clear
          </button>
        )}
      </div>

      {layer.filter && (
        <>
          <div className="row buttons">
            <button className={showSql ? "on" : ""} onClick={() => setShowSql((was) => !was)}>
              {showSql ? "Hide the SQL" : "Show the SQL"}
            </button>
          </div>
          {showSql && <Sql filter={layer.filter} />}
        </>
      )}

      <p className="hint">
        The filter is a structure, not a string, so the same one compiles two ways: to a renderer
        expression that hides features on the map, and to parameterised SQL for the server. Nothing
        typed here is ever concatenated into a query.
      </p>
    </Section>
  );
}

/**
 * The SQL the same filter compiles to.
 *
 * Shown because it is the honest answer to "what is this actually doing", and
 * because seeing the placeholders is the quickest way to believe the claim that
 * values are bound rather than pasted in.
 */
function Sql({ filter }: { filter: FilterNode }) {
  let text: string;
  try {
    const { where, params } = toSql(filter);
    text = `WHERE ${where}\n-- ${params.length === 0 ? "no parameters" : params.map((p, i) => `$${i + 1} = ${JSON.stringify(p)}`).join(", ")}`;
  } catch (error) {
    // `toSql` refuses a column name it will not quote, which is a fact worth
    // showing rather than a crash worth hiding.
    text = error instanceof Error ? error.message : String(error);
  }
  return <pre className="sql">{text}</pre>;
}

