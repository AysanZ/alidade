import { metresPerPixel, scaleBar, type Chrome } from "@alidade/core";

export interface Camera {
  zoom: number;
  latitude: number;
  bearing: number;
  pitch: number;
}

/** Scale bar and north arrow. Drawn by the application, not by the renderer. */
export function MapChrome({ chrome, camera }: { chrome: Chrome; camera: Camera }) {
  const bar = scaleBar(metresPerPixel(camera.zoom, camera.latitude), 120, chrome.scaleBar.units);

  return (
    <>
      {chrome.scaleBar.enabled && (
        <div className="scalebar">
          <span>{bar.label}</span>
          <i style={{ width: bar.width }} />
        </div>
      )}

      {chrome.northArrow && (
        <svg className="compass" viewBox="0 0 100 100" aria-label="North arrow">
          <g transform={`rotate(${-camera.bearing} 50 50)`}>
            {Array.from({ length: 24 }, (_, i) => {
              const angle = ((i * 15 - 90) * Math.PI) / 180;
              const major = i % 6 === 0;
              return (
                <line
                  key={i}
                  x1={50 + Math.cos(angle) * (major ? 33 : 37)}
                  y1={50 + Math.sin(angle) * (major ? 33 : 37)}
                  x2={50 + Math.cos(angle) * 42}
                  y2={50 + Math.sin(angle) * 42}
                  stroke={major ? "#9a9aa0" : "#34343a"}
                  strokeWidth={major ? 1.4 : 1}
                />
              );
            })}
            <path d="M 50 16 L 57 52 L 50 46 L 43 52 Z" fill="#4c8dff" />
            <path d="M 50 84 L 43 48 L 50 54 L 57 48 Z" fill="#34343a" />
            <text x="50" y="12" textAnchor="middle" fill="#9a9aa0" fontSize="11">
              N
            </text>
          </g>
        </svg>
      )}
    </>
  );
}
