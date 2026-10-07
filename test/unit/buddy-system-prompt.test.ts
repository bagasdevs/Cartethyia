/**
 * Pins the buddy-family leading-turn wire shape.
 *
 * Two things are being protected at once, and they pull in opposite
 * directions, so both are asserted:
 *
 * 1. The caller's `system`/`developer` text must survive. It used to be
 *    dropped outright, so a client ran without the instructions it configured
 *    (agent rules, tool contracts).
 * 2. The variant's prompt must be the ONLY thing in the system turn. Upstream
 *    shipped a fix that substituted caller text for the prompt and reverted it
 *    (`bc49e0e`) after CodeBuddy answered `400 · 11128`. Appending behind the
 *    prompt works but degrades cache: measured live, a caller text that varies
 *    per request collapses the upstream's cached prefix from 640 to 256
 *    tokens (81% -> 32%) because the varying text sits inside the cached
 *    prefix. Carrying it as the first user turn keeps the prefix stable.
 *
 * So the shape is: [system: persona] [user: caller text] [...rest].
 * A future "cleanup" that folds the caller text back into the system turn
 * must fail here rather than silently cut the cache hit rate in half.
 *
 * Verified live on cb/deepseek-v4.1-flash: HTTP 200, no 11128, and the model
 * answers in the persona the caller's system text demanded.
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

/** Every user-turn text, in order. */
function userTexts(messages: Array<Message>): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m["role"] !== "user") continue;
    const c = m["content"];
    if (typeof c === "string") {
      parts.push(c);
      continue;
    }
    if (Array.isArray(c)) {
      for (const block of c) {
        if (
          block !== null &&
          typeof block === "object" &&
          (block as Record<string, unknown>)["type"] === "text"
        ) {
          parts.push(String((block as Record<string, unknown>)["text"] ?? ""));
        }
      }
    }
  }
  return parts.join("\n");
}

describe("buddy leading system turn", () => {
  test("opens with a system turn", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    expect(out[0]?.["role"]).toBe("system");
  });

  test("system turn holds the persona and nothing else", () => {
    const out = apply([
      { role: "system", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(leadingText(out)).toBe(PERSONA);
  });

  test("carries the caller system text as a user turn instead of dropping it", () => {
    const out = apply([
      { role: "system", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(userTexts(out)).toContain(CANARY);
  });

  test("put the caller text BEFORE the caller's own messages", () => {
    // The whole point of the shape: the caller's instructions land in front of
    // the conversation, not behind it.
    const out = apply([
      { role: "system", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(userTexts(out).indexOf(CANARY)).toBeLessThan(userTexts(out).indexOf("hi"));
  });

  test("carries a developer turn's text without forwarding the role", () => {
    const out = apply([
      { role: "developer", content: CANARY },
      { role: "user", content: "hi" },
    ]);
    expect(userTexts(out)).toContain(CANARY);
    // The buddy upstream refuses the `developer` role itself.
    expect(out.some((m) => m["role"] === "developer")).toBe(false);
  });

  test("read text out of typed content parts, not just bare strings", () => {
    const out = apply([
      { role: "system", content: [{ type: "text", text: CANARY }] },
      { role: "user", content: "hi" },
    ]);
    expect(userTexts(out)).toContain(CANARY);
  });

  test("collapses several caller turns into one carried user turn", () => {
    const out = apply([
      { role: "system", content: "CANARY: one." },
      { role: "developer", content: "CANARY: two." },
      { role: "user", content: "hi" },
    ]);
    expect(out.filter((m) => m["role"] === "system")).toHaveLength(1);
    expect(userTexts(out)).toContain("CANARY: one.");
    expect(userTexts(out)).toContain("CANARY: two.");
  });

  test("rebuilds bare string user content as a typed text block", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    const user = out.find((m) => m["role"] === "user");
    expect(user?.["content"]).toEqual([{ type: "text", text: "hi" }]);
  });

  test("adds no user turn when the caller sent no system text", () => {
    const out = apply([{ role: "user", content: "hi" }]);
    expect(out.filter((m) => m["role"] === "user")).toHaveLength(1);
    expect(userTexts(out)).toBe("hi");
  });

  test("finalizeBuddyMessages still guarantees a leading system turn", () => {
    const messages: Array<Message> = [{ role: "user", content: "hi" }];
    finalizeBuddyMessages(messages, PERSONA);
    expect(messages[0]?.["role"]).toBe("system");
    expect(String(messages[0]?.["content"])).toContain(PERSONA);
  });
});
