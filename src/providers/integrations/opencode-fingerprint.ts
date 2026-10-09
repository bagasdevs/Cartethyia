import { createHash } from "node:crypto";
import { getOpenCodeVersion } from "../operations/client-versions";

let lastTimestamp = 0;
let sequenceCounter = 0;

/** Base62 alphabet the official client's session-id suffix is drawn from. */
const SESSION_SUFFIX_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The session-id shape upstream's free-tier gate accepts: `ses_` + 12 lowercase
 * hex + 14 base62 characters, exactly.
 *
 * The gate reads this value, not just the headers around it: a request whose
 * `x-opencode-session` is anything else — a caller's `aff_…` cache affinity,
 * an inbound `x-session-id`, a UUID — is answered `403 FreeTierError` even
 * when every other header matches the official client. Verified against the
 * live endpoint: the 12 hex characters may be arbitrary (`ses_000000000000…`
 * is accepted), so a derived id only has to keep the shape.
 */
const OPENCODE_SESSION_ID_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

/**
 * Generate a valid OpenCode session identifier matching official binary:
 * `ses_` + 12-char hex (bitwise inverted millisecond timestamp * 4096 + seq) + 14-char base62.
 */
export function generateOpenCodeSessionId(now = Date.now()): string {
  if (now !== lastTimestamp) {
    lastTimestamp = now;
    sequenceCounter = 0;
  }
  sequenceCounter++;
  const num = BigInt(now) * 0x1000n + BigInt(sequenceCounter);
  const inverted = ~num;
  const hex = Array.from({ length: 6 }, (_, i) =>
    Number((inverted >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, "0"),
  ).join("");
  const rand = crypto.getRandomValues(new Uint8Array(14));
  const suffix = Array.from(rand, (byte) => SESSION_SUFFIX_CHARS[byte % 62]).join("");
  return `ses_${hex}${suffix}`;
}

/** Generate a valid OpenCode message/request identifier: `msg_` + 30-char hex. */
export function generateOpenCodeRequestId(): string {
  return `msg_${crypto.randomUUID().replaceAll("-", "").slice(0, 30)}`;
}

/**
 * Gate-shaped session id for an arbitrary affinity string.
 *
 * The gateway derives `conversation_affinity` from whatever the caller sent
 * (an inbound session header, a prompt-cache key, or a hash of the opening
 * turn) and hands it here as the upstream session. That value is not a
 * `ses_…` id, and sending it verbatim is what the free-tier gate rejects — so
 * it is hashed into the accepted shape instead. Deterministic on purpose: the
 * same conversation keeps one upstream session, which is the affinity's whole
 * job. A value that is already gate-shaped passes through untouched, so a real
 * OpenCode client proxied through the gateway keeps its own session id.
 */
export function openCodeSessionIdFromAffinity(affinity: string): string {
  if (OPENCODE_SESSION_ID_PATTERN.test(affinity)) return affinity;
  const digest = createHash("sha256").update(affinity).digest();
  const hex = digest.subarray(0, 6).toString("hex");
  const suffix = Array.from(digest.subarray(6, 20), (byte) => SESSION_SUFFIX_CHARS[byte % 62]).join("");
  return `ses_${hex}${suffix}`;
}

/** Build fingerprint headers, reusing a stable session when affinity is known. */
export function buildOpenCodeHeaders(
  version = getOpenCodeVersion(),
  affinity?: string,
): Record<string, string> {
  return {
    "x-opencode-client": "cli",
    "x-opencode-session": affinity === undefined ? generateOpenCodeSessionId() : openCodeSessionIdFromAffinity(affinity),
    "x-opencode-request": generateOpenCodeRequestId(),
    "x-opencode-project": "global",
    "user-agent": `opencode/${version}`,
  };
}
