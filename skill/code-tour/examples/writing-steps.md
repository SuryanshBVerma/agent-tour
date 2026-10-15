# Writing steps: weak and strong

Each pair describes the same lines. The weak version is what a first draft usually looks like;
the strong one is what the reviewer needs. All examples come from one change: per-key rate
limiting added to an HTTP API (the full tour is `2026-09-25-rate-limiting.json`).

## First step (`change`): orient, then describe

Weak:

> **What:** This function creates the rate limiter middleware. It takes options and returns
> a middleware function.

Restates the signature, and gives no sense of where the tour is going.

Strong:

> This change has three parts: the limiter, its wiring into the router, and tests. We start
> with the limiter, where each request is counted.
>
> **What:** One token bucket per API key, falling back to client IP; an empty bucket answers
> `429`.
>
> **Why:** A token bucket allows short bursts up to `capacity` while holding the average
> rate. A fixed window was simpler, but lets a client double its rate across a window edge.
>
> **Watch for:** `Retry-After` is a constant `1`, not computed from the refill rate.

The first sentence is the map. The rest says what the code can't: the fallback, the rejected
alternative, and a known shortcut.

## `context`: say why the reader needs it

Weak:

> **What:** This is the refill function. It calculates elapsed time and adds tokens.

The reviewer can read that from the five highlighted lines.

Strong:

> **What:** The bucket from the previous step is refilled lazily, on each request, from the
> time since the last one. Nothing runs between requests.
>
> **Why:** No timer means nothing to clean up on shutdown and nothing to leak in tests.

Links back to the previous step and explains the consequence of the design, which is the
reason this unchanged code is in the tour at all.

## `risk`: name the failure, the trigger and the scope

Weak:

> **What:** Buckets are stored in a Map.
>
> **Watch for:** This might use a lot of memory.

"Might" with no trigger gives the reviewer nothing to check.

Strong:

> **What:** Buckets live in a process-local `Map` keyed by API key or IP.
>
> **Watch for:** Nothing ever removes an entry, so a client rotating IPs grows memory without
> bound. Limits are also per process: behind a load balancer with three instances, a client
> gets three times the quota. Neither is tested.

States what goes wrong, what causes it, how bad it gets, and that no test covers it. Keep
`risk` for problems like this, so the few red steps stand out.

## `decision`: show the alternative

Weak:

> **What:** The limiter is applied to the API routes.
>
> **Why:** Because the API needs rate limiting.

The "why" repeats the "what".

Strong:

> **What:** The limiter from the first step is mounted on `/api` only; `/health` stays
> unlimited.
>
> **Why:** Load balancer probes hit `/health` every few seconds and must never get a `429`.
> Mounting it app-wide and exempting `/health` inside the limiter was the alternative; it
> puts routing knowledge into the middleware.

A decision step is only worth a reviewer's attention if there was a real alternative. Name it.

## Last step: what the tests prove and what they don't

Weak:

> **What:** Tests for the rate limiter.

Strong:

> **What:** Drains a capacity-1 bucket and checks that the second request gets `429`.
>
> **Watch for:** Refill is switched off (`refillPerSecond: 0`) so the test doesn't depend on
> wall-clock time, which means the refill path from the second step is not tested at all.

Ends the tour on the gap the reviewer should weigh before approving.

## Summary

Weak:

> Added rate limiting.

Strong:

> Adds per-key token bucket middleware and wires it into the /api routes; /health stays
> unlimited. Tests cover the allow and reject paths and pass; not load-tested. Verify: the
> 60/min quota matches the public API docs.

What changed, the test status as actually known, and the one thing the agent could not check.
When files changed that have no step (deleted, generated, trivial edits), the summary names
them too.
