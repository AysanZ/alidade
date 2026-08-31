import type { MapProject } from "@alidade/core";

export function TitleBar({
  project,
  ops,
  edit,
}: {
  project: MapProject;
  ops: number;
  edit: (change: (draft: MapProject) => MapProject) => void;
}) {
  return (
    <header className="titlebar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="9" strokeWidth="1.6" />
          <path d="M12 1.5v21M1.5 12h21" strokeWidth="0.8" />
          <path d="m12 4.5 3 7.5-3 7.5-3-7.5 3-7.5Z" fill="currentColor" fillOpacity=".2" />
        </svg>
        <b>Alidade</b>
      </div>
      {/* The name is the user's, so it is an input rather than a label. */}
      <input
        className="doc"
        value={project.name}
        aria-label="Project name"
        placeholder="Untitled map"
        onChange={(e) =>
          edit((d) => {
            d.name = e.target.value;
            return d;
          })
        }
      />
      <span className="tag">schema {project.schema}</span>
      <div className="grow" />
      <span className="muted">{ops} operations this session</span>
      <button className="ghost">Share</button>
      <button className="primary">Save</button>
    </header>
  );
}
