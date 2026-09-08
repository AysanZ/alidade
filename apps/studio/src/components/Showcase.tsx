import { useState, type ReactNode } from "react";

/**
 * What Alidade can do, shown rather than listed.
 *
 * Most of what is interesting here is invisible from a map of country outlines:
 * nothing on that screen suggests the buildings can stand up, or that an
 * aeroplane can fly an approach with its attitude taken from the track. Somebody
 * who opens the project for the first time has no way to find those out short of
 * reading the source.
 *
 * So each card carries a small drawing of what it does. Not a screenshot — a
 * screenshot goes stale the first time the palette changes and is a lie about
 * this install's data. A schematic is honest about being a schematic and still
 * answers the only question that matters: what am I about to turn on.
 *
 * Every card has a cross, the set has a cross, and dismissal sticks. A prompt
 * that cannot be got rid of stops being help and becomes furniture.
 */

export interface Showpiece {
  id: string;
  title: string;
  blurb: string;
  action: string;
  onAction: () => void;
  preview: ReactNode;
}

/*
 * Which prompts somebody has waved away is a fact about the person, not about
 * the map, so it stays out of the document, the undo history and the export.
 */
const KEY = "alidade.showcase.dismissed";

function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private browsing, a full quota, a corrupted value. The worst case is
    // being offered a card twice, which is not worth a broken panel.
    return [];
  }
}

export function Showcase({ items }: { items: Showpiece[] }) {
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const drop = (ids: string[]) => {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* see above */
    }
  };

  const showing = items.filter((item) => !dismissed.includes(item.id));
  if (!showing.length) return null;

  return (
    <section className="showcase">
      <header>
        <span className="cap">Try one of these</span>
        <button className="hideall" onClick={() => drop(items.map((i) => i.id))}>
          Hide
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
            <button className="shot" onClick={item.onAction} tabIndex={-1} aria-hidden>
              {item.preview}
            </button>
            <div className="words">
              <b>{item.title}</b>
              <p>{item.blurb}</p>
              <button className="try" onClick={item.onAction}>
                {item.action}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ previews
 *
 * Each one is a 96×62 schematic in the application's own colours, so the strip
 * reads as part of the interface rather than as pasted-in artwork.
 */

const FRAME = { viewBox: "0 0 96 62", width: "96", height: "62" } as const;

export const previews = {
  landing: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* The runway in perspective, and the glide path down to its threshold. */}
      <path d="M34 62 L44 34 L56 34 L74 62 Z" fill="#2a2a2e" />
      <path d="M45 60 L48.5 36 M51 60 L51.5 36" stroke="#4a4a50" strokeWidth="1" />
      <path d="M92 12 L52 35" stroke="#4c8dff" strokeWidth="1" strokeDasharray="3 3" />
      <g transform="translate(88 14) rotate(28)">
        <path d="M0 0 L-9 3 L-9 -3 Z" fill="#e4e4e6" />
        <path d="M-5 0 L-7 7 M-5 0 L-7 -7" stroke="#e4e4e6" strokeWidth="1.6" />
      </g>
      <circle cx="52" cy="35" r="2.5" fill="none" stroke="#38d6c0" strokeWidth="1" />
    </svg>
  ),

  buildings: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* Extruded blocks with one sunlit face and one in shade, and the shadows
          they throw — which is the whole point of the feature. */}
      <g>
        <path d="M18 50 L36 56 L36 40 L18 34 Z" fill="#1b1b20" />
        <path d="M36 40 L48 34 L48 50 L36 56 Z" fill="#2e2e36" />
        <path d="M18 34 L30 28 L48 34 L36 40 Z" fill="#3b3b45" />
      </g>
      <g>
        <path d="M50 54 L64 58 L64 30 L50 26 Z" fill="#1b1b20" />
        <path d="M64 30 L76 25 L76 53 L64 58 Z" fill="#2e2e36" />
        <path d="M50 26 L62 21 L76 25 L64 30 Z" fill="#3b3b45" />
      </g>
      <path d="M36 56 L14 60 M64 58 L44 62" stroke="#000" strokeOpacity=".55" strokeWidth="5" />
      <circle cx="84" cy="12" r="4" fill="#e8b14c" opacity=".85" />
    </svg>
  ),

  live: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* A track, a moving asset on it, and one that has gone quiet — drawn
          hollow rather than deleted. */}
      <path d="M8 46 C28 46 30 18 50 18 S76 40 90 30" stroke="#232328" strokeWidth="1.5" fill="none" />
      <circle cx="50" cy="18" r="4" fill="#38d6c0" />
      <circle cx="50" cy="18" r="8" fill="none" stroke="#38d6c0" strokeWidth="1" opacity=".35" />
      <circle cx="22" cy="42" r="3.5" fill="#38d6c0" opacity=".7" />
      <circle cx="82" cy="33" r="3.5" fill="none" stroke="#66666d" strokeWidth="1.4" />
      <text x="8" y="14" fill="#66666d" fontSize="7" fontFamily="IBM Plex Mono, monospace">
        ws://
      </text>
    </svg>
  ),

  globe: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* A sphere with real meridians, not a circle with lines across it. */}
      <circle cx="48" cy="31" r="23" fill="#111418" stroke="#2a2a30" strokeWidth="1" />
      <ellipse cx="48" cy="31" rx="23" ry="8" fill="none" stroke="#2a2a30" strokeWidth=".8" />
      <ellipse cx="48" cy="31" rx="23" ry="17" fill="none" stroke="#232328" strokeWidth=".8" />
      <ellipse cx="48" cy="31" rx="8" ry="23" fill="none" stroke="#2a2a30" strokeWidth=".8" />
      <ellipse cx="48" cy="31" rx="17" ry="23" fill="none" stroke="#232328" strokeWidth=".8" />
      <path
        d="M38 20 C44 17 52 20 54 26 C56 32 50 38 44 36 C38 34 36 26 38 20 Z"
        fill="#2f3a2c"
        opacity=".9"
      />
      <path d="M56 38 C62 36 66 40 64 44 C61 48 55 45 56 38 Z" fill="#2f3a2c" opacity=".7" />
    </svg>
  ),

  models: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* Points on a layer, each one standing a model up on the ground. */}
      <path d="M6 46 L90 34" stroke="#232328" strokeWidth="1" strokeDasharray="2 3" />
      {[
        [22, 44],
        [48, 40],
        [74, 36],
      ].map(([x, y], n) => (
        <g key={n} transform={`translate(${x} ${y})`}>
          <ellipse cx="0" cy="2" rx="7" ry="2.5" fill="#000" fillOpacity=".5" />
          <path d="M-5 1 L0 -12 L5 1 Z" fill="#3b3b45" />
          <path d="M0 -12 L5 1 L0 3 Z" fill="#2a2a32" />
          <circle cx="0" cy="-14" r="1.6" fill="#4c8dff" />
        </g>
      ))}
      <text x="6" y="12" fill="#66666d" fontSize="7" fontFamily="IBM Plex Mono, monospace">
        glTF
      </text>
    </svg>
  ),

  imagery: (
    <svg {...FRAME}>
      <rect width="96" height="62" fill="#0b0d0e" />
      {/* Overlapping scenes, one of them the rotated quadrilateral a satellite
          footprint actually is. */}
      <rect x="10" y="12" width="52" height="38" fill="#3a4a2e" opacity=".85" />
      <polygon points="34,8 88,16 82,52 28,44" fill="#4a4530" opacity=".9" />
      <polygon
        points="34,8 88,16 82,52 28,44"
        fill="none"
        stroke="#38d6c0"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <rect x="10" y="12" width="52" height="38" fill="none" stroke="#66666d" strokeWidth=".8" />
      <rect x="24" y="26" width="30" height="4" fill="#55555a" transform="rotate(-4 39 28)" />
      <text x="8" y="59" fill="#66666d" fontSize="7" fontFamily="IBM Plex Mono, monospace">
        .tif
      </text>
    </svg>
  ),
};
