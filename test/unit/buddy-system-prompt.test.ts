/**
 * Pins the buddy-family leading-turn wire shape.
 *
 * Two things are being protected at once, and they pull in opposite
 * directions, so both are asserted:
 *
 * 1. The caller's `system`/`developer` text must survive. It used to be
 *    dropped outright, so a client ran without the instructions it configured
 *    (agent rules, tool contracts).
 * 2. The variant's prompt must stay the FIRST text in that turn. Upstream
 *    shipped a fix that *substituted* caller text for the prompt and reverted
 *    it (`bc49e0e`) after CodeBuddy answered `400 · 11128` on every request.
 *    Appending is a different shape from substituting, and that is the whole
 *    reason this file exists: a future "cleanup" that collapses these into one
 *    must fail here rather than silently park every buddy account.
 *
 * Not covered (cannot be, without live credentials): whether the upstream
 * accepts the appended shape. See the UNVERIFIED note on the implementation.
 */
import { describe, expect, test } from "bun:test";
import {
  applyBuddySystemPrompt,
  finalizeBuddyMessages,
} from "../../src/providers/integrations/buddy/buddy-chat-shared";

const PERSONA = "PERSONA: you are the buddy variant.";
const CANARY = "CANARY: caller instructions that must survive.";

type Message = Record<string, unknown>;

function apply(input: Array<Message>): Array<Message> {
  const messages = input.map((m) => ({ ...m }));
  applyBuddySystemPrompt(messages, PERSONA);
  return messages;
}

function leadingText(messages: Array<Message>): string {
  const content = messages[0]?.["content"];
  return typeof content === "string" ? content : "";
}

describe("buddy leading system turn", () => {
  test("opens with a system turn", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    expect(out[0]?.["role"]).toBe("system");
  });

  test("keeps the variant prompt first when the caller sent none", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    expect(leadingText(out)).toBe(PERSONA);
  });

  test("keeps the caller system text instead of dropping it", () => {
    const out = apply([
      { role: "system", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(leadingText(out)).toContain(CANARY);
  });

  test("keeps the persona FIRST — this is what separates append from substitute", () => {
    // The reverted upstream shape put caller text in the persona's slot. If a
    // change ever makes this false, buddy accounts are one deploy from being
    // parked on 11128.
    const out = apply([
      { role: "system", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(leadingText(out).startsWith(PERSONA)).toBe(true);
  });

  test("carries a developer turn's text without forwarding the role", () => {
    const out = apply([
      { role: "developer", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(leadingText(out)).toContain(CANARY);
    expect(leadingText(out).startsWith(PERSONA)).toBe(true);
    // The buddy upstream refuses the `developer` role itself.
    expect(out.some((m) => m["role"] === "developer")).toBe(false);
  });

  test("read text out of typed content parts, not just bare strings", () => {
    const out = apply([
      { role: "system", content: [{ type: "text", text: CANARY }] },
      { role: "user", content: "hi" },
    ]);
    expect(leadingText(out)).toContain(CANARY);
  });

  test("collapses several caller turns into one leading turn", () => {
    const out = apply([
      { role: "system", content: "CANARY: one." },
      { role: "developer", content: "CANARY: two." },
      { role: "user", content: "hi" },
    ]);
    const systemTurns = out.filter((m) => m["role"] === "system");
    expect(systemTurns).toHaveLength(1);
    expect(leadingText(out)).toContain("CANARY: one.");
    expect(leadingText(out)).toContain("CANARY: two.");
  });

  test("rebuilds bare string user content as a typed text block", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    const user = out.find((m) => m["role"] === "user");
    expect(user?.["content"]).toEqual([{ type: "text", text: "hi" }]);
  });

  test("finalizeBuddyMessages still guarantees a leading system turn", () => {
    const messages: Array<Message> = [{ role: "user", content: "hi" }];
    finalizeBuddyMessages(messages, PERSONA);
    expect(messages[0]?.["role"]).toBe("system");
    expect(String(messages[0]?.["content"])).toContain(PERSONA);
  });
});
