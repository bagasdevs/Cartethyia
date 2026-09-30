/**
 * The public error message is `code: explanatory` for every origin.
 *
 * Origin branding (`Cartethyia Error:`, `Upstream Error:`, …) used to be
 * stamped into the message so a client that only printed `message` could tell
 * who failed. Clients already receive a structured `origin` field, and the
 * product prefix made every gateway defect look like a branded product fault.
 * Blame stays in `origin`; the message names the stable code plus the
 * explanatory text — upstream and gateway look the same on the wire.
 */
import { describe, expect, test } from "bun:test";
import {
  GatewayError,
  explainGatewayError,
  formatPublicErrorMessage,
} from "../../src/transport/gateway-error";

describe("public error message format", () => {
  test("an upstream failure is code + explanatory, never product-branded", () => {
    const error = new GatewayError("authentication_failed", 401, "invalid api key", {}, "upstream");
    const message = explainGatewayError(error);
    expect(message).toBe("authentication_failed: invalid api key");
    expect(message).not.toInclude("Cartethyia");
    expect(message).not.toInclude("Upstream Error");
  });

  test("a gateway failure is code + explanatory", () => {
    const error = new GatewayError("invalid_request", 400, "model is required");
    expect(explainGatewayError(error)).toBe("invalid_request: model is required");
  });

  test("a network failure uses the same code + explanatory shape", () => {
    const error = new GatewayError("proxy_unreachable", 502, "tunnel refused", {}, "network");
    expect(explainGatewayError(error)).toBe("proxy_unreachable: tunnel refused");
  });

  test("the code prefix is applied exactly once", () => {
    const once = formatPublicErrorMessage("invalid_request", "model is required");
    expect(once).toBe("invalid_request: model is required");
    expect(formatPublicErrorMessage("invalid_request", once)).toBe(once);
  });

  test("legacy origin brand prefixes are stripped before formatting", () => {
    expect(
      formatPublicErrorMessage("quota_exceeded", "Upstream Error: quota exhausted"),
    ).toBe("quota_exceeded: quota exhausted");
    expect(
      formatPublicErrorMessage("internal_error", "Cartethyia Error: Internal server error"),
    ).toBe("internal_error: Internal server error");
  });
});
