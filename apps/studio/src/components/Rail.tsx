export type PaneId = "layers" | "basemaps" | "scene" | "project";

const PANES: { id: PaneId; label: string; icon: string }[] = [
  { id: "layers", label: "Layers", icon: "M12 3 3 8l9 5 9-5-9-5ZM3 14l9 5 9-5" },
  {
    id: "basemaps",
    label: "Basemaps",
    icon: "M3.5 12h17M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.3-3.6-8.5S9.6 5.8 12 3.5Z",
  },
  { id: "scene", label: "Scene", icon: "M2 19h20L15 8l-4 6-2.5-3L2 19Z" },
  { id: "project", label: "Project", icon: "M5 4.5h9L19 9v10.5H5v-15ZM14 4.5V9h5" },
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d={p.icon} />
            {p.id === "basemaps" && <circle cx="12" cy="12" r="8.5" />}
          </svg>
        </button>
      ))}
    </nav>
  );
}
