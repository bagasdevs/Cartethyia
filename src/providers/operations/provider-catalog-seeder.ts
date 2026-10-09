/** Durable materialization of bundled provider model metadata. */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { CartethyiaDatabase } from "../../persistence/postgres";
import { models } from "../../persistence/schema";
import type { ModelDefinition } from "../provider-registry";

/** Persists compiled provider model metadata and reconciles drifted capability flags. */
export async function seedBundledModels(
  db: CartethyiaDatabase,
  builtinModels: ReadonlyMap<string, readonly ModelDefinition[]>,
): Promise<void> {
  for (const [providerId, definitions] of builtinModels) {
    if (definitions.length === 0) continue;
    // Drop rows the current catalog no longer declares for these ids.
    // The unique key is (provider, model, endpoint), so a wire change inserts
    // a new row and leaves the old one: a model that moved from
    // `/chat/completions` to `/responses` kept its chat row, and the router
    // dispatches whichever row the snapshot lists first. That stale row is
    // not always `builtin` — discovery writes `discovered`/`auto_free` for the
    // same id — so restricting the delete to `builtin` left it in place and
    // upstream answered `ModelProtocolUnsupported` on every request.
    // `manual` is operator-owned and stays. Composite `NOT IN` keeps exactly
    // the (model, endpoint) pairs the catalog owns.
    const pairs = definitions.map(
      (definition) => sql`(${definition.modelId}, ${definition.endpointPath})`,
    );
    const ids = definitions.map((definition) => definition.modelId);
    await db.delete(models).where(
      and(
        eq(models.providerId, providerId),
        inArray(models.modelId, ids),
        inArray(models.source, ["builtin", "discovered", "auto_free"]),
        sql`(${models.modelId}, ${models.endpointPath}) NOT IN (${sql.join(pairs, sql`, `)})`,
      ),
    );
  }
  const now = new Date();
  const seen = new Set<string>();
  const rows = [...builtinModels.entries()].flatMap(([providerId, definitions]) =>
    definitions.flatMap((definition) => {
      const key = `${providerId}\u0000${definition.modelId}\u0000${definition.endpointPath}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          providerId,
          modelId: definition.modelId,
          wireFamily: definition.wireFamily,
          serviceKind: definition.serviceKind ?? "llm",
          endpointPath: definition.endpointPath,
          contextLimit: definition.contextLimit,
          outputLimit: definition.outputLimit,
          modalities: definition.modalities,
          reasoning: definition.reasoning,
          toolCall: definition.toolCall,
          cost: definition.cost,
          source: "builtin",
          sourceUpdatedAt: now,
          enabled: true,
        },
      ];
    }),
  );
  if (rows.length === 0) return;
  // Reconcile static metadata on conflict rather than skipping: capability
  // flags (toolCall/reasoning/webSearch), wire family, limits, and cost can
  // drift on a pre-existing row (e.g. a discovery seeded `tool_call=false`
  // before the static catalog was corrected). `source` is forced back to
  // `builtin`: a fetch upsert may have flipped a builtin row to `discovered`,
  // and the static catalog owns these ids. `enabled` is operator-owned and
  // must never be reset here.
  await db.insert(models).values(rows).onConflictDoUpdate({
    target: [models.providerId, models.modelId, models.endpointPath],
    set: {
      wireFamily: sql`excluded.wire_family`,
      serviceKind: sql`excluded.service_kind`,
      endpointPath: sql`excluded.endpoint_path`,
      contextLimit: sql`excluded.context_limit`,
      outputLimit: sql`excluded.output_limit`,
      modalities: sql`excluded.modalities`,
      reasoning: sql`excluded.reasoning`,
      toolCall: sql`excluded.tool_call`,
      cost: sql`excluded.cost`,
      source: sql`'builtin'`,
      sourceUpdatedAt: sql`excluded.source_updated_at`,
    },
  });
}
