// Sample file for the Phase 0 spike tour. Not compiled.
import type { Request, Response, NextFunction } from "./http";

export interface RateLimitOptions {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

function refill(bucket: Bucket, options: RateLimitOptions, now: number): void {
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(
    options.capacity,
    bucket.tokens + elapsedSeconds * options.refillPerSecond,
  );
  bucket.updatedAt = now;
}

export function rateLimiter(options: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.headers["x-api-key"] ?? req.ip;
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: options.capacity, updatedAt: now };
    refill(bucket, options, now);

    if (bucket.tokens < 1) {
      res.status(429).setHeader("Retry-After", "1").end();
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    next();
  };
}

export function resetBuckets(): void {
  buckets.clear();
}
