import { useState, type ReactNode } from "react";

/**
 * What an empty install could do next.
 *
 * A fresh Alidade opens on a database with nothing in it, and "the database is
 * empty" is true but unhelpful — it says what is missing without saying what the
 * thing is for. These are the capabilities worth knowing about on the first
 * afternoon, each one click from here.
 *
 * They are suggestions and not a tour: every card has a cross, the whole set has
 * a cross, and once dismissed they stay dismissed. A prompt that cannot be got
 * rid of stops being help and becomes furniture.
 */

export interface Suggestion {
  id: string;
  title: string;
  blurb: string;
  /** What the button says. An imperative, because it does the thing. */
  action: string;
  onAction: () => void;
}

/*
 * Kept out of React state on purpose. Which prompts someone has already waved
 * away is a fact about the person and not about the map, so it does not belong
 * in the project document, in the undo history or in an export.
 */
const KEY = "alidade.suggestions.dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private browsing, a full quota, a corrupted value. None of them is worth
    // a broken panel; the worst case is being offered a card twice.
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* see above */
  }
}

export function Suggestions({ items }: { items: Suggestion[] }): ReactNode {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const drop = (ids: string[]) => {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    writeDismissed(next);
  };

  const showing = items.filter((item) => !dismissed.includes(item.id));
  if (!showing.length) return null;

  return (
    <section className="suggestions">
      <header>
        <span className="cap">Worth a look</span>
        <button
          className="dismissall"
          onClick={() => drop(items.map((item) => item.id))}
          title="Hide all of these"
        >
          Hide these
        </button>
      </header>

      <ul>
        {showing.map((item) => (
          <li key={item.id}>
            <button
              className="dismiss"
              onClick={() => drop([item.id])}
              aria-label={`Hide ${item.title}`}
              title="Hide this one"
            >
              ✕
            </button>
            <b>{item.title}</b>
            <p>{item.blurb}</p>
            <button className="try" onClick={item.onAction}>
              {item.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
