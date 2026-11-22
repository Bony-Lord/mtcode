import {
  CODEX_SHARING_CONTINUATION_HINT,
  CODEX_SHARING_UNSUPPORTED_CAPABILITY_CODE,
} from "@t3tools/shared/orchestrationV2ThreadError";

const legacyFailures = {
  subscription_sharing_v2_user_not_eligible: {
    message:
      "ChatGPT sharing is unavailable for this account or workspace. Use another provider or check its sharing policy.",
  },
  subscription_sharing_usage_limit_exceeded: {
    message:
      "Your ChatGPT usage limit was reached. Check ChatGPT Usage settings for your available allowance.",
  },
  subscription_sharing_workplace_individual_usage_limit_exceeded: {
    message:
      "You reached your workspace's limit for using ChatGPT in other apps. Ask your workspace admin to increase it.",
  },
  subscription_sharing_usage_unavailable: {
    message: "ChatGPT usage is temporarily unavailable. Try again shortly.",
  },
  [CODEX_SHARING_UNSUPPORTED_CAPABILITY_CODE]: {
    message: `Codex used a feature that ChatGPT sharing does not support. ${CODEX_SHARING_CONTINUATION_HINT}`,
  },
  subscription_sharing_v2_client_not_enabled: {
    message:
      "This app is not enabled for this ChatGPT connection. Use your existing CLI or another provider.",
  },
  subscription_sharing_v2_route_not_supported: {
    message: "ChatGPT does not support this request route.",
  },
  subscription_sharing_v2_invalid_user: {
    message:
      "ChatGPT could not validate this connection. Check the selected account and sharing permissions.",
  },
  subscription_sharing_v2_user_unavailable: {
    message: "ChatGPT is temporarily unavailable. Try again shortly.",
  },
} as const;
const failures = {
  ...legacyFailures,
  subscription_sharing_user_not_eligible: legacyFailures.subscription_sharing_v2_user_not_eligible,
  subscription_sharing_route_not_supported:
    legacyFailures.subscription_sharing_v2_route_not_supported,
  subscription_sharing_invalid_user: legacyFailures.subscription_sharing_v2_invalid_user,
  subscription_sharing_user_unavailable: legacyFailures.subscription_sharing_v2_user_unavailable,
  chatpass_v2_scope_not_authorized: {
    message:
      "This ChatGPT grant does not authorize the request. Check the connection's sharing permissions.",
  },
  chatpass_v2_invalid_authorization_context: {
    message:
      "ChatGPT could not authorize this connection. Check the client and sharing permissions.",
  },
};
const usageLimitCodes = new Set<string>([
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_workplace_individual_usage_limit_exceeded",
]);

function unwrapError(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return value;
    }
  }
  return typeof value === "object" && value !== null && "error" in value ? value.error : value;
}

function isManagedCode(value: unknown): value is keyof typeof failures {
  return typeof value === "string" && Object.hasOwn(failures, value);
}

function sharingCode(value: unknown) {
  const error = unwrapError(value);
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : error;
  return isManagedCode(code) ? code : undefined;
}

export function classifyCodexManagedError(value: unknown) {
  const error = unwrapError(value);
  const messages =
    typeof error === "string"
      ? [error]
      : typeof error === "object" && error !== null
        ? [
            "message" in error ? error.message : null,
            "additionalDetails" in error ? error.additionalDetails : null,
          ].filter((message): message is string => typeof message === "string")
        : [];
  const code =
    sharingCode(error) ??
    messages.map(sharingCode).find((code) => code !== undefined) ??
    // Codex can stream ChatGPT's sharing-limit prose without its code.
    (messages.some((message) =>
      message.includes("has reached their Subscription Sharing usage limit"),
    )
      ? "subscription_sharing_usage_limit_exceeded"
      : undefined);
  if (code === undefined) return undefined;
  const failure = { ...failures[code], code, usageLimit: usageLimitCodes.has(code) };
  const text = messages.join(" ");
  if (code === CODEX_SHARING_UNSUPPORTED_CAPABILITY_CODE) {
    const rejectedInput = [error, ...messages.map(unwrapError)].some(
      (detail) =>
        typeof detail === "object" &&
        detail !== null &&
        "param" in detail &&
        detail.param === "input",
    );
    if (text.includes("tool 'namespace'"))
      return {
        ...failure,
        message: `Codex sent a tool namespace that ChatGPT sharing does not support. ${CODEX_SHARING_CONTINUATION_HINT}`,
      };
    if (rejectedInput || text.includes("additional_tools"))
      return {
        ...failure,
        message: `ChatGPT sharing rejected an input item in the Codex session. ${CODEX_SHARING_CONTINUATION_HINT}`,
      };
  }
  return failure;
}
