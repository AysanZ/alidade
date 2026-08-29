import type { MapProject, Op } from "@alidade/core";

import { Field, Section } from "./Field";

export function ProjectPanel({
  project,
  log,
  onExportImage,
}: {
  project: MapProject;
  log: Op[];
  onExportImage: () => void;
}) {
  const size = new Blob([JSON.stringify(project)]).size;

  const download = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.id}.alidade.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pane">
      <Section title="Document">
        <Field label="Name">
          <span className="muted small">{project.name}</span>
        </Field>
        <Field label="Schema">
          <span className="muted small">project/{project.schema}</span>
        </Field>
        <Field label="Size">
          <span className="muted small">{(size / 1024).toFixed(1)} KB of JSON</span>
        </Field>
        <p className="hint">
          The project holds no geometry. It says where the data lives and how to draw it, which is
          why saving and sharing are cheap.
        </p>
        <div className="row buttons">
          <button onClick={download}>Export project JSON</button>
          <button onClick={onExportImage}>Export map PNG</button>
        </div>
      </Section>

      <Section title="Last operations">
        <ol className="ops">
          {log.slice(0, 12).map((op, i) => (
            <li key={i}>
              <span>{op.t}</span>
              {"id" in op && <em>{op.id}</em>}
              {"key" in op && <em>{op.key}</em>}
            </li>
          ))}
          {log.length === 0 && <li className="muted">Nothing changed yet.</li>}
        </ol>
      </Section>
    </div>
  );
}
