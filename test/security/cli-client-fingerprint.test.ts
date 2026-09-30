import { describe, expect, test } from "bun:test";
import {
  allowsCliToolMappings,
  detectRemoteCliToolId,
} from "../../src/security/cli-client-fingerprint";

describe("cli-client fingerprint", () => {
  test("labels Claude Code API and MCP User-Agents as the claude tool", () => {
    expect(
      detectRemoteCliToolId({ userAgent: "claude-cli/2.1.280 (external, cli)" }),
    ).toBe("claude");
    expect(
      detectRemoteCliToolId({ userAgent: "claude-cli/2.1.278 (external, sdk-cli)" }),
    ).toBe("claude");
    expect(detectRemoteCliToolId({ userAgent: "claude-code/2.1.280" })).toBe("claude");
    expect(
      detectRemoteCliToolId({
        headers: new Headers({ "user-agent": "claude-cli/2.0.0 (external, cli)" }),
      }),
    ).toBe("claude");
  });

  test("does not label Codex, Cline, curl, or bare SDKs", () => {
    for (const userAgent of [
      "codex_cli_rs/0.155.1",
      "Cline/3.0.58",
      "curl/8.8.0",
      "OpenAI/Python 2.51.0",
      "opencode/1.18.32 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.14",
      "Bun/1.3.14",
      "",
    ]) {
      expect(detectRemoteCliToolId({ userAgent })).toBeNull();
    }
    expect(detectRemoteCliToolId({})).toBeNull();
    expect(detectRemoteCliToolId({ userAgent: null })).toBeNull();
  });

  test("allows CLI mappings only with scope plus a remote CLI User-Agent", () => {
    const scopes = ["routing:invoke", "routing:cli_mapping"] as const;
    expect(
      allowsCliToolMappings(scopes, { userAgent: "claude-cli/2.1.280 (external, cli)" }),
    ).toBe(true);
    expect(allowsCliToolMappings(scopes, { userAgent: "codex_cli_rs/0.155.1" })).toBe(false);
    expect(allowsCliToolMappings(scopes, {})).toBe(false);
    expect(
      allowsCliToolMappings(["routing:invoke"], {
        userAgent: "claude-cli/2.1.280 (external, cli)",
      }),
    ).toBe(false);
  });
});
