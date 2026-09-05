/**
 * A model that moves.
 *
 * The track is in the document — a path, a duration, whether it repeats — and
 * the position at this instant is not. That is the same line the drawing tools
 * draw: the rubber band to the cursor is a function of where the mouse is and
 * the mouse is not part of the map. A moving lorry at sixty frames a second
 * would otherwise be sixty edits a second, which is sixty history steps, sixty
 * autosaves and an undo stack that can only take you back a second.
 *
 * So this is arithmetic and nothing else. The application asks where the model
 * is at a moment and hands the answer straight to the renderer.
 */

import { bearing, distance } from "./measure";
import { offset } from "./annotate";
import type { Model3D, Track } from "./types/project";

export interface TrackSample {
  position: [number, number];
  /** Degrees clockwise from north, along the direction of travel. */
  heading: number;
}

/**
 * Cumulative distance to each vertex, in metres, starting at zero.
 *
 * This is what makes the motion honest. Interpolating between vertices by
 * index instead moves the model a whole vertex per equal slice of time, so it
 * crawls along a long straight and then bolts through a cluster of closely
 * spaced points — the speed jumps at every vertex, and a route traced with a
 * dense corner and a sparse straight is exactly the shape that shows it.
 */
export function stations(path: [number, number][]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    out.push(out[i - 1]! + distance(path[i - 1]!, path[i]!));
  }
  return out;
}

/** How long the path is on the ground, in metres. */
export function trackLength(path: [number, number][]): number {
  const marks = stations(path);
  return marks[marks.length - 1] ?? 0;
}

/**
 * Where you are after travelling a given distance along the path.
 *
 * Between two vertices the position is walked out along the great circle
 * rather than mixed in degrees, for the reason a dragged polygon is rotated
 * about the sphere rather than shifted: degrees are not a distance, and a
 * midpoint found by averaging them is not the middle of the journey.
 */
export function sampleAt(path: [number, number][], metres: number): TrackSample | null {
  if (path.length === 0) return null;
  if (path.length === 1) return { position: path[0]!, heading: 0 };

  const marks = stations(path);
  const total = marks[marks.length - 1]!;
  // A path of coincident points has no direction and no length to divide by.
  if (total === 0) return { position: path[0]!, heading: 0 };

  const travelled = Math.min(Math.max(metres, 0), total);

  let leg = 1;
  while (leg < marks.length - 1 && marks[leg]! < travelled) leg++;

  const from = path[leg - 1]!;
  const to = path[leg]!;
  const into = travelled - marks[leg - 1]!;
  const heading = bearing(from, to);

  return { position: into === 0 ? from : offset(from, into, heading), heading };
}

/** The same, given a fraction of the whole path rather than a distance. */
export function sampleTrack(path: [number, number][], fraction: number): TrackSample | null {
  return sampleAt(path, trackLength(path) * fraction);
}

/**
 * Where a track's model is, this many seconds after it set off.
 *
 * A track that does not repeat holds at its last point rather than vanishing,
 * because a lorry that has arrived is parked, not gone.
 */
export function trackAt(track: Track, elapsedSeconds: number): TrackSample | null {
  if (track.duration <= 0) return sampleTrack(track.path, 0);
  const passes = elapsedSeconds / track.duration;
  const fraction = track.loop ? passes - Math.floor(passes) : Math.min(Math.max(passes, 0), 1);
  return sampleTrack(track.path, fraction);
}

/**
 * The placement, moved.
 *
 * `headingOffset` is for a file whose front is not its own +z, which is most of
 * them: a model that drives sideways down the road is not a bug in the track.
 */
export function movedAlong(model: Model3D, sample: TrackSample, track: Track): Model3D {
  return {
    ...model,
    position: sample.position,
    heading: track.faceForward
      ? (sample.heading + (track.headingOffset ?? 0) + 360) % 360
      : model.heading,
  };
}

/** Metres per second, for the panel to say out loud. */
export function speedOf(track: Track): number {
  return track.duration > 0 ? trackLength(track.path) / track.duration : 0;
}

export function newTrack(id: string, model: string, path: [number, number][]): Track {
  return {
    id,
    model,
    path,
    // A minute a lap is slow enough to watch and quick enough not to wait.
    duration: 60,
    loop: true,
    faceForward: true,
  };
}

export function findTrack(tracks: Track[] | undefined, model: string): Track | undefined {
  return (tracks ?? []).find((t) => t.model === model);
}
