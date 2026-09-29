import type { CanonicalEvent, CanonicalRequest, WireFamily } from "../transport/canonical-model";
import { canonicalToChatPayload } from "./request/chat";
import { canonicalToResponsesPayload } from "./request/responses";
import { canonicalToClaudeMessagesPayload } from "./request/messages";
import { decodeChatSseStream, parseChatResponseToEvents } from "./response/chat";
import { decodeResponsesSseStream, parseResponsesResponseToEvents } from "./response/responses";
import { claudeResponseToEvents, parseClaudeSseStream } from "./response/messages";
import type { UsageCacheShape } from "../providers/usage";

export interface CodecContext {
  readonly isOAuth?: boolean;
  readonly sessionId?: string;
  readonly supportsPromptCaching?: boolean;
  readonly signal?: AbortSignal;
  /**
   * Upstream cache-token accounting for usage frames decoded under this
   * context. Set by adapters for upstreams whose usage fields lie about the
   * shape (CodeBuddy/Tencent buddy family) so the canonical total is not
   * double-counted. See `UsageCacheShape`.
   */
  readonly usageCacheShape?: UsageCacheShape;
}

export function encodeWireRequest(
  wireFamily: WireFamily,
  request: CanonicalRequest,
  context?: CodecContext,
): Record<string, unknown> {
  switch (wireFamily) {
    case "chat":
      return canonicalToChatPayload(request, context?.supportsPromptCaching !== false);
    case "responses":
      return canonicalToResponsesPayload(request, context?.supportsPromptCaching !== false);
    case "messages":
      return canonicalToClaudeMessagesPayload(request, {
        ...(context?.isOAuth === undefined ? {} : { isOAuth: context.isOAuth }),
      });
    default:
      throw new Error(`unsupported wire family: ${wireFamily}`);
  }
}

export function decodeWireResponse(
  wireFamily: WireFamily,
  json: Record<string, unknown>,
  request: CanonicalRequest,
  context?: CodecContext,
): readonly CanonicalEvent[] {
  switch (wireFamily) {
    case "chat":
      return parseChatResponseToEvents(json, request, context?.usageCacheShape);
    case "responses":
      return parseResponsesResponseToEvents(json, request);
    case "messages":
      return claudeResponseToEvents(json, request, context?.isOAuth ?? false);
    default:
      throw new Error(`unsupported wire family: ${wireFamily}`);
  }
}

export function decodeWireStream(
  wireFamily: WireFamily,
  body: ReadableStream<Uint8Array>,
  request: CanonicalRequest,
  context?: CodecContext,
): AsyncIterable<CanonicalEvent> {
  switch (wireFamily) {
    case "chat":
      return decodeChatSseStream(body, request, context?.signal, context?.usageCacheShape);
    case "responses":
      return decodeResponsesSseStream(body, request, context?.signal);
    case "messages":
      return parseClaudeSseStream(body, context?.signal, context?.isOAuth ?? false);
    default:
      throw new Error(`unsupported wire family: ${wireFamily}`);
  }
}
