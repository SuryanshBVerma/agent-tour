// Sample file for the Phase 0 spike tour. Not compiled.
import { rateLimiter, resetBuckets } from "../src/middleware/rateLimit";
import { fakeRequest, fakeResponse } from "./helpers";

describe("rateLimiter", () => {
  beforeEach(() => resetBuckets());

  it("allows requests up to capacity", () => {
    const limit = rateLimiter({ capacity: 2, refillPerSecond: 0 });
    const next = jest.fn();
    limit(fakeRequest("key-a"), fakeResponse(), next);
    limit(fakeRequest("key-a"), fakeResponse(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("rejects with 429 once the bucket is empty", () => {
    const limit = rateLimiter({ capacity: 1, refillPerSecond: 0 });
    const res = fakeResponse();
    limit(fakeRequest("key-b"), fakeResponse(), jest.fn());
    limit(fakeRequest("key-b"), res, jest.fn());
    expect(res.statusCode).toBe(429);
  });
});
