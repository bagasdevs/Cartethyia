import { describe, expect, test } from "bun:test";
import { computeTokensPerSec, MIN_DECODE_WINDOW_MS } from "../../src/observability/token-speed";

describe("computeTokensPerSec", () => {
  test("streaming uses the observed decode window, excluding TTFT", () => {
    // 100 output tokens decoded over 1.5s of observed streaming.
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 1000,
        lastEventAtMs: 2500,
      }),
    ).toBeCloseTo(66.67, 1);
  });

  test("a stream whose content arrives in one burst does not report burst speed", () => {
    // Measured in production: a bridge that flushes the whole answer as one
    // SSE frame leaves `first` and `last` 1-8ms apart, so dividing by that
    // span reports 8000-9125 tok/s for a turn that really ran at ~3-6 tok/s.
    // The decode phase happened upstream inside TTFT and is not observable,
    // so the row must fall back to end-to-end effective speed.
    expect(
      computeTokensPerSec({
        outputTokens: 73,
        latencyMs: 11855,
        stream: true,
        firstContentDeltaAtMs: 1790671488636,
        lastEventAtMs: 1790671488644,
      }),
    ).toBeCloseTo(6.16, 1);
  });

  test("the burst guard starts at the documented threshold, not before", () => {
    const at = (decodeMs: number) =>
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 1000,
        lastEventAtMs: 1000 + decodeMs,
      });
    // One millisecond under the threshold still reads as a burst; at it, the
    // observed window is trusted.
    expect(at(MIN_DECODE_WINDOW_MS - 1)).toBeCloseTo(50, 1);
    expect(at(MIN_DECODE_WINDOW_MS)).toBeCloseTo(200, 1);
  });

  test("a real decode window narrower than the guard loses nothing measurable", () => {
    // The guard cannot be gamed upward: a genuine 400ms decode of 300 tokens
    // (750 tok/s) is implausible next to the same turn's end-to-end speed,
    // so the conservative reading is the honest one.
    const tps = computeTokensPerSec({
      outputTokens: 300,
      latencyMs: 1000,
      stream: true,
      firstContentDeltaAtMs: 1000,
      lastEventAtMs: 1400,
    });
    expect(tps).toBeCloseTo(300, 1);
    expect(tps).toBeLessThan(1000);
  });

  test("non-streaming falls back to end-to-end effective speed", () => {
    // Regression: 39 completion tokens over 3.3s total used to divide by
    // ~5ms of (latency - TTFT) local overhead and report ~7800 tok/s.
    const tps = computeTokensPerSec({ outputTokens: 39, latencyMs: 3300, stream: false });
    expect(tps).toBeCloseTo(11.82, 1);
    expect(tps).toBeLessThan(100);
  });

  test("non-streaming ignores internal event timings", () => {
    // Non-streaming dispatches also observe upstream-event timestamps, but
    // those spans measure local response processing, not decode: 39 tokens
    // over a 5ms internal window must not report 7800 tok/s.
    expect(
      computeTokensPerSec({
        outputTokens: 39,
        latencyMs: 3300,
        stream: false,
        firstContentDeltaAtMs: 1789459419575,
        lastEventAtMs: 1789459419580,
      }),
    ).toBeCloseTo(11.82, 1);
  });

  test("single-chunk stream with a zero-width window falls back to effective speed", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 200,
        latencyMs: 800,
        stream: true,
        firstContentDeltaAtMs: 500,
        lastEventAtMs: 500,
      }),
    ).toBeCloseTo(250, 1);
  });

  test("streaming without event timing falls back to effective speed", () => {
    expect(
      computeTokensPerSec({ outputTokens: 100, latencyMs: 2000, stream: true, firstContentDeltaAtMs: 500 }),
    ).toBeCloseTo(50, 1);
  });

  test("returns undefined without output tokens", () => {
    expect(computeTokensPerSec({ latencyMs: 2000 })).toBeUndefined();
    expect(
      computeTokensPerSec({
        outputTokens: 0,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 1,
        lastEventAtMs: 2,
      }),
    ).toBeUndefined();
  });

  test("returns undefined without elapsed time", () => {
    expect(computeTokensPerSec({ outputTokens: 100, latencyMs: 0 })).toBeUndefined();
  });
});
