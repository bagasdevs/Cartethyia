/**
 * Which wire a discovered model lands on when two sources disagree.
 *
 * The generic `/models` fetcher infers `chat`/`responses` from the model id and
 * knows nothing about a provider's own families, while the provider's
 * compatibility profile states a per-model rule the operator owns. A `chat`
 * row written for a Responses-only id is not a cosmetic mismatch: the router
 * dispatches it and upstream answers `ModelProtocolUnsupported` (400) on every
 * request, and a 400 is not retryable, so the sibling responses row is never
 * reached. The profile rule must therefore win.
 *
 * The same merge keeps a discovery module's own family (cline ships
 * `/chat/completions`) when the provider states no rule for that id, and still
 * discards a guess the provider's declared families do not admit.
 */
import { expect, test } from "bun:test";
import { applyDiscoveredWire } from "../../src/providers/discovery/probe-wire";

test("a profile rule beats the discovery module's id-shaped guess", () => {
  const wire = applyDiscoveredWire({
    resolvedWireFamily: "responses",
    resolvedEndpointPath: "/zen/v1/responses",
    profileMatched: true,
    discoveredWireFamily: "chat",
    discoveredEndpointPath: "/zen/v1/chat/completions",
  });
  expect(wire).toEqual({ wireFamily: "responses", endpointPath: "/zen/v1/responses" });
});

test("without a profile rule the discovery module's own family still wins", () => {
  const wire = applyDiscoveredWire({
    resolvedWireFamily: "chat",
    resolvedEndpointPath: "/v1/chat/completions",
    discoveredWireFamily: "chat",
    discoveredEndpointPath: "/chat/completions",
    staticEndpoints: { chat: "/chat/completions" },
  });
  expect(wire).toEqual({ wireFamily: "chat", endpointPath: "/chat/completions" });
});

test("a guess outside the provider's declared families is still discarded", () => {
  const wire = applyDiscoveredWire({
    resolvedWireFamily: "messages",
    resolvedEndpointPath: "/v1/messages",
    discoveredWireFamily: "chat",
    discoveredEndpointPath: "/v1/chat/completions",
    supportedWireFamilies: ["messages"],
  });
  expect(wire).toEqual({ wireFamily: "messages", endpointPath: "/v1/messages" });
});
