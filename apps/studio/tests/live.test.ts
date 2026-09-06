import { describe, expect, it } from "vitest";

import { backoffFor, feedUrl } from "../src/useLiveFeed";

const page = (protocol: string, host: string) => ({ protocol, host });

describe("feedUrl", () => {
  it("resolves a relative address against the page", () => {
    expect(feedUrl("/api/live/assets", page("http:", "localhost:5173"))).toBe(
      "ws://localhost:5173/api/live/assets",
    );
  });

  it("uses a secure socket on a secure page", () => {
    // A page served over https cannot open a ws:. The browser refuses it, and
    // the studio would report a working feed as one that keeps dropping.
    expect(feedUrl("/api/live/assets", page("https:", "maps.example.org"))).toBe(
      "wss://maps.example.org/api/live/assets",
    );
  });

  it("leaves an address that already names a socket alone", () => {
    const written = "wss://fleet.example.org/positions";
    expect(feedUrl(written, page("http:", "localhost"))).toBe(written);
  });

  it("turns an http address into the socket scheme that matches it", () => {
    expect(feedUrl("http://api.local/live", page("https:", "x"))).toBe("ws://api.local/live");
    expect(feedUrl("https://api.local/live", page("http:", "x"))).toBe("wss://api.local/live");
  });

  it("copes with an address missing its leading slash", () => {
    expect(feedUrl("api/live", page("http:", "localhost:5173"))).toBe(
      "ws://localhost:5173/api/live",
    );
  });
});

describe("backoffFor", () => {
  it("grows with each failure", () => {
    // Compared as ranges because of the jitter, which is the point of it: a
    // hundred studios reconnecting on the same schedule is a stampede.
    const first = backoffFor(1);
    const fourth = backoffFor(4);
    expect(first).toBeGreaterThanOrEqual(750);
    expect(first).toBeLessThanOrEqual(1250);
    expect(fourth).toBeGreaterThan(first);
  });

  it("stops growing at the ceiling", () => {
    // Half an hour between attempts is not patience, it is a hang.
    for (const attempt of [8, 20, 400]) {
      expect(backoffFor(attempt)).toBeLessThanOrEqual(30000 * 1.25 + 1);
    }
  });

  it("never waits a negative amount, whatever it is given", () => {
    expect(backoffFor(0)).toBeGreaterThan(0);
    expect(backoffFor(-5)).toBeGreaterThan(0);
  });
});
