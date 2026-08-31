import type { JSX } from "react";

export interface MapActions {
  zoomIn: () => void;
  zoomOut: () => void;
  resetNorth: () => void;
  locate: () => void;
  fullscreen: () => void;
  present: () => void;
  lockZoom: () => void;
  lockPan: () => void;
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
  present: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M12 16.5V21M8.5 21h7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  hand: (
    <>
      <path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2.4-3.2a1.5 1.5 0 0 1 2.3-1.9L9 14.5V8a1.5 1.5 0 0 1 3 0" />
    </>
  ),
};

const BUTTONS: { id: keyof MapActions; icon: keyof typeof ICON; label: string }[] = [
  { id: "zoomIn", icon: "in", label: "Zoom in" },
  { id: "zoomOut", icon: "out", label: "Zoom out" },
  { id: "resetNorth", icon: "north", label: "Reset north" },
  { id: "locate", icon: "locate", label: "Go to my location" },
  { id: "lockZoom", icon: "lock", label: "Lock zoom" },
  { id: "lockPan", icon: "hand", label: "Lock panning" },
  { id: "present", icon: "present", label: "Presentation mode" },
  { id: "fullscreen", icon: "full", label: "Full screen" },
];

export function MapControls({
  actions,
  locks,
  presenting,
}: {
  actions: MapActions;
  locks: { zoom: boolean; pan: boolean };
  presenting: boolean;
}) {
  /** The three toggles say what they are, rather than what they would do. */
  const isOn = (id: keyof MapActions) =>
    (id === "lockZoom" && locks.zoom) ||
    (id === "lockPan" && locks.pan) ||
    (id === "present" && presenting);

  return (
    <div className="mapcontrols">
      {BUTTONS.map((b) => (
        <button
          key={b.id}
          className={isOn(b.id) ? "on" : ""}
          title={b.label}
          aria-label={b.label}
          aria-pressed={isOn(b.id)}
          onClick={actions[b.id]}
        >
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
