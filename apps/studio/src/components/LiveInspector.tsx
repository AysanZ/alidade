import type { Assets, MapProject } from "@alidade/core";
import { ago, assetCounts, formatSpeed, lastHeard } from "@alidade/core";

import { Field, Section, Switch } from "./Field";

/**
 * The selection id the live layer answers to.
 *
 * The tree selects by id and every other row's id comes from the document. This
 * one is a constant because the live layer is not in the tree: there is one of
 * it, it cannot be renamed and it cannot be removed. It is prefixed like the
 * engine layers it compiles to so it can never collide with a layer somebody
 * imported.
 */
export const LIVE_ID = "chrome:assets";

/** Re-exported so the tree can take the state without importing the hook. */
export type FeedState = "off" | "connecting" | "live" | "retrying" | "failed";

export interface FeedReading {
  state: FeedState;
  since: number | null;
  attempts: number;
  retryAt: number | null;
  message: string | null;
}

/**
 * What the live layer is doing, and the handful of choices about it.
 *
 * The panel opens with the state of the connection rather than with the
 * styling, which is the reverse of every other inspector here and is right for
 * this one: when a live layer is wrong, it is almost never wrong about its
 * colour. The first question is always whether anything is arriving.
 */
export function LiveInspector({
  project,
  edit,
  feed,
  onClear,
  onZoomTo,
}: {
  project: MapProject;
  edit: (change: (draft: MapProject) => MapProject) => void;
  feed: FeedReading;
  onClear: () => void;
  onZoomTo: () => void;
}) {
  const assets = project.assets;
  if (!assets) return null;

  const set = (change: (a: Assets) => void) =>
    edit((draft) => {
      if (draft.assets) change(draft.assets);
      return draft;
    });

  const { total, stale } = assetCounts(assets);
  const heard = lastHeard(assets.items);

  return (
    <aside className="inspector">
      <div className="phead">
        <span className="cap">Live assets</span>
        <span className="tag">{total}</span>
      </div>

      <div className="pbody">
        {feed.state === "failed" && (
          <p className="warn">
            {feed.message ?? "The feed could not be reached."} Check that the API is running and
            that the address below is right, then switch the feed off and on again.
          </p>
        )}

        <Section title="Feed">
          <Switch
            label="Connected"
            on={assets.enabled}
            onChange={(on) => set((a) => void (a.enabled = on))}
          />
          <Field label="State">
            <span className="feedstate">
              <span className={`dot ${feed.state}`} />
              <span className="muted small">{describe(feed)}</span>
            </span>
          </Field>
          <Field label="Address">
            <input
              className="text"
              type="text"
              value={assets.url}
              spellCheck={false}
              aria-label="Feed address"
              onChange={(e) => set((a) => void (a.url = e.target.value))}
            />
          </Field>
          {/*
            Two different silences, said separately. The socket being open is
            not the same as data arriving, and a feed that connected an hour ago
            and has sent nothing since is the failure a connection light misses.
          */}
          <Field label="Last heard">
            <span className="muted small">
              {heard === null ? "nothing yet" : ago(Date.now() - heard)}
            </span>
          </Field>
          <div className="row buttons">
            <button onClick={onZoomTo} disabled={total === 0}>
              Zoom to assets
            </button>
            <button onClick={onClear} disabled={total === 0}>
              Clear
            </button>
          </div>
        </Section>

        <Section title="Drawing">
          <Switch
            label="Visible"
            on={assets.visible}
            onChange={(on) => set((a) => void (a.visible = on))}
          />
          <Field label="Opacity" value={`${Math.round(assets.opacity * 100)}%`}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(assets.opacity * 100)}
              onChange={(e) => set((a) => void (a.opacity = Number(e.target.value) / 100))}
            />
          </Field>
          <Field label="Colour">
            <input
              type="color"
              value={assets.color}
              aria-label="Asset colour"
              onChange={(e) => set((a) => void (a.color = e.target.value))}
            />
          </Field>
          <Switch
            label="Group where they crowd"
            on={assets.cluster}
            onChange={(on) => set((a) => void (a.cluster = on))}
          />
          <Switch
            label="Show names"
            on={assets.labels}
            onChange={(on) => set((a) => void (a.labels = on))}
          />
          <Switch
            label="Show heading"
            on={assets.heading}
            onChange={(on) => set((a) => void (a.heading = on))}
          />
        </Section>

        <Section title="Staleness" extra={stale > 0 ? `${stale} old` : undefined}>
          <p className="hint">
            An asset that has not reported for this long is drawn hollow and grey. It is not
            removed: the map knows the reports stopped, not that the asset did.
          </p>
          <Field label="Quiet after" value={`${assets.staleAfter}s`}>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={assets.staleAfter}
              onChange={(e) => set((a) => void (a.staleAfter = Number(e.target.value)))}
            />
          </Field>
        </Section>

        {total > 0 && (
          <Section title="Reporting" open={false} extra={String(total)}>
            <ul className="assets">
              {assets.items.slice(0, 60).map((asset) => (
                <li key={asset.id} className={asset.stale ? "stale" : ""}>
                  <span className="name">{asset.label ?? asset.id}</span>
                  <span className="muted small">
                    {asset.speed === undefined ? "" : `${formatSpeed(asset.speed)} · `}
                    {ago(Date.now() - asset.updated)}
                  </span>
                </li>
              ))}
            </ul>
            {total > 60 && <p className="hint">and {total - 60} more.</p>}
          </Section>
        )}
      </div>
    </aside>
  );
}

function describe(feed: FeedReading): string {
  switch (feed.state) {
    case "off":
      return "switched off";
    case "connecting":
      return "connecting";
    case "live":
      return feed.since ? `receiving, open ${ago(Date.now() - feed.since)}` : "receiving";
    case "retrying":
      return feed.retryAt
        ? `dropped, retrying in ${Math.max(0, Math.round((feed.retryAt - Date.now()) / 1000))}s`
        : "dropped, retrying";
    case "failed":
      return `gave up after ${feed.attempts} attempts`;
  }
}
