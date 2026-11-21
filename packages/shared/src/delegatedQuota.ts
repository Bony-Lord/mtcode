import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const DELEGATED_QUOTA_HISTORY_MS = 7 * 24 * 60 * 60_000;
export const DELEGATED_QUOTA_COOLDOWN_MS = 5 * 60_000;
export const QUOTA_FAILURE =
  /(?:usage|plan|account)\s+limit\s+(?:was\s+|has\s+been\s+)?(?:reached|exceeded)|(?:quota|rate[ -]?limit)\s+(?:was\s+|has\s+been\s+)?(?:reached|exceeded|exhausted)/i;

export type DelegatedQuotaEstimate = {
  readonly inFlight: number;
  readonly remaining: number | null;
  readonly requestsPerCycle: number | null;
  readonly recoveryMs: number | null;
  readonly retryAt: number | null;
};

export function gatewayPool(driver: string, model: string) {
  if (driver !== "opencode") return null;
  const prefix = model.split("/")[0];
  return prefix && model.includes("/") ? prefix : null;
}

export function estimateDelegatedQuota(
  tasks: ReadonlyArray<
    Pick<
      OrchestrationV2Subagent,
      | "origin"
      | "providerInstanceId"
      | "modelSelection"
      | "model"
      | "status"
      | "result"
      | "updatedAt"
      | "completedAt"
    >
  >,
  provider: Pick<ServerProvider, "driver" | "instanceId">,
  model: string,
  now: number,
  sharedGateway: boolean,
): DelegatedQuotaEstimate {
  const pool = sharedGateway ? gatewayPool(provider.driver, model) : null;
  const matches = tasks.filter((task) => {
    if (task.origin !== "app_owned" || task.providerInstanceId !== provider.instanceId)
      return false;
    const slug = task.modelSelection?.model ?? task.model;
    if (!sharedGateway || slug === null) return slug === model;
    return pool === null || gatewayPool(provider.driver, slug) === pool;
  });
  const inFlight = matches.filter((task) => isOrchestrationV2WorkActive(task.status)).length;
  const samples = matches
    .filter(
      (task) =>
        task.status === "completed" ||
        (task.status === "failed" && QUOTA_FAILURE.test(task.result ?? "")),
    )
    .map((task) => ({
      at: DateTime.toEpochMillis(task.completedAt ?? task.updatedAt),
      success: task.status === "completed",
    }))
    .filter((sample) => sample.at <= now && now - sample.at <= DELEGATED_QUOTA_HISTORY_MS)
    .sort((a, b) => a.at - b.at);
  let failedAt: number | null = null;
  let successfulSinceFailure = 0;
  const observedCycles: number[] = [];
  const observedRecovery: number[] = [];
  for (const sample of samples) {
    if (sample.success) {
      if (failedAt === null) continue;
      if (successfulSinceFailure === 0 && sample.at > failedAt) {
        observedRecovery.push(sample.at - failedAt);
      }
      successfulSinceFailure++;
    } else {
      if (failedAt !== null && successfulSinceFailure > 0) {
        observedCycles.push(successfulSinceFailure);
      }
      failedAt = sample.at;
      successfulSinceFailure = 0;
    }
  }
  const latestCycles = observedCycles.slice(-3);
  const requestsPerCycle = latestCycles.length > 0 ? Math.min(...latestCycles) : null;
  const latestRecovery = observedRecovery.slice(-3);
  const recoveryMs = latestRecovery.length > 0 ? Math.min(...latestRecovery) : null;
  const retryAt =
    failedAt !== null && successfulSinceFailure === 0
      ? failedAt + Math.max(DELEGATED_QUOTA_COOLDOWN_MS, Math.min(recoveryMs ?? 0, 60 * 60_000))
      : null;
  return {
    inFlight,
    remaining:
      requestsPerCycle === null
        ? null
        : retryAt !== null && retryAt > now
          ? 0
          : Math.max(0, requestsPerCycle - successfulSinceFailure - inFlight),
    requestsPerCycle,
    recoveryMs,
    retryAt,
  };
}
