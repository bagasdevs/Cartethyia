import { withBearerAuthentication, type OpenAICompatibleAdapterConfig } from "../../compatible-adapter";
import type { CanonicalRequest } from "../../../transport/canonical-model";
import type {
  ProviderDispatchContext,
  ProviderDispatchTarget,
  ProviderId,
} from "../../provider-registry";
import { resolvePromptCacheKey } from "../../operations/session-resolution";
import { buildCodeBuddyUserAgent } from "../../operations/client-versions";

/** Client identity variant behind the per-request CodeBuddy headers. */
export type CodeBuddyVariant = "IDE" | "CLI";

export function codebuddyDomain(variant: CodeBuddyVariant): string {
  return variant === "IDE" ? "www.codebuddy.ai" : "copilot.tencent.com";
}


/**
 * Per-request CodeBuddy headers — exact provider contract shared by the
 * international (IDE identity) and CN (CLI identity). The conversation id is
 * the dispatch affinity when available (it already unifies body key, inbound
 * headers, and derived fallback), else the same resolver, else a fresh id;
 * request IDs always rotate.
 */
export async function codebuddyHeaders(
  variant: CodeBuddyVariant,
  context?: ProviderDispatchContext,
  request?: CanonicalRequest,
): Promise<Record<string, string>> {
  const identity = variant === "IDE" ? "IDE" : "CLI";
  const ua = buildCodeBuddyUserAgent(identity);
  return {
    accept: "text/event-stream",
    "User-Agent": ua,
    "X-Product": "SaaS",
    "X-IDE-Type": identity,
    "X-IDE-Name": identity,
    "X-Domain": codebuddyDomain(variant),
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
    "x-conversation-id":
      context?.conversation_affinity ?? resolvePromptCacheKey(request, context) ?? crypto.randomUUID(),
    "x-request-id": crypto.randomUUID().replaceAll("-", ""),
  };
}

/**
 * Shared OpenAI-compatible chat-adapter config for both CodeBuddy variants:
 * bearer auth, chat-only wire contract, per-request identity headers, and the
 * variant's payload hook.
 */
export function codebuddyAdapterConfig(args: {
  providerId: ProviderId;
  baseUrl: string;
  variant: CodeBuddyVariant;
  prePayload: (
    payload: Record<string, unknown>,
    request: CanonicalRequest,
    candidate: ProviderDispatchTarget,
  ) => void;
  fetchImpl?: typeof fetch;
}): OpenAICompatibleAdapterConfig {
  return withBearerAuthentication({
    provider_id: args.providerId,
    base_url: args.baseUrl,
    buildExtraHeaders: (context, request) => codebuddyHeaders(args.variant, context, request),
    prePayload: args.prePayload,
    // CodeBuddy reuses Anthropic usage field names but reports an all-in
    // `input_tokens` with the cached count as a subset of it.
    usage_cache_shape: "inclusive",
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
  });
}
