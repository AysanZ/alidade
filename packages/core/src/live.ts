/**
 * A layer of things that are somewhere right now.
 *
 * Everything here is arithmetic on a list and a clock: no socket, no timers, no
 * browser. The client that owns the connection lives in the studio; what it
 * produces is a frame, and what a frame does to the document is decided here,
 * in Node, where it can be tested by handing it two lists and reading the third.
 *
 * The whole layer reaches the renderer as one geojson source. A position that
 * moved is therefore a `source.data` operation and nothing else — the layers
 * reading it are never taken down and put back, which is what would happen if
 * the source were replaced, and what makes the difference between a fleet that
 * moves and a fleet that flickers once a second.
 */

import type { FeatureCollection } from "./annotate";
import { offset } from "./annotate";
import { bearing, distance } from "./measure";
import type { Assets, LiveAsset, Model3D } from "./types/project";

export const assetsSourceId = () => "chrome:assets";
export const headingSourceId = () => "chrome:assets:heading";

/** Ids of the engine layers the live layer expands into, bottom first. */
export const ASSET_LAYER_IDS = [
  "chrome:assets:heading",
  "chrome:assets:cluster",
  "chrome:assets:count",
  "chrome:assets:dot",
  "chrome:assets:label",
] as const;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/* ---------------------------------------------------------------- staleness */

/**
 * Whether an asset has been quiet for too long, at a given instant.
 *
 * The instant is a parameter rather than `Date.now()` so that a test can ask
 * about a moment rather than about now, and so that one sweep judges every
 * asset against the same clock.
 */
export function isStale(asset: LiveAsset, now: number, afterSeconds: number): boolean {
  if (!(afterSeconds > 0)) return false;
  return now - asset.updated > afterSeconds * 1000;
}

/**
 * Bring every `stale` flag in line with the clock.
 *
 * Returns the array it was given when nothing changed, which is not an
 * optimisation for its own sake: the sweep runs once a second forever, and an
 * array that is a new object every second is a document that is a new object
 * every second. The reconciler would find no difference and emit nothing, but
 * it would do the comparison, and React would re-render the sidebar, for a
 * feed that has not moved since the map was opened.
 */
export function markStale(items: LiveAsset[], now: number, afterSeconds: number): LiveAsset[] {
  let changed = false;
  const next = items.map((asset) => {
    const stale = isStale(asset, now, afterSeconds);
    if (stale === (asset.stale ?? false)) return asset;
    changed = true;
    return { ...asset, stale };
  });
  return changed ? next : items;
}

/* ---------------------------------------------------------------- frames */

/**
 * What one message from a feed means.
 *
 * `snapshot` is the whole world: anything not in it has gone. `update` is a
 * patch, which is what a feed of any size actually sends, because a fleet of
 * two thousand does not re-send two thousand positions to tell you one lorry
 * turned left. `remove` is the third thing a patch cannot say on its own.
 */
export type FeedFrame =
  | { kind: "snapshot"; assets: LiveAsset[] }
  | { kind: "update"; assets: LiveAsset[] }
  | { kind: "remove"; ids: string[] };

/**
 * Read a message off the wire, or decide it is not one.
 *
 * Defensive to the point of rudeness, and deliberately so: this is the only
 * place in the application where the input is written by somebody else's
 * server. A frame with one malformed asset in it loses that asset and keeps the
 * rest; a frame that is not a frame returns null and the socket carries on.
 * Throwing here would take down the map because a sensor sent a null latitude.
 */
export function parseFrame(raw: unknown, receivedAt = Date.now()): FeedFrame | null {
  const body = typeof raw === "string" ? safeParse(raw) : raw;
  if (!body || typeof body !== "object") return null;
  const message = body as Record<string, unknown>;

  const kind = typeof message["type"] === "string" ? message["type"] : "update";

  if (kind === "remove") {
    const ids = Array.isArray(message["ids"])
      ? message["ids"].filter((id): id is string => typeof id === "string")
      : [];
    return ids.length > 0 ? { kind: "remove", ids } : null;
  }

  /*
   * A feed that sends a bare array is sending a snapshot and has not said so.
   * Several do. Reading it as a patch would mean nothing is ever removed.
   */
  const list = Array.isArray(body)
    ? body
    : Array.isArray(message["assets"])
      ? (message["assets"] as unknown[])
      : null;
  if (!list) return null;

  const assets = list
    .map((entry) => parseAsset(entry, receivedAt))
    .filter((asset): asset is LiveAsset => asset !== null);

  if (kind === "snapshot" || Array.isArray(body)) return { kind: "snapshot", assets };
  return assets.length > 0 ? { kind: "update", assets } : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One asset off the wire.
 *
 * Both shapes are accepted — `{lon, lat}` and `{position: [lon, lat]}` — because
 * both are what feeds send, and a client that only reads one of them is a
 * client that works against exactly one server.
 */
function parseAsset(entry: unknown, receivedAt: number): LiveAsset | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;

  const id = typeof raw["id"] === "string" ? raw["id"] : String(raw["id"] ?? "");
  if (!id) return null;

  const pair = raw["position"];
  const lon = Array.isArray(pair) ? Number(pair[0]) : Number(raw["lon"] ?? raw["longitude"]);
  const lat = Array.isArray(pair) ? Number(pair[1]) : Number(raw["lat"] ?? raw["latitude"]);
  /*
   * A position that is not a position is the one thing that cannot be defaulted.
   * `Number(undefined)` is NaN and NaN reaches the renderer as a feature at the
   * origin, so a feed with one bad row grows an asset in the Gulf of Guinea.
   */
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const asset: LiveAsset = {
    id,
    position: [lon, lat],
    // A feed that does not stamp its own frames is stamped on arrival, which is
    // wrong by the flight time and right about the only thing staleness is for.
    updated: Number.isFinite(Number(raw["updated"])) ? Number(raw["updated"]) : receivedAt,
  };

  const heading = Number(raw["heading"] ?? raw["bearing"]);
  if (Number.isFinite(heading)) asset.heading = ((heading % 360) + 360) % 360;

  const speed = Number(raw["speed"]);
  if (Number.isFinite(speed) && speed >= 0) asset.speed = speed;

  if (typeof raw["label"] === "string") asset.label = raw["label"];
  else if (typeof raw["name"] === "string") asset.label = raw["name"];

  const extra = raw["properties"];
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    asset.properties = extra as LiveAsset["properties"];
  }

  return asset;
}

/**
 * The list after a frame has been applied to it.
 *
 * Order is held rather than rebuilt: an asset that was third stays third when
 * it moves. Otherwise every patch would shuffle the list, and a list that
 * shuffles is a list nobody can read while it updates.
 */
export function applyFrame(items: LiveAsset[], frame: FeedFrame): LiveAsset[] {
  if (frame.kind === "snapshot") return frame.assets;

  if (frame.kind === "remove") {
    const gone = new Set(frame.ids);
    return items.filter((asset) => !gone.has(asset.id));
  }

  const patch = new Map(frame.assets.map((asset) => [asset.id, asset]));
  const next = items.map((asset) => {
    const update = patch.get(asset.id);
    if (!update) return asset;
    patch.delete(asset.id);
    /*
     * A patch says what it knows. A frame carrying a position and no heading
     * means "it is here"; it does not mean "and it is now facing north", so the
     * fields it did not mention are kept rather than dropped.
     */
    return { ...asset, ...update, stale: false };
  });
  return [...next, ...patch.values()];
}

/**
 * The most recent moment any asset reported, or null for an empty list.
 *
 * What the status line reads to say how long the feed has been quiet, which is
 * a different question from whether the socket is open: a connected feed that
 * has sent nothing for five minutes is the failure this catches and a
 * connection light does not.
 */
export function lastHeard(items: LiveAsset[]): number | null {
  let latest: number | null = null;
  for (const asset of items) {
    if (latest === null || asset.updated > latest) latest = asset.updated;
  }
  return latest;
}

/* ---------------------------------------------------------------- geojson */

/**
 * The assets as one feature collection.
 *
 * Everything a layer might style is lifted into a property, because an
 * expression can only read properties: `stale` decides the colour, `label`
 * the text. The rest of the feed's own fields ride along under their own names
 * for the inspector to show, and are never styled, so a feed with a field
 * called `color` cannot repaint the map.
 */
export function assetsGeoJSON(assets: Assets | undefined): FeatureCollection {
  if (!assets || assets.items.length === 0) return EMPTY;

  return {
    type: "FeatureCollection",
    features: assets.items.map((asset) => ({
      type: "Feature",
      id: asset.id,
      properties: {
        ...(asset.properties ?? {}),
        id: asset.id,
        label: asset.label ?? asset.id,
        stale: asset.stale ?? false,
        updated: asset.updated,
        ...(asset.heading === undefined ? {} : { heading: asset.heading }),
        ...(asset.speed === undefined ? {} : { speed: asset.speed }),
      },
      geometry: { type: "Point", coordinates: asset.position },
    })),
  };
}

/**
 * How far ahead of itself an asset is drawn, in seconds of travel.
 *
 * The whisker is a reading of the heading, not a prediction, so the number only
 * has to be big enough to see and small enough not to be mistaken for a route.
 */
const LOOK_AHEAD_SECONDS = 20;

/** Shortest and longest the whisker is drawn, in metres, whatever the speed. */
const WHISKER = { min: 40, max: 900 };

/**
 * A short line out of each asset, along its heading.
 *
 * Its own source rather than a second layer on the first, because the points
 * are clustered and a clustered source has no lines in it: turning clustering
 * on would silently take the whiskers with it. Two sources is also what lets
 * the whiskers be switched off without touching the dots.
 *
 * Drawn only for assets that report a heading. An arrow pointing north because
 * nobody said otherwise is worse than no arrow: it is a fact the map does not
 * have, stated confidently.
 */
export function headingGeoJSON(assets: Assets | undefined): FeatureCollection {
  if (!assets || !assets.heading) return EMPTY;

  const features: FeatureCollection["features"] = [];
  for (const asset of assets.items) {
    if (asset.heading === undefined) continue;
    const metres = Math.min(
      WHISKER.max,
      Math.max(WHISKER.min, (asset.speed ?? 0) * LOOK_AHEAD_SECONDS),
    );
    features.push({
      type: "Feature",
      id: `${asset.id}:heading`,
      properties: { id: asset.id, stale: asset.stale ?? false },
      geometry: {
        type: "LineString",
        coordinates: [asset.position, offset(asset.position, metres, asset.heading)],
      },
    });
  }
  return features.length > 0 ? { type: "FeatureCollection", features } : EMPTY;
}

/* ---------------------------------------------------------------- motion */

/**
 * Where something is and which way it is pointing, at an instant.
 *
 * Not a `LiveAsset`: an asset is a report, which was true when it was sent. This
 * is an answer to "where does it appear to be right now", which is a different
 * question and has no `updated` because it was never reported by anybody.
 */
export interface Motion {
  position: [number, number];
  /** Degrees clockwise from north. */
  heading: number;
  /** Metres above the ground. Absent when the feed reports no height. */
  altitude?: number;
  /** Degrees the nose is above the horizontal. Negative is nose down. */
  pitch?: number;
  /** Degrees banked, right wing down positive. */
  roll?: number;
}

/**
 * How steeply the flight path is climbing or descending, in degrees.
 *
 * The angle of the path over the ground, not the angle of the aeroplane: a real
 * airliner on a three degree approach holds its nose a couple of degrees *above*
 * the horizon while descending, because a wing needs an angle of attack. That
 * distinction is invisible at map zoom and expensive to model, and the thing
 * that reads wrong on a screen is an aircraft descending while pointing dead
 * level. The path angle is the honest approximation of what a person expects to
 * see.
 */
export function pathAngle(climbMetres: number, overGroundMetres: number): number {
  if (!(overGroundMetres > 0)) return 0;
  return (Math.atan2(climbMetres, overGroundMetres) * 180) / Math.PI;
}

/** Metres per second squared. Only used to turn a rate of turn into a bank. */
const GRAVITY = 9.80665;

/** Airliners bank to about this and no further, and neither does this. */
const BANK_LIMIT = 30;

/**
 * The bank a coordinated turn at this speed and rate of turn implies.
 *
 * `tan(bank) = ω v / g` — the standard result, and the reason an aircraft
 * banks further for the same turn the faster it goes. Deriving it rather than
 * inventing an angle is what makes the turn look flown rather than animated:
 * the bank steepens as the turn tightens and rolls level as it finishes,
 * without any of that being scripted.
 *
 * Capped, because two reports either side of a sharp corner imply a rate of
 * turn no aeroplane could fly, and an airliner drawn inverted over a runway is
 * a worse answer than one that under-banks.
 */
export function bankFor(degreesPerSecond: number, metresPerSecond: number): number {
  if (!(metresPerSecond > 0)) return 0;
  const omega = (degreesPerSecond * Math.PI) / 180;
  const bank = (Math.atan((omega * metresPerSecond) / GRAVITY) * 180) / Math.PI;
  return Math.max(-BANK_LIMIT, Math.min(BANK_LIMIT, bank));
}

/**
 * The signed turn from one bearing to another, taking the short way round.
 *
 * The whole reason this is a function. Going from 359° to 1° is a two degree
 * turn to the right, and subtracting the numbers says it is a 358 degree turn to
 * the left: a lorry crossing due north spins almost all the way round on the
 * spot, once per lap, and it looks exactly like a rendering fault. Every
 * rotation between two bearings has to come through here.
 */
export function shortestTurn(from: number, to: number): number {
  return (((to - from) % 360) + 540) % 360 - 180;
}

/** Part of the way round from one bearing to the other, the short way. */
export function turnTowards(from: number, to: number, fraction: number): number {
  return (((from + shortestTurn(from, to) * fraction) % 360) + 360) % 360;
}

/**
 * How far a heading has to be worth believing, in metres.
 *
 * A heading derived from two positions a hand's breadth apart is derived from
 * noise: a parked vehicle whose GPS wanders by a few metres would spin on the
 * spot all night. Below this the last believed heading is kept.
 */
const HEADING_FLOOR = 3;

/**
 * Where an asset appears to be part way between two of its reports.
 *
 * Positions arrive about once a second and the screen draws sixty times a
 * second, so a model put straight where the last report said would stand still
 * for a second and then teleport. This is the fifty-nine frames in between.
 *
 * It interpolates rather than extrapolates, which means what is drawn is always
 * about one report behind the truth. That is the trade and it is the right way
 * round: guessing ahead means every guess is corrected when the real position
 * arrives, and a correction is a visible twitch. A vehicle that is a second
 * behind and moves smoothly reads as a vehicle; one that is up to date and
 * jerks reads as a bug.
 *
 * `fraction` is clamped, so a report that never comes leaves the model where the
 * last one put it rather than sending it on for ever in a straight line.
 */
export function tween(from: LiveAsset, to: LiveAsset, fraction: number): Motion {
  const t = Math.min(1, Math.max(0, fraction));
  const position: [number, number] = [
    from.position[0] + (to.position[0] - from.position[0]) * t,
    from.position[1] + (to.position[1] - from.position[1]) * t,
  ];
  const motion: Motion = { position, heading: headingBetween(from, to, t) };

  if (from.altitude !== undefined || to.altitude !== undefined) {
    const a = from.altitude ?? to.altitude!;
    const b = to.altitude ?? a;
    motion.altitude = a + (b - a) * t;
  }

  /*
   * Attitude comes from the two reports rather than from either one, because
   * neither of them contains it: a position stream says where, not how. The
   * span between them is where the climb and the turn are.
   */
  const seconds = Math.max(0, (to.updated - from.updated) / 1000);
  const overGround = distance(from.position, to.position);
  const climb = (to.altitude ?? 0) - (from.altitude ?? 0);
  motion.pitch = pathAngle(climb, overGround);

  /*
   * Bank needs a *rate* of turn, which needs two headings. Two positions give
   * one bearing between them and say nothing about whether it is changing, so a
   * feed that reports position only flies wings level. That is the correct
   * answer rather than a missing feature: the data does not contain the turn.
   */
  const turning =
    from.heading !== undefined && to.heading !== undefined && seconds > 0
      ? shortestTurn(from.heading, to.heading) / seconds
      : 0;
  motion.roll = bankFor(turning, to.speed ?? (seconds > 0 ? overGround / seconds : 0));

  return motion;
}

function headingBetween(from: LiveAsset, to: LiveAsset, t: number): number {
  /*
   * A feed that reports its own heading is believed, and turned through rather
   * than snapped to: a vehicle that reports 40° and then 100° took a corner, and
   * drawing it facing 40° for a second and then 100° is not a corner.
   */
  if (from.heading !== undefined && to.heading !== undefined) {
    return turnTowards(from.heading, to.heading, t);
  }
  if (to.heading !== undefined) return to.heading;
  if (from.heading !== undefined) return from.heading;

  /*
   * A feed that reports no heading still moves, and the direction it moved in
   * is a heading. Most cheap trackers send position only.
   */
  if (distance(from.position, to.position) >= HEADING_FLOOR) {
    return bearing(from.position, to.position);
  }
  return 0;
}

/**
 * The placement, driven by a live position.
 *
 * The counterpart of `movedAlong`, which does the same job for a track. Both
 * hand back a whole `Model3D` so the renderer is given a placement and never has
 * to know which of the two things moved it.
 */
export function drivenBy(model: Model3D, motion: Motion): Model3D {
  const follow = model.follow;
  if (!follow) return model;
  const driven: Model3D = {
    ...model,
    position: motion.position,
    heading: follow.faceForward
      ? (((motion.heading + (follow.headingOffset ?? 0)) % 360) + 360) % 360
      : model.heading,
  };
  /*
   * Both are opted into, and separately. A feed that reports height does not
   * mean the user wants the model flying, and a fleet of vans banking into
   * roundabouts is not a fleet of vans.
   */
  if (follow.altitude && motion.altitude !== undefined) driven.altitude = motion.altitude;
  if (follow.attitude) {
    driven.pitch = motion.pitch ?? 0;
    driven.roll = motion.roll ?? 0;
  }
  return driven;
}

/**
 * Where a followed model belongs at this instant, or null if nowhere yet.
 *
 * Null is a real answer and the caller must respect it: an asset that has
 * reported once has a position and no movement to interpolate along, and one
 * that has never reported has nothing at all. Putting the model at [0, 0]
 * because a lookup missed is how a lorry ends up in the Gulf of Guinea.
 */
export function motionFor(
  model: Model3D,
  frames: Map<string, MotionFrames>,
  now: number,
): Motion | null {
  const follow = model.follow;
  if (!follow) return null;
  const seen = frames.get(follow.asset);
  if (!seen) return null;
  if (!seen.from) {
    return {
      position: seen.to.position,
      heading: seen.to.heading ?? model.heading,
      altitude: seen.to.altitude,
      // One report is a place, not a movement. Nothing can be said about
      // attitude from it, and level is the only honest guess.
      pitch: 0,
      roll: 0,
    };
  }
  const span = seen.atTo - seen.atFrom;
  /*
   * Two reports that arrived in the same instant have no span to divide by, and
   * a fraction of Infinity is a NaN position. The later one is the answer.
   */
  const fraction = span > 0 ? (now - seen.atTo) / span : 1;
  return tween(seen.from, seen.to, fraction);
}

/**
 * The last two reports for an asset, and when each of them landed.
 *
 * `atFrom` and `atTo` are arrival times on this machine, not the feed's own
 * stamps, and deliberately: the interpolation is being asked to fill the gap
 * between two things this browser saw, and a feed whose clock is five minutes
 * out would otherwise be interpolated over five minutes.
 */
export interface MotionFrames {
  from: LiveAsset | null;
  to: LiveAsset;
  atFrom: number;
  atTo: number;
}

/**
 * Fold a new set of reports into what is already known, keeping the previous one.
 *
 * An asset whose position did not change is not advanced. Otherwise a feed that
 * re-sends the same position every second would restart the interpolation every
 * second from a point it is already at, and a stopped vehicle would jitter in
 * place rather than being stopped.
 */
export function rememberFrames(
  frames: Map<string, MotionFrames>,
  items: LiveAsset[],
  now: number,
): Map<string, MotionFrames> {
  const next = new Map(frames);
  const present = new Set<string>();
  for (const asset of items) {
    present.add(asset.id);
    const seen = next.get(asset.id);
    if (!seen) {
      next.set(asset.id, { from: null, to: asset, atFrom: now, atTo: now });
      continue;
    }
    if (seen.to.position[0] === asset.position[0] && seen.to.position[1] === asset.position[1]) {
      continue;
    }
    next.set(asset.id, { from: seen.to, to: asset, atFrom: seen.atTo, atTo: now });
  }
  for (const id of next.keys()) if (!present.has(id)) next.delete(id);
  return next;
}

/** Every model that is being driven by a feed. */
export function followers(models: Model3D[] | undefined): Model3D[] {
  return (models ?? []).filter((m) => m.follow !== undefined);
}

/* ---------------------------------------------------------------- reading */

/** How many are reporting, and how many have gone quiet. */
export function assetCounts(assets: Assets | undefined): { total: number; stale: number } {
  const items = assets?.items ?? [];
  return { total: items.length, stale: items.filter((a) => a.stale).length };
}

/**
 * How long ago, in words, for a status line.
 *
 * Seconds up to a minute, then minutes, then hours. Nothing is rounded up into
 * a larger unit than it has: "1 min ago" for ninety seconds says less than
 * "90s ago" does, and this is the one number a person watching a feed reads.
 */
export function ago(millis: number): string {
  const seconds = Math.max(0, Math.round(millis / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/** Metres per second as something a person reads. */
export function formatSpeed(metresPerSecond: number): string {
  return `${(metresPerSecond * 3.6).toFixed(0)} km/h`;
}

/**
 * The document as it should be written to disk.
 *
 * Where forty lorries were at half past two on Tuesday is not part of the map.
 * Keeping it would autosave the feed to local storage several times a minute,
 * put a stale fleet in every exported file, and open the project tomorrow with
 * yesterday's positions drawn as though they were current — which is the one
 * failure a live layer must not have. The feed's address and settings are kept,
 * because those are the map; the positions are dropped, because those are the
 * weather.
 */
export function withoutLiveAssets<T extends { assets?: Assets }>(project: T): T {
  if (!project.assets || project.assets.items.length === 0) return project;
  return { ...project, assets: { ...project.assets, items: [] } };
}
