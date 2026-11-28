import type {
  OrchestrationV2ProviderFailure,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const CODEX_SHARING_UNSUPPORTED_CAPABILITY_CODE =
  "subscription_sharing_unsupported_capability";
export const CODEX_SHARING_USER_NOT_ELIGIBLE_CODE = "subscription_sharing_user_not_eligible";
export const CODEX_SHARING_CONTINUATION_HINT =
  "Choose regular Codex or another supported provider, then send a message to continue in this chat.";

export function isCodexSharingEligibilityFailure(
  code: string | null | undefined,
  message: string,
): boolean {
  return (
    code === CODEX_SHARING_USER_NOT_ELIGIBLE_CODE ||
    code === "subscription_sharing_v2_user_not_eligible" ||
    /\bthe chatgpt user is not eligible for subscription sharing\b/i.test(message)
  );
}

export function isCodexModelAtCapacity(message: string): boolean {
  return /\bselected model is at capacity\b/i.test(message);
}

type ErrorTurnItem = Extract<OrchestrationV2TurnItem, { type: "error" }>;
/** Only error items are read, so callers may pass items stripped of other fields. */
type FailureScanTurnItem =
  | ErrorTurnItem
  | { readonly type: Exclude<OrchestrationV2TurnItem["type"], "error"> };

export type AutoRouteFailureReason =
  | "sharing_forbidden"
  | "usage_limit"
  | "free_limit"
  | "transient_eof"
  | "model_capacity"
  | "provider_error";

/** Keep Auto's exclusion reasons inspectable without collapsing provider failures into one bucket. */
export function autoRouteFailureReason(
  failure: OrchestrationV2ProviderFailure,
): AutoRouteFailureReason {
  const code = failure.code?.toLowerCase() ?? "";
  const message = failure.message.toLowerCase();
  if (
    code === "provider.free-limit" ||
    (failure.class === "usage_limit" &&
      (code.includes("free") || message.includes("free-models-per-min")))
  )
    return "free_limit";
  if (
    failure.class === "usage_limit" ||
    code.includes("usage_limit") ||
    code.includes("rate-limit")
  )
    return "usage_limit";
  if (
    isCodexSharingEligibilityFailure(code, message) ||
    code.startsWith("subscription_sharing_") ||
    code.startsWith("chatpass_v2_") ||
    ((code === "403" || code.includes("forbidden")) && message.includes("sharing"))
  )
    return "sharing_forbidden";
  if (code === "serveroverloaded" || isCodexModelAtCapacity(message)) return "model_capacity";
  if (
    failure.class === "transport_error" &&
    (code.includes("eof") || code.includes("streamdisconnected") || message.includes(" eof"))
  )
    return "transient_eof";
  return "provider_error";
}

export function latestRootProviderFailure(
  run: OrchestrationV2Run | null,
  turnItems: ReadonlyArray<FailureScanTurnItem>,
): OrchestrationV2ProviderFailure | null {
  if (run?.status !== "failed") return null;
  let latest: ErrorTurnItem | null = null;
  for (const item of turnItems) {
    if (
      item.type !== "error" ||
      item.status !== "failed" ||
      item.runId !== run.id ||
      item.nodeId !== run.rootNodeId
    )
      continue;
    if (
      latest === null ||
      DateTime.toEpochMillis(item.updatedAt) > DateTime.toEpochMillis(latest.updatedAt) ||
      (DateTime.toEpochMillis(item.updatedAt) === DateTime.toEpochMillis(latest.updatedAt) &&
        (item.ordinal > latest.ordinal || (item.ordinal === latest.ordinal && item.id > latest.id)))
    ) {
      latest = item;
    }
  }
  return latest?.failure ?? null;
}

export function threadErrorSummary(
  failure: OrchestrationV2ProviderFailure | null,
  sessionError: string | null,
) {
  const currentFailure =
    sessionError !== null && sessionError !== failure?.message ? null : failure;
  return {
    usageLimitResetAt:
      currentFailure?.class === "usage_limit" ? (currentFailure.resetAt ?? null) : null,
    lastError: sessionError ?? failure?.message ?? null,
    lastErrorClass: currentFailure?.class ?? null,
    lastErrorCode: currentFailure?.code ?? null,
  };
}

export function latestExecutedRun(
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | null {
  let latest: OrchestrationV2Run | null = null;
  for (const run of runs) {
    if (run.status === "queued") continue;
    if (run.status === "cancelled" && run.startedAt === null) continue;
    if (latest === null || runRanAfter(run, latest)) latest = run;
  }
  return latest;
}

/**
 * Work started now would run in the project checkout, not the worktree the thread asked for. A
 * failed or interrupted setup leaves the request standing until a worktree exists or later work
 * has run past it.
 */
export function orchestrationV2WorktreePending(
  worktreePath: string | null,
  runs: ReadonlyArray<OrchestrationV2Run>,
): boolean {
  const latest = latestExecutedRun(runs);
  return (
    worktreePath === null &&
    (latest?.status === "preparing" ||
      latest?.status === "failed" ||
      latest?.status === "interrupted") &&
    latest.workspacePreparation?.type === "worktree"
  );
}

/** Held queues can execute out of ordinal order; unfinished runs count as latest. */
export function runRanAfter(
  run: Pick<OrchestrationV2Run, "ordinal" | "completedAt">,
  other: Pick<OrchestrationV2Run, "ordinal" | "completedAt">,
): boolean {
  const end = (candidate: typeof run) =>
    !candidate.completedAt
      ? Number.POSITIVE_INFINITY
      : DateTime.toEpochMillis(candidate.completedAt);
  return end(run) === end(other) ? run.ordinal > other.ordinal : end(run) > end(other);
}

export function usageLimitBlockedRun(
  runs: ReadonlyArray<OrchestrationV2Run>,
  turnItems: ReadonlyArray<FailureScanTurnItem>,
  sessionError: string | null,
): OrchestrationV2Run | null {
  const executed = latestExecutedRun(runs);
  if (executed?.status !== "failed") return null;
  const summary = threadErrorSummary(latestRootProviderFailure(executed, turnItems), sessionError);
  return summary.lastErrorClass === "usage_limit" ? executed : null;
}

/** Retains a limited run's outcome when higher-ordinal runs never started. */
export function usageLimitRunPresentedAsLatest(
  runs: ReadonlyArray<OrchestrationV2Run>,
  turnItems: ReadonlyArray<FailureScanTurnItem>,
  sessionError: string | null,
): OrchestrationV2Run | null {
  const blocked = usageLimitBlockedRun(runs, turnItems, sessionError);
  return blocked !== null && runs.some((run) => run.ordinal > blocked.ordinal) ? blocked : null;
}

export function latestUnheldRun(
  runs: ReadonlyArray<OrchestrationV2Run>,
): OrchestrationV2Run | null {
  let latest: OrchestrationV2Run | null = null;
  for (const run of runs) {
    if (run.status === "queued" && run.queueHeld === true) continue;
    if (outlivedBeforeStart(run, runs)) continue;
    if (latest === null || run.ordinal > latest.ordinal) latest = run;
  }
  return latest;
}

// Steering a queued message cancels its run before it starts and hands the message to the
// earlier run, which outlives the cancellation; that earlier run then presents as latest.
function outlivedBeforeStart(
  run: OrchestrationV2Run,
  runs: ReadonlyArray<OrchestrationV2Run>,
): boolean {
  if (run.status !== "cancelled" || run.startedAt !== null || !run.completedAt) return false;
  const cancelledAt = DateTime.toEpochMillis(run.completedAt);
  return runs.some(
    (earlier) =>
      earlier.ordinal < run.ordinal &&
      earlier.status !== "queued" &&
      (!earlier.completedAt || DateTime.toEpochMillis(earlier.completedAt) >= cancelledAt),
  );
}
