import { useEffect, useRef } from "react";
import type { MapProject, MotionFrames } from "@alidade/core";
import { drivenBy, followers, motionFor, rememberFrames } from "@alidade/core";
import type { ThreeModelHost } from "@alidade/three";

/**
 * 3D models standing in for live assets.
 *
 * The models are moved straight in the host and never through the document,
 * which is the same rule the tracks follow and for the same reason: sixty
 * placements a second would be sixty history steps, sixty autosaves, and an
 * undo stack that reaches back one second. The document says which asset a
 * model is standing in for; where it is at this instant is a function of what
 * has arrived, and what has arrived is not part of the map.
 *
 * The loop only runs while something is actually being followed. A scene with
 * no followers costs nothing, not even a cancelled frame.
 */
export function useLiveModels(
  project: MapProject,
  host: React.RefObject<ThreeModelHost | null>,
  map: React.RefObject<{ triggerRepaint: () => void; getZoom: () => number } | null>,
) {
  /*
   * The last two reports per asset, and when each landed.
   *
   * A ref rather than state on purpose. It changes once a second per asset and
   * nothing renders from it — the models are drawn by the host, not by React —
   * so making it state would re-render the whole application for a number no
   * component reads.
   */
  const frames = useRef<Map<string, MotionFrames>>(new Map());

  /*
   * The document, read by the loop without being a dependency of it.
   *
   * The loop must see the current models and the current positions, and it must
   * not be torn down and rebuilt every time a position arrives — which is what
   * depending on `project` would do, once a second, for ever.
   */
  const latest = useRef(project);
  latest.current = project;

  const items = project.assets?.items;
  const following = followers(project.models?.items).length;

  /* New reports in, previous ones kept, so there is something to move between. */
  useEffect(() => {
    if (!items) return;
    frames.current = rememberFrames(frames.current, items, Date.now());
  }, [items]);

  useEffect(() => {
    if (following === 0) return;
    let frame = 0;

    const step = () => {
      const scene = host.current;
      const now = Date.now();
      /*
       * A 3D scene is not drawn at all while the map is a sphere, and the feed
       * clusters precisely at the zooms where a fleet is a crowd. So a model
       * does not replace its dot: it stands in for it from `fromZoom` in, and
       * below that the dot is what is on the map. Asking the host to place a
       * model nobody can see is work for nothing, every frame.
       */
      const zoom = map.current?.getZoom() ?? 0;

      if (scene) {
        for (const model of followers(latest.current.models?.items)) {
          const from = model.follow?.fromZoom;
          if (from !== undefined && zoom < from) continue;
          const motion = motionFor(model, frames.current, now);
          // Null is an answer: an asset that has not reported has no position,
          // and the model stays where the document put it rather than being
          // sent to the origin because a lookup missed.
          if (motion) scene.update(drivenBy(model, motion));
        }
      }

      map.current?.triggerRepaint();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      /*
       * Put every follower back where the document says it is. What was only
       * ever a frame must not survive into a save, and a model left at the last
       * interpolated position would be exactly that.
       */
      const scene = host.current;
      for (const model of followers(latest.current.models?.items)) scene?.update(model);
      map.current?.triggerRepaint();
    };
  }, [following, host, map]);
}
