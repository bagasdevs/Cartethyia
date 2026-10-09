/**
 * A catalog id owns exactly the (model, endpoint) pairs the catalog declares.
 *
 * The row key is (provider, model, endpoint), so a wire change inserts a new
 * row and leaves the old one. Discovery writes that leftover as `discovered`
 * or `auto_free`, and the router dispatches whichever row the snapshot lists
 * first — a chat row for a Responses-only model answers
 * `ModelProtocolUnsupported` on every request. Seeding must drop it.
 * A `manual` row is the operator's and must survive.
 */
import { afterAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import type { PGlite } from "@electric-sql/pglite";
import { seedBundledModels } from "../../src/providers/operations/provider-catalog-seeder";
import type { ModelDefinition } from "../../src/providers/provider-registry";
import {
  applyPgliteMigrations,
  buildPgliteHandle,
  createPgliteClient,
} from "../../src/persistence/db-pglite";
import { models, providers } from "../../src/persistence/schema";

const PROVIDER = "opencodezen";
const MODEL = "muse-spark-1.3-contributor-free";

function catalogRow(): ModelDefinition {
  return {
    modelId: MODEL,
    wireFamily: "responses",
    endpointPath: "/zen/v1/responses",
    contextLimit: 1_048_576,
    outputLimit: 131_072,
    modalities: { input: ["text"], output: ["text"] },
    reasoning: true,
    toolCall: true,
    cost: { input: 0, output: 0, pricing_model: "pay-per-use" },
  };
}

let client: PGlite;

afterAll(async () => {
  await client?.close().catch(() => undefined);
});

test("seeding drops a discovered row on a wire the catalog no longer declares", async () => {
  client = await createPgliteClient("memory://");
  await applyPgliteMigrations(client);
  const db = buildPgliteHandle(client).db;
  await db.insert(providers).values({ id: PROVIDER });
  await db.insert(models).values([
    {
      providerId: PROVIDER,
      modelId: MODEL,
      wireFamily: "chat",
      endpointPath: "/zen/v1/chat/completions",
      source: "discovered",
    },
    {
      providerId: PROVIDER,
      modelId: MODEL,
      wireFamily: "chat",
      endpointPath: "/zen/v1/manual",
      source: "manual",
    },
    // A `builtin` row for an id the catalog stopped declaring: retired
    // upstream, but still dispatchable until seeding removes it.
    {
      providerId: PROVIDER,
      modelId: "retired-model",
      wireFamily: "chat",
      endpointPath: "/zen/v1/chat/completions",
      source: "builtin",
    },
    // A discovered row for an id the catalog never declared is a legitimate
    // fetch result and must survive.
    {
      providerId: PROVIDER,
      modelId: "kept-discovered",
      wireFamily: "chat",
      endpointPath: "/zen/v1/chat/completions",
      source: "discovered",
    },
  ]);

  await seedBundledModels(db, new Map([[PROVIDER, [catalogRow()]]]));

  const rows = await db.select().from(models).where(eq(models.providerId, PROVIDER));
  const endpoints = rows.map((row) => `${row.modelId} ${row.endpointPath} ${row.source}`).sort();
  expect(endpoints).toEqual([
    "kept-discovered /zen/v1/chat/completions discovered",
    `${MODEL} /zen/v1/manual manual`,
    `${MODEL} /zen/v1/responses builtin`,
  ]);
});
