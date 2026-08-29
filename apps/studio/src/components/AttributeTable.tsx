import { useEffect, useState } from "react";

import { readFeatures, type FeaturePage } from "../api";

/** The attribute table. Read-only until phase 6 makes editing write back. */
export function AttributeTable({
  layerId,
  title,
  onClose,
}: {
  layerId: string;
  title: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState<FeaturePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [order, setOrder] = useState<string | undefined>(undefined);
  const limit = 100;

  useEffect(() => {
    let live = true;
    setError(null);
    readFeatures(layerId, { limit, offset, order })
      .then((result) => live && setPage(result))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [layerId, offset, order]);

  return (
    <section className="dock">
      <header>
        <b>{title}</b>
        <span className="muted small">
          {page ? `${page.total.toLocaleString("en-US")} rows` : "loading"}
        </span>
        <div className="grow" />
        <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>
          Previous
        </button>
        <button
          onClick={() => setOffset(offset + limit)}
          disabled={!page || offset + limit >= page.total}
        >
          Next
        </button>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="tablewrap">
        {page && (
          <table>
            <thead>
              <tr>
                <th className="rownum">#</th>
                {page.fields.map((field) => (
                  <th key={field} onClick={() => setOrder(field)} title="Sort by this field">
                    {field}
                    {order === field && " ▾"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, i) => (
                <tr key={i}>
                  <td className="rownum">{offset + i + 1}</td>
                  {page.fields.map((field) => (
                    <td key={field} className={typeof row[field] === "number" ? "num" : ""}>
                      {row[field] === null ? <i>NULL</i> : String(row[field])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
