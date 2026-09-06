import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveAsset, MapProject } from "@alidade/core";
import { applyFrame, markStale, parseFrame } from "@alidade/core";

/**
 * The one piece of the live layer that talks to the outside world.
 *
 * Everything it knows how to do with a message is in `@alidade/core` and is
 * tested in Node; what is here is the socket, the clock and the retry — the
 * three things that cannot be tested without one of them. Keeping the split at
 * exactly this line is why a malformed frame is a unit test rather than a
 * afternoon with a server running.
 */

/**
 * Where the connection is.
 *
 * `retrying` is deliberately distinct from `failed`. A feed that will try again
 * in four seconds and a feed that has given up look identical on a status light
 * and are completely different things to the person watching it.
 */
export type FeedState = "off" | "connecting" | "live" | "retrying" | "failed";

export interface FeedStatus {
  state: FeedState;
  /** When the current connection opened, for "live for 4m". */
  since: number | null;
  /** How many times in a row connecting has failed. */
  attempts: number;
  /** Epoch milliseconds of the next attempt, while retrying. */
  retryAt: number | null;
  message: string | null;
}

/**
 * How often the buffered frames are written into the document.
 *
 * A feed is entitled to be chatty: a per-vehicle stream at 10 Hz over two
 * hundred vehicles is two thousand messages a second, and writing the document
 * on each one would reconcile, re-render the sidebar and re-serialise the
 * project two thousand times a second. Frames are folded together and applied
 * five times a second, which is faster than the eye resolves movement on a map
 * and slow enough that the cost is fixed however loud the feed is.
 */
const FLUSH_MS = 200;

/** How often staleness is re-judged. The clock moves whether or not the feed does. */
const SWEEP_MS = 1000;

/** First retry delay, doubling to the ceiling, so a dead server is not hammered. */
const BACKOFF_MS = 1000;
const BACKOFF_CEILING_MS = 30000;

/**
 * Give up after this many consecutive failures.
 *
 * Not because retrying is expensive — it is one socket — but because a light
 * that has been blinking "retrying" for an hour is telling the user nothing.
 * At some point the honest thing to say is that it is not working.
 */
const ATTEMPT_LIMIT = 8;

/**
 * Resolve the feed address against the page.
 *
 * The document holds `/api/live/assets` so that the same project works against
 * `vite` on port 5173 and behind Nginx in the compose stack. An absolute `ws://`
 * or `wss://` is left exactly as written, because someone who typed a host meant
 * that host.
 */
export function feedUrl(url: string, base: { protocol: string; host: string }): string {
  if (/^wss?:\/\//i.test(url)) return url;
  if (/^https?:\/\//i.test(url)) return url.replace(/^http/i, "ws");
  const scheme = base.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${base.host}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Exponential with a ceiling, and jitter so many clients do not return together. */
export function backoffFor(attempt: number): number {
  const base = Math.min(BACKOFF_CEILING_MS, BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export function useLiveFeed(
  project: MapProject,
  transient: (change: (draft: MapProject) => MapProject) => void,
) {
  const assets = project.assets;
  const enabled = assets?.enabled ?? false;
  const url = assets?.url ?? "";
  const staleAfter = assets?.staleAfter ?? 30;

  const [status, setStatus] = useState<FeedStatus>({
    state: "off",
    since: null,
    attempts: 0,
    retryAt: null,
    message: null,
  });

  /*
   * The writer, held in a ref rather than in the effect's dependencies.
   *
   * `transient` is stable, but `project` is not — it changes on every frame this
   * hook writes — and an effect that depends on the document would tear the
   * socket down and open a new one every time a lorry moved. The socket depends
   * on the address and the switch, and on nothing else.
   */
  const write = useRef(transient);
  write.current = transient;
  const staleRef = useRef(staleAfter);
  staleRef.current = staleAfter;

  /** Frames that have arrived since the last flush, oldest first. */
  const pending = useRef<LiveAsset[][]>([]);
  const removals = useRef<string[]>([]);
  const snapshot = useRef<LiveAsset[] | null>(null);

  const drain = useCallback(() => {
    const snap = snapshot.current;
    const patches = pending.current;
    const gone = removals.current;
    if (snap === null && patches.length === 0 && gone.length === 0) return;
    snapshot.current = null;
    pending.current = [];
    removals.current = [];

    write.current((draft) => {
      if (!draft.assets) return draft;
      /*
       * A snapshot that arrived in this window supersedes every patch before it
       * and is superseded by every patch after it, which is exactly what
       * replaying them in order does. Buffering is not allowed to change what
       * the feed said, only when the map hears it.
       */
      let items = snap ?? draft.assets.items;
      for (const assets of patches) items = applyFrame(items, { kind: "update", assets });
      if (gone.length > 0) items = applyFrame(items, { kind: "remove", ids: gone });
      draft.assets = { ...draft.assets, items: markStale(items, Date.now(), staleRef.current) };
      return draft;
    });
  }, []);

  /* The socket. Torn down and rebuilt only when the address or the switch changes. */
  useEffect(() => {
    if (!enabled || !url) {
      setStatus({ state: "off", since: null, attempts: 0, retryAt: null, message: null });
      return;
    }

    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    /*
     * Set on the way out, and checked before anything schedules more work. A
     * socket that closes *because* the effect is being cleaned up would
     * otherwise reconnect on the way out, and in React's development
     * double-mount that leaves an orphan socket per mount.
     */
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      setStatus((was) => ({ ...was, state: "connecting", retryAt: null }));

      let resolved: string;
      try {
        resolved = feedUrl(url, window.location);
        socket = new WebSocket(resolved);
      } catch {
        // A URL the browser will not even parse never fires an error event.
        setStatus({
          state: "failed",
          since: null,
          attempts: attempts + 1,
          retryAt: null,
          message: `${url} is not an address this browser can open.`,
        });
        return;
      }

      socket.onopen = () => {
        attempts = 0;
        setStatus({
          state: "live",
          since: Date.now(),
          attempts: 0,
          retryAt: null,
          message: null,
        });
      };

      socket.onmessage = (event: MessageEvent) => {
        const frame = parseFrame(event.data);
        if (!frame) return;
        if (frame.kind === "snapshot") {
          snapshot.current = frame.assets;
          pending.current = [];
          removals.current = [];
        } else if (frame.kind === "remove") removals.current.push(...frame.ids);
        else pending.current.push(frame.assets);
      };

      socket.onclose = () => {
        if (stopped) return;
        attempts += 1;
        if (attempts >= ATTEMPT_LIMIT) {
          setStatus({
            state: "failed",
            since: null,
            attempts,
            retryAt: null,
            message: `Gave up after ${attempts} attempts to reach ${url}.`,
          });
          return;
        }
        const wait = backoffFor(attempts);
        setStatus({
          state: "retrying",
          since: null,
          attempts,
          retryAt: Date.now() + wait,
          message: null,
        });
        retry = setTimeout(connect, wait);
      };

      /*
       * Nothing is done here on purpose. A socket error is always followed by a
       * close, so retrying from both would double the attempt count and halve
       * the backoff. This exists so the browser does not log it as unhandled.
       */
      socket.onerror = () => {};
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [enabled, url]);

  /* Writing what has arrived, on a fixed beat rather than per message. */
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(drain, FLUSH_MS);
    return () => clearInterval(timer);
  }, [enabled, drain]);

  /*
   * Re-judging staleness, which is the thing a message-driven design gets wrong.
   *
   * If dots only went grey when a frame arrived, the one case that matters —
   * the feed stopping — would be the one case nothing was drawn for: the map
   * would hold the last positions and go on presenting them as current. This
   * sweep runs whether or not anything is being received, and `markStale`
   * returns the list unchanged when nothing flipped, so a quiet minute costs
   * sixty comparisons and no operations.
   */
  useEffect(() => {
    const sweep = () =>
      write.current((draft) => {
        if (!draft.assets || draft.assets.items.length === 0) return draft;
        const items = markStale(draft.assets.items, Date.now(), staleRef.current);
        if (items === draft.assets.items) return draft;
        draft.assets = { ...draft.assets, items };
        return draft;
      });
    const timer = setInterval(sweep, SWEEP_MS);
    return () => clearInterval(timer);
  }, []);

  /** Drop everything the feed reported, without disconnecting. */
  const clear = useCallback(() => {
    snapshot.current = null;
    pending.current = [];
    removals.current = [];
    write.current((draft) => {
      if (!draft.assets) return draft;
      draft.assets = { ...draft.assets, items: [] };
      return draft;
    });
  }, []);

  return { status, clear };
}
