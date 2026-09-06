import { useCallback, useEffect, useRef, useState } from "react";
import type { MapProject } from "@alidade/core";
import { APPROACH_SECONDS, approachFrame } from "@alidade/core";

/**
 * The landing demonstration.
 *
 * It is not a special case in the renderer and does not touch the models
 * directly. It writes `LiveAsset` reports into the live layer once a second,
 * exactly as a transponder would, and everything after that is the ordinary
 * pipeline: the reports are interpolated between, the attitude is derived from
 * consecutive ones, and a model that follows the asset is placed by the same
 * code that places one following a real feed.
 *
 * That is the point of doing it this way rather than animating an aeroplane. If
 * the landing looks right, the live pipeline is right, and the demonstration is
 * evidence rather than decoration. It also means the arrival can be paused,
 * inspected, followed by a different model, or pointed at a different runway
 * without any of that being built for it.
 */

/** One report a second, which is what a transponder gives you. */
const REPORT_MS = 1000;

export function useApproachDemo(
  transient: (change: (draft: MapProject) => MapProject) => void,
) {
  const [flying, setFlying] = useState(false);
  /** Seconds into the arrival, so the panel can show where it has got to. */
  const [at, setAt] = useState(0);

  const write = useRef(transient);
  write.current = transient;

  useEffect(() => {
    if (!flying) return;
    const started = Date.now();

    const report = () => {
      const seconds = (Date.now() - started) / 1000;
      setAt(Math.min(seconds, APPROACH_SECONDS));
      write.current((draft) => {
        if (!draft.assets) return draft;
        const frame = approachFrame(seconds, Date.now());
        const others = draft.assets.items.filter((a) => a.id !== frame.id);
        draft.assets = { ...draft.assets, items: [...others, frame] };
        return draft;
      });
      /*
       * Stopping at the end rather than looping. An aeroplane that lands and is
       * instantly back on the base leg is a cartoon; one that lands and stays
       * landed is an arrival, and the parked aeroplane at the end is a better
       * thing to leave on the screen than a loop nobody watches twice.
       */
      if (seconds >= APPROACH_SECONDS) setFlying(false);
    };

    report();
    const timer = setInterval(report, REPORT_MS);
    return () => clearInterval(timer);
  }, [flying]);

  const start = useCallback(() => {
    setAt(0);
    setFlying(true);
  }, []);

  const stop = useCallback(() => setFlying(false), []);

  return { flying, at, start, stop };
}
