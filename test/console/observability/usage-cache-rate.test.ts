import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type CartethyiaDatabase } from "../../../src/persistence/postgres";
import { dbDescribe } from "../../helpers/db-gate";
import type { RedisClient } from "../../../src/persistence/redis";
import { tenants, telemetryEvents } from "../../../src/persistence/schema";
import { DrizzleObservabilityStore } from "../../../src/console/observability/store";

/**
 * The cache columns on the Usage surface must measure the cached *prefix*, not
 * the whole prompt of the requests that happened to cache anything.
 *
 * Seeded window (one tenant):
 *   A  input 1000, cached  900  — a real 90% hit
 *   B  input 1000, cached NULL  — the provider reported no cache breakdown
 *   C  input 1000, cached    0  — a real miss (reported as zero)
 *
 * A NULL is *unmeasured*, not "nothing cached", so B must leave the rate alone:
 * the honest denominator is the input of the rows that reported a figure
 * (2000), giving 900/2000 = 45%. Counting B's input (3000) would report 30%
 * for the same traffic, and counting A's whole prompt as "cached" (1000) —
 * what the old aggregate did — reports 33.3% and overstates the cached volume.
 */
dbDescribe("usage cache accounting", () => {
  let db: CartethyiaDatabase;
  let store: DrizzleObservabilityStore;
  const tenantId = randomUUID();

  // The store only pings Redis; a typed stand-in keeps the health path live
  // without a real server.
  const fakeRedis = {
    ping: async () => "PONG",
  } as unknown as RedisClient;

  beforeAll(async () => {
    db = getDb();
    store = new DrizzleObservabilityStore(db, fakeRedis);
    await db
      .insert(tenants)
      .values({ id: tenantId, name: "cache-rate-test", status: "active" })
      .onConflictDoNothing();
    await db.insert(telemetryEvents).values([
      {
        tenantId,
        requestId: randomUUID(),
        sourceSurface: "chat",
        requestedModel: "hit-model",
        providerId: "cb",
        status: "completed",
        httpStatus: 200,
        inputTokens: 1000,
        cachedInputTokens: 900,
        outputTokens: 10,
      },
      {
        tenantId,
        requestId: randomUUID(),
        sourceSurface: "chat",
        requestedModel: "unmeasured-model",
        providerId: "cb",
        status: "completed",
        httpStatus: 200,
        inputTokens: 1000,
        cachedInputTokens: null,
        outputTokens: 10,
      },
      {
        tenantId,
        requestId: randomUUID(),
        sourceSurface: "chat",
        requestedModel: "miss-model",
        providerId: "cb",
        status: "completed",
        httpStatus: 200,
        inputTokens: 1000,
        cachedInputTokens: 0,
        outputTokens: 10,
      },
    ]);
  });

  test("summary reports the cached prefix, not the caching requests' whole prompt", async () => {
    const summary = await store.usageSummary(tenantId, "24h");
    expect(summary.totals.inputTokens).toBe(3000);
    expect(summary.totals.cachedTokens).toBe(900);
    expect(summary.totals.cacheHitRate).toBeCloseTo(45, 5);
  });

  test("the unmeasured row is excluded from the rate instead of counted as a miss", async () => {
    // 900/3000 = 30% is what including the unreported row would produce; the
    // rate must stay the measured rows' own figure.
    const cache = await store.usageCache(tenantId, "24h");
    expect(cache.cachedTokens).toBe(900);
    expect(cache.hitRate).toBeCloseTo(45, 5);
    expect(cache.hitRate).not.toBeCloseTo(30, 5);
    expect(cache.hitRate).not.toBeCloseTo(33.333, 2);
  });

  test("the per-model breakdown rates each row on its own input", async () => {
    const by = await store.usageBy(tenantId, "model", "24h");
    const row = by.rows.find((entry) => entry.name === "hit-model");
    expect(row?.cached).toBe(900);
    // input/(input+output) — the old formula — answers 99.0 here.
    expect(row?.cacheHitRate).toBeCloseTo(90, 5);
  });

  test("the chart plots cached tokens, not the caching buckets' whole input", async () => {
    const chart = await store.usageChart(tenantId, "24h");
    const cached = chart.buckets.reduce((sum, bucket) => sum + bucket.cached, 0);
    expect(cached).toBe(900);
  });

  test("system health reports the same measured rate", async () => {
    const health = await store.health(tenantId);
    expect(health.cache_hit_rate_percent).toBeCloseTo(45, 5);
  });

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });
});
