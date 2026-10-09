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
    // Drop rows the current catalog no longer declares.
    //
    // The unique key is `(provider, model, endpoint)`, so a catalog change
    // leaves the old row behind in two shapes:
    //   - a retired id: the catalog stopped declaring it, and
    //   - a drifted endpoint: the id is still declared, on another wire (a
    //     model that moved `/chat/completions` -> `/responses`).
    // The router dispatches whichever row the snapshot lists first, so a
    // leftover row serves a route the catalog no longer owns — the chat row
    // for a Responses-only model answered upstream
    // `ModelProtocolUnsupported` on every request.
    //
    // `builtin` rows are catalog-owned by definition, so any pair the catalog
    // does not declare is stale and goes. `discovered`/`auto_free` rows are
    // only pruned for ids the catalog *does* declare (the shadow row a fetch
    // wrote on the wrong wire); a discovered row for an undeclared id is a
    // legitimate fetch result and stays. `manual` is operator-owned.
    const pairs = definitions.map(
      (definition) => sql`(${definition.modelId}, ${definition.endpointPath})`,
    );
    const pairsNotDeclared = sql`(${models.modelId}, ${models.endpointPath}) NOT IN (${sql.join(pairs, sql`, `)})`;
    await db.delete(models).where(
      and(
        eq(models.providerId, providerId),
        eq(models.source, "builtin"),
        pairsNotDeclared,
      ),
    );
    await db.delete(models).where(
      and(
        eq(models.providerId, providerId),
        inArray(models.source, ["discovered", "auto_free"]),
        inArray(
          models.modelId,
          definitions.map((definition) => definition.modelId),
        ),
        pairsNotDeclared,
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
