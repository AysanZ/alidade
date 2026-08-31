import type { JSX } from "react";

export type PaneId = "layers" | "basemaps" | "scene" | "draw" | "project";

/**
 * Drawn rather than imported: four icons is not worth a dependency.
 *
 * They are set on a 24 unit grid but drawn at 18, so the stroke is deliberately
 * heavy and there is no hairline detail. Anything thinner reads as a smudge at
 * this size, which is what a 1.5 stroke on a 16 pixel icon was doing.
 */
const ICONS: Record<PaneId, JSX.Element> = {
  layers: (
    <>
      <path d="M12 3.5 3.5 8l8.5 4.5L20.5 8 12 3.5Z" />
      <path d="m3.5 13.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  basemaps: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.3-3.5-8.5s1.2-6.2 3.5-8.5Z" />
    </>
  ),
  scene: (
    <>
      <path d="M2.5 19h19L14.5 8.5l-3.5 5.5-2.5-3L2.5 19Z" />
      <circle cx="17" cy="5.5" r="2.5" />
    </>
  ),
  draw: (
    <>
      <path d="M4 20.5 5 16l10.5-10.5a2.1 2.1 0 0 1 3 3L8 19l-4 1.5Z" />
      <path d="m13.5 7.5 3 3" />
    </>
  ),
  project: (
    <>
      <path d="M13.5 3.5H6.5A1.5 1.5 0 0 0 5 5v14a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
    </>
  ),
};

const PANES: { id: PaneId; label: string }[] = [
  { id: "layers", label: "Layers" },
  { id: "basemaps", label: "Basemaps" },
  { id: "scene", label: "Scene" },
  { id: "draw", label: "Draw and measure" },
  { id: "project", label: "Project" },
];

export function Rail({ active, onSelect }: { active: PaneId; onSelect: (id: PaneId) => void }) {
  return (
    <nav className="rail">
      {PANES.map((p) => (
        <button
          key={p.id}
          className={p.id === active ? "on" : ""}
          title={p.label}
          aria-label={p.label}
          aria-pressed={p.id === active}
          onClick={() => onSelect(p.id)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[p.id]}
          </svg>
        </button>
      ))}
    </nav>
  );
}
