/**
 * What each OpenCode tier's discovery marks as its free tier.
 *
 * `/zen/v1/models` states no tier field, so the free tier is read from the id
 * convention the provider itself uses. The flag matters beyond display: a
 * `freeTier` row is what the model list groups as "Free models (auto)" and what
 * dispatch reads when deciding whether the free-tier agent fingerprint applies.
 *
 * Two behaviours are pinned here, both established by reading the live
 * endpoint:
 *
 *  - Zen serves the free tier from the same `/zen/v1` base as its billed
 *    roster, so its discovery must mark free ids rather than writing them as
 *    ordinary rows. It previously used the generic OpenAI fetch, which knows
 *    nothing about tiers.
 *  - A System One id carries the `-free` suffix but is not a chat model, so it
 *    is reclassified onto its native endpoint whatever the tier.
 */
import { expect, test } from "bun:test";
import {
  discoverOpenCodeFreeModels,
  discoverOpenCodeZenModels,
} from "../../src/providers/integrations/opencode";

/** The listing shape the endpoint answers with, reduced to what discovery reads. */
function listingResponse(ids: readonly string[]): Response {
  return new Response(
    JSON.stringify({
      object: "list",
      data: ids.map((id) => ({ id, object: "model", created: 0 })),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const LIVE_IDS = [
  "big-pickle",
  "mimo-v2.6-flash-free",
  "muse-spark-1.3-contributor-free",
  "nemotron-3.5-lightning-free",
  "jev-1.13-free",
  "claude-opus-5-5",
  "gpt-5.5",
];

test("zen marks the free-tier ids and leaves billed ones unmarked", async () => {
  const models = await discoverOpenCodeZenModels({
    baseUrl: "https://opencode.ai/zen/v1",
    credential: "test-key",
    fetcher: async () => listingResponse(LIVE_IDS),
  });
  expect(models).not.toBeNull();
  const free = (models ?? []).filter((m) => m.freeTier === true).map((m) => m.modelId).sort();
  expect(free).toEqual([
    "big-pickle",
    "jev-1.13-free",
    "mimo-v2.6-flash-free",
    "muse-spark-1.3-contributor-free",
    "nemotron-3.5-lightning-free",
  ]);
  const billed = (models ?? []).filter((m) => m.freeTier !== true).map((m) => m.modelId).sort();
  expect(billed).toEqual(["claude-opus-5-5", "gpt-5.5"]);
});

test("the free tier keeps only free ids and reclassifies System One", async () => {
  const models = await discoverOpenCodeFreeModels({
    baseUrl: "https://opencode.ai/zen/v1",
    fetcher: async () => listingResponse(LIVE_IDS),
  });
  expect(models).not.toBeNull();
  const ids = (models ?? []).map((m) => m.modelId).sort();
  expect(ids).toEqual([
    "big-pickle",
    "jev-1.13-free",
    "mimo-v2.6-flash-free",
    "muse-spark-1.3-contributor-free",
    "nemotron-3.5-lightning-free",
  ]);
  const systemone = (models ?? []).find((m) => m.modelId === "jev-1.13-free");
  expect(systemone?.serviceKind).toBe("systemone");
  expect(systemone?.endpointPath).toBe("/zen/v1/systemone");
  expect((models ?? []).every((m) => m.freeTier === true)).toBe(true);
});
