import type { JSX } from "react";

export interface MapActions {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  locate: () => void;
  fullscreen: () => void;
}

const ICON: Record<string, JSX.Element> = {
  in: <path d="M12 6v12M6 12h12" />,
  out: <path d="M6 12h12" />,
  north: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5 14.5 15 12 13.5 9.5 15 12 7.5Z" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3" />
    </>
  ),
  full: <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />,
};

const BUTTONS: { id: keyof MapActions; icon: keyof typeof ICON; label: string }[] = [
  { id: "zoomIn", icon: "in", label: "Zoom in" },
  { id: "zoomOut", icon: "out", label: "Zoom out" },
  { id: "resetNorth", icon: "north", label: "Reset north" },
  { id: "locate", icon: "locate", label: "Go to my location" },
  { id: "fullscreen", icon: "full", label: "Full screen" },
];

export function MapControls({ actions }: { actions: MapActions }) {
  return (
    <div className="mapcontrols">
      {BUTTONS.map((b) => (
        <button key={b.id} title={b.label} aria-label={b.label} onClick={actions[b.id]}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICON[b.icon]}
          </svg>
        </button>
      ))}
    </div>
  );
}
