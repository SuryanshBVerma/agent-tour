// Sample file for the Phase 0 spike tour. Not compiled.
import { Router } from "./http";
import { rateLimiter } from "./middleware/rateLimit";
import { listItems, getItem, createItem } from "./handlers/items";

export function buildRouter(): Router {
  const router = new Router();

  router.get("/health", (_req, res) => res.status(200).end());

  const publicApi = rateLimiter({ capacity: 60, refillPerSecond: 1 });
  router.use("/api", publicApi);

  router.get("/api/items", listItems);
  router.get("/api/items/:id", getItem);
  router.post("/api/items", createItem);

  return router;
}
