import { useState, type ReactNode } from "react";

/**
 * The form atoms every panel is built from.
 *
 * They exist so the panels do not each invent their own row: change the shape
 * here and the whole sidebar follows, which is what happened when the panels
 * were brought in line with `docs/mockup.html`.
 */

/** A labelled row: name on the left, control in the middle, reading on the right. */
export function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      {children}
      {value !== undefined && <b className="num">{value}</b>}
    </div>
  );
}

/**
 * A checkbox with its label.
 *
 * The whole row is the hit target, because a 12px box is a small thing to ask
 * someone to aim at.
 */
export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="chk">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * One of a small set of choices, side by side.
 *
 * A select for three options hides two of them behind a click. This is the
 * mockup's segmented control, and it is what the panels use wherever the whole
 * set fits across the panel.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="seg" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "on" : ""}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A titled group of rows that can be folded away.
 *
 * The panels are long — Appearance alone can run to four screens — and a heading
 * that is only a heading leaves no way to get past it. Open by default, because
 * a panel that starts collapsed hides the thing the user came for.
 */
export function Section({
  title,
  children,
  open: initiallyOpen = true,
  extra,
}: {
  title: string;
  children: ReactNode;
  /** Start folded. For sections that are reference rather than work. */
  open?: boolean;
  /** A count or a tag, shown at the end of the heading. */
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  return (
    <section className={`sect${open ? "" : " closed"}`}>
      <button className="shead" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="cap">{title}</span>
        {extra !== undefined && <span className="tag">{extra}</span>}
      </button>
      <div className="sbody">{children}</div>
    </section>
  );
}
