import { Tour } from "./types";

/**
 * Hardcoded Phase 0 tour over `test/fixtures/spike-workspace`. Covers every step kind,
 * two steps in one file (same-file step change), and a cross-file jump.
 * Replaced by TourStore-loaded tours in Phase 1.
 */
export const SPIKE_TOUR: Tour = {
  version: 1,
  id: "spike",
  title: "Add rate limiting to public API",
  summary: "Adds per-key token bucket middleware and wires it into the router.",
  baseRef: "HEAD",
  createdBy: "phase-0-spike",
  steps: [
    {
      file: "src/middleware/rateLimit.ts",
      range: { start: 25, end: 41 },
      anchor: "export function rateLimiter(",
      kind: "change",
      title: "Token bucket middleware",
      description:
        "**What:** Express-style middleware that keeps one token bucket per API key " +
        "(falling back to client IP) and answers `429` when the bucket is empty.\n\n" +
        "**Why:** A token bucket allows short bursts up to `capacity` while enforcing an " +
        "average rate. A fixed window was simpler but lets clients double their rate at " +
        "window edges.\n\n" +
        "**Watch for:** `Retry-After` is a constant `1`, not computed from the refill rate.",
    },
    {
      file: "src/middleware/rateLimit.ts",
      range: { start: 16, end: 23 },
      anchor: "function refill(",
      kind: "context",
      title: "Lazy refill",
      description:
        "**What:** Tokens are topped up on each request based on elapsed time, so no " +
        "timer runs in the background.\n\n" +
        "**Why:** Keeps the middleware stateless apart from the map; no cleanup interval.",
    },
    {
      file: "src/middleware/rateLimit.ts",
      range: { start: 14, end: 14 },
      anchor: "const buckets = new Map",
      kind: "risk",
      title: "Unbounded in-memory state",
      description:
        "**What:** Buckets live in a process-local `Map`.\n\n" +
        "**Watch for:** The map is never pruned, so many distinct keys grow memory without " +
        "bound. Limits are also per process: behind a load balancer each instance counts " +
        "separately.",
    },
    {
      file: "src/router.ts",
      range: { start: 11, end: 12 },
      anchor: "const publicApi = rateLimiter(",
      kind: "decision",
      title: "Scope: `/api` only",
      description:
        "**What:** The limiter is mounted on `/api`; `/health` stays unlimited so load " +
        "balancer probes are never throttled.\n\n" +
        "**Why:** 60 requests with 1/s refill matches the documented public quota.",
    },
    {
      file: "test/rateLimit.test.ts",
      range: { start: 16, end: 22 },
      anchor: 'it("rejects with 429',
      kind: "change",
      title: "Rejection test",
      description:
        "**What:** Drains a capacity-1 bucket and asserts the second call gets `429`.\n\n" +
        "**Watch for:** Refill is disabled (`refillPerSecond: 0`) to keep the test " +
        "independent of wall-clock time.",
    },
  ],
};
