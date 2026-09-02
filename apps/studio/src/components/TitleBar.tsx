import { useRef } from "react";
import type { MapProject } from "@alidade/core";

import type { History } from "../useProject";

export interface Props {
  project: MapProject;
  ops: number;
  edit: (change: (draft: MapProject) => MapProject) => void;
  history: History;
  /** When the document was last written to storage, or null if it never has been. */
  savedAt: number | null;
  onSave: () => void;
  onOpen: (text: string, filename: string) => void;
  onExport: () => void;
}

export function TitleBar({ project, ops, edit, history, savedAt, onSave, onOpen, onExport }: Props) {
  const file = useRef<HTMLInputElement>(null);

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

      {/*
        Undo and redo belong here rather than only on the keyboard. A tool whose
        only way back is a shortcut is a tool people are afraid to experiment in.
      */}
      <div className="steps">
        <button
          className="icon"
          onClick={history.undo}
          disabled={!history.canUndo}
          title="Undo · Ctrl+Z"
          aria-label="Undo"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 9h11a5 5 0 0 1 0 10h-6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 5 4 9l4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="icon"
          onClick={history.redo}
          disabled={!history.canRedo}
          title="Redo · Ctrl+Shift+Z"
          aria-label="Redo"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M20 9H9a5 5 0 0 0 0 10h6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m16 5 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="grow" />

      <span className="muted small" aria-live="polite">
        {savedAt ? `saved ${ago(savedAt)}` : "not saved yet"}
      </span>
      <span className="muted">{ops} operations this session</span>

      <button onClick={() => file.current?.click()}>Open…</button>
      <input
        ref={file}
        type="file"
        accept=".json,.alidade.json,application/json"
        hidden
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void chosen.text().then((text) => onOpen(text, chosen.name));
          e.target.value = "";
        }}
      />
      <button onClick={onExport}>Export</button>
      <button className="primary" onClick={onSave}>
        Save
      </button>
    </header>
  );
}

/** "just now", "4 minutes ago". Enough to answer "did that get written?". */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}
