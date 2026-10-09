/**
 * The OpenCode free tier is gated on the request fingerprint, not on the
 * credential: upstream answers `403 FreeTierError` unless the dispatch carries
 * all three of
 *
 *   1. `user-agent: opencode/<version>`, version >= 1.18.0 (older -> 426),
 *   2. `x-opencode-session: ses_<12 lowercase hex><14 base62>` exactly, and
 *   3. a request tool set that includes `read` **and** `bash`, plus `stream:
 *      true` (a non-streamed request is refused even with the tools present).
 *
 * Established by probing the live endpoint (2026-10-09) and pinned here against
 * the two hooks that own each part: `buildOpenCodeHeaders` owns 1-2 and the
 * spec's `prepareRequest` owns 3. The gate is per *model*, not per provider —
 * Zen serves the same catalog as Free, so its `-free` rows are refused
 * identically, while a billed id must keep the caller's own tool list.
 *
 * Note the hook signature is `(request) => CanonicalRequest` — it receives no
 * candidate, so the per-model decision is read off `request.model`.
 */
import { describe, expect, test } from "bun:test";
import {
  buildOpenCodeHeaders,
  generateOpenCodeSessionId,
  openCodeSessionIdFromAffinity,
} from "../../src/providers/integrations/opencode-fingerprint";
import { OPENCODE_FREE_SPEC, OPENCODE_GO_SPEC, OPENCODE_ZEN_SPEC } from "../../src/providers/integrations/opencode";
import type { CanonicalRequest } from "../../src/transport/canonical-model";

/** Exactly the session-id shape the live free-tier gate accepts. */
const GATE_SESSION = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

function request(model: string, stream: boolean): CanonicalRequest {
  return {
    model,
    messages: [{ role: "user", content: [{ kind: "text", text: "hi" }] }],
    generation_controls: { max_tokens: 16 },
    source_surface: "chat",
    stream,
  } as CanonicalRequest;
}

/** The spec hook, asserted present so a silent removal fails the suite. */
function prepare(spec: typeof OPENCODE_ZEN_SPEC, modelId: string, stream: boolean): CanonicalRequest {
  const hook = spec.prepareRequest;
  expect(hook).toBeDefined();
  return hook?.(request(modelId, stream)) ?? request(modelId, stream);
}

describe("opencode session id: the shape the free-tier gate reads", () => {
  test("a generated session id satisfies the gate", () => {
    expect(generateOpenCodeSessionId()).toMatch(GATE_SESSION);
  });

  test("an affinity that is not a session id is converted, not forwarded", () => {
    // What the gateway actually produces: an `aff_…` key derived from the
    // opening turn, or whatever session header the caller sent.
    for (const affinity of ["aff_3f2a9b1c8d7e6f5a4b3c2d1e", "9b1c8d7e-6f5a-4b3c-2d1e-3f2a9b1c8d7e", "my-session-key-1234567890"]) {
      const session = openCodeSessionIdFromAffinity(affinity);
      expect(session).toMatch(GATE_SESSION);
      expect(session).not.toBe(affinity);
    }
  });

  test("conversion is stable so one conversation keeps one session", () => {
    expect(openCodeSessionIdFromAffinity("aff_abc")).toBe(openCodeSessionIdFromAffinity("aff_abc"));
    expect(openCodeSessionIdFromAffinity("aff_abc")).not.toBe(openCodeSessionIdFromAffinity("aff_abd"));
  });

  test("a caller's real session id passes through untouched", () => {
    const real = "ses_ee1dca2ecffe5drtMEOhoZEnQ1";
    expect(openCodeSessionIdFromAffinity(real)).toBe(real);
  });

  test("the header carries a gate-shaped session with and without affinity", () => {
    expect(buildOpenCodeHeaders()["x-opencode-session"]).toMatch(GATE_SESSION);
    expect(buildOpenCodeHeaders(undefined, "aff_abc")["x-opencode-session"]).toMatch(GATE_SESSION);
  });

  test("the user-agent is the opencode/<version> token the gate compares", () => {
    expect(buildOpenCodeHeaders("1.18.35")["user-agent"]).toBe("opencode/1.18.35");
  });
});

describe("opencode agent tools: gate applies per model, not per provider", () => {
  test("zen: a free-tier id gains read+bash and streaming", () => {
    const prepared = prepare(OPENCODE_ZEN_SPEC, "nemotron-3-ultra-free", false);
    expect(prepared.stream).toBe(true);
    expect(prepared.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "bash"]));
  });

  test("zen: a free-tier id without the `-free` suffix is covered too", () => {
    const prepared = prepare(OPENCODE_ZEN_SPEC, "big-pickle", true);
    expect(prepared.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "bash"]));
  });

  test("zen: a caller-declared tool set is preserved, not replaced", () => {
    const withTools = {
      ...request("nemotron-3-ultra-free", true),
      tools: [{ name: "web_search", description: "Search.", jsonSchema: { type: "object", properties: {} } }],
    } as CanonicalRequest;
    const prepared = OPENCODE_ZEN_SPEC.prepareRequest?.(withTools) ?? withTools;
    const names = prepared.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("web_search");
    expect(names).toEqual(expect.arrayContaining(["read", "bash"]));
  });

  test("zen: a billed id keeps the caller's request untouched", () => {
    const bare = request("gpt-5.5", false);
    expect(OPENCODE_ZEN_SPEC.prepareRequest?.(bare)).toBe(bare);
  });

  test("free: every request gains the fingerprint", () => {
    const prepared = prepare(OPENCODE_FREE_SPEC, "mimo-v2.6-flash-free", false);
    expect(prepared.stream).toBe(true);
    expect(prepared.tools?.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "bash"]));
  });

  test("go: stays API-key-only with no request rewriting", () => {
    expect(OPENCODE_GO_SPEC.prepareRequest).toBeUndefined();
  });
});
