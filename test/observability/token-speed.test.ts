import { describe, expect, test } from "bun:test";
import { computeTokensPerSec, MIN_DECODE_WINDOW_MS } from "../../src/observability/token-speed";

// ── no measurement ──────────────────────────────────────────────────────────

describe("computeTokensPerSec — no measurement", () => {
  test("reports undefined with no output tokens", () => {
    expect(computeTokensPerSec({ latencyMs: 1000 })).toBeUndefined();
  });

  test("reports undefined for zero output tokens", () => {
    expect(computeTokensPerSec({ outputTokens: 0, latencyMs: 1000 })).toBeUndefined();
  });

  test("reports undefined for negative output tokens", () => {
    expect(computeTokensPerSec({ outputTokens: -5, latencyMs: 1000 })).toBeUndefined();
  });

  test("reports undefined when there is no elapsed time", () => {
    expect(computeTokensPerSec({ outputTokens: 100, latencyMs: 0 })).toBeUndefined();
    expect(computeTokensPerSec({ outputTokens: 100, latencyMs: -1 })).toBeUndefined();
  });

  test("never returns Infinity for a real measurement", () => {
    for (const input of [
      { outputTokens: 100, latencyMs: 0 },
      { outputTokens: 0, latencyMs: 0 },
      { outputTokens: 100, latencyMs: Number.NaN },
      { outputTokens: 100, latencyMs: Number.POSITIVE_INFINITY },
    ] as const) {
      const result = computeTokensPerSec(input as never);
      if (result !== undefined) expect(Number.isFinite(result)).toBe(true);
    }
  });

  test("a NaN output-token count reports no measurement", () => {
    expect(computeTokensPerSec({ outputTokens: Number.NaN, latencyMs: 1000 })).toBeUndefined();
  });

  test("an infinite latency reports no measurement", () => {
    expect(
      computeTokensPerSec({ outputTokens: 100, latencyMs: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
  });

  test("an infinite decode window reports no burst speed", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 1000,
        stream: true,
        firstContentDeltaAtMs: 0,
        lastEventAtMs: Number.POSITIVE_INFINITY,
      }),
    ).toBe(100); // falls through to effective speed: 100 / 1000 = 100
  });

  test("a NaN decode window reports no burst speed", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 1000,
        stream: true,
        firstContentDeltaAtMs: Number.NaN,
        lastEventAtMs: 1000,
      }),
    ).toBe(100);
  });
});

// ── streaming decode window ─────────────────────────────────────────────────

describe("computeTokensPerSec — the streaming decode window", () => {
  test("divides output tokens by the window between first delta and last event", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 5000,
        stream: true,
        firstContentDeltaAtMs: 4000,
        lastEventAtMs: 5000,
      }),
    ).toBe(100);
  });

  test("ignores the prefill phase, which is the whole point", () => {
    const fast = computeTokensPerSec({
      outputTokens: 100,
      latencyMs: 1500,
      stream: true,
      firstContentDeltaAtMs: 500,
      lastEventAtMs: 1500,
    });
    const slowPrefill = computeTokensPerSec({
      outputTokens: 100,
      latencyMs: 9000,
      stream: true,
      firstContentDeltaAtMs: 8000,
      lastEventAtMs: 9000,
    });
    expect(fast).toBe(100);
    expect(slowPrefill).toBe(100);
  });

  test("a burst frame does not report burst speed", () => {
    // Measured in production: a bridge that flushes the whole answer as one
    // SSE frame leaves `first` and `last` 1-8ms apart, so dividing by that
    // span reports 8000-9125 tok/s for a turn that really ran at ~3-6 tok/s.
    expect(
      computeTokensPerSec({
        outputTokens: 50,
        latencyMs: 8100,
        stream: true,
        firstContentDeltaAtMs: 0,
        lastEventAtMs: 6,
      }),
    ).toBeCloseTo(6.16, 1);
  });

  test("the burst guard starts at the documented threshold, not before", () => {
    const at = (decodeMs: number) =>
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 0,
        lastEventAtMs: decodeMs,
      });
    expect(at(MIN_DECODE_WINDOW_MS - 1)).toBeCloseTo(50, 1);
    expect(at(MIN_DECODE_WINDOW_MS)).toBeCloseTo(200, 1);
  });

  test("a real decode window narrower than the guard loses nothing measurable", () => {
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

  test("a zero-width window is not used", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 1000,
        lastEventAtMs: 1000,
      }),
    ).toBe(50);
  });

  test("a reversed window falls through rather than reporting a negative speed", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 1500,
        lastEventAtMs: 1000,
      }),
    ).toBe(50);
  });

  test("a stream with no observed deltas falls through to effective speed", () => {
    expect(computeTokensPerSec({ outputTokens: 100, latencyMs: 2000, stream: true })).toBe(50);
  });

  test("a stream with only the first delta observed falls through", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        firstContentDeltaAtMs: 500,
      }),
    ).toBe(50);
  });

  test("a stream with only the last event observed falls through", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: true,
        lastEventAtMs: 1500,
      }),
    ).toBe(50);
  });
});

// ── non-streaming fallback ──────────────────────────────────────────────────

describe("computeTokensPerSec — the non-streaming fallback", () => {
  test("a non-streaming request uses end-to-end effective speed", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        stream: false,
        firstContentDeltaAtMs: 1000,
        lastEventAtMs: 2000,
      }),
    ).toBe(50);
  });

  test("non-streaming ignores internal event timings", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 39,
        latencyMs: 3300,
        stream: false,
        firstContentDeltaAtMs: 1_789_459_419_575,
        lastEventAtMs: 1_789_459_419_580,
      }),
    ).toBeCloseTo(11.82, 1);
  });

  test("an absent stream flag is treated as non-streaming", () => {
    expect(
      computeTokensPerSec({
        outputTokens: 100,
        latencyMs: 2000,
        firstContentDeltaAtMs: 1000,
        lastEventAtMs: 2000,
      }),
    ).toBe(50);
  });

  test("the fallback is always well-defined and never exceeds the true speed", () => {
    const decodeSpeed = computeTokensPerSec({
      outputTokens: 100,
      latencyMs: 5000,
      stream: true,
      firstContentDeltaAtMs: 4000,
      lastEventAtMs: 5000,
    });
    const effectiveSpeed = computeTokensPerSec({ outputTokens: 100, latencyMs: 5000 });
    expect(decodeSpeed).toBe(100);
    expect(effectiveSpeed).toBe(20);
    expect(effectiveSpeed!).toBeLessThan(decodeSpeed!);
  });
});

// ── arithmetic ──────────────────────────────────────────────────────────────

describe("computeTokensPerSec — arithmetic", () => {
  test("scales linearly with token count", () => {
    const one = computeTokensPerSec({ outputTokens: 100, latencyMs: 1000 });
    const two = computeTokensPerSec({ outputTokens: 200, latencyMs: 1000 });
    expect(two).toBe(one! * 2);
  });

  test("scales inversely with elapsed time", () => {
    const fast = computeTokensPerSec({ outputTokens: 100, latencyMs: 1000 });
    const slow = computeTokensPerSec({ outputTokens: 100, latencyMs: 2000 });
    expect(slow).toBe(fast! / 2);
  });

  test("reports a fractional speed without rounding", () => {
    expect(computeTokensPerSec({ outputTokens: 1, latencyMs: 3000 })).toBeCloseTo(0.3333, 3);
  });

  test("handles a large token count without overflow", () => {
    const result = computeTokensPerSec({ outputTokens: 1_000_000, latencyMs: 1000 });
    expect(result).toBe(1_000_000);
    expect(Number.isFinite(result)).toBe(true);
  });

  test("handles a very short latency", () => {
    expect(computeTokensPerSec({ outputTokens: 10, latencyMs: 1 })).toBe(10_000);
  });
});
