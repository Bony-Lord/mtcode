import type {
  OrchestrationV2Subagent,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import {
  DELEGATED_QUOTA_COOLDOWN_MS,
  gatewayPool,
  QUOTA_FAILURE,
  type DelegatedQuotaEstimate,
} from "@t3tools/shared/delegatedQuota";
import { providerUsageDisplaySource, usageWindowApplies } from "@t3tools/shared/usageLimits";
import * as DateTime from "effect/DateTime";

/** Recent explicit quota failures prevent repeated auto-selection, including known account aliases. */
export function delegatedQuotaCooldown(
  tasks: readonly OrchestrationV2Subagent[],
  providers: readonly ServerProvider[],
  now: number,
): ReadonlySet<ProviderInstanceId> {
  const blocked = new Set<ProviderInstanceId>();
  for (const task of tasks) {
    if (task.status !== "failed" || !task.result || !QUOTA_FAILURE.test(task.result)) continue;
    const at = DateTime.toEpochMillis(task.completedAt ?? task.updatedAt);
    if (at > now || now - at >= DELEGATED_QUOTA_COOLDOWN_MS) continue;
    const source = providers.find((provider) => provider.instanceId === task.providerInstanceId);
    if (
      source?.driver === "opencode" &&
      gatewayPool(source.driver, task.modelSelection?.model ?? task.model ?? "")
    )
      continue;
    blocked.add(task.providerInstanceId);
    const email = source?.auth.email?.toLowerCase();
    const fingerprint = source?.usageLimits?.credentialFingerprint;
    for (const provider of providers) {
      if (provider.driver !== source?.driver) continue;
      if (
        (email && provider.auth.email?.toLowerCase() === email) ||
        (fingerprint && provider.usageLimits?.credentialFingerprint === fingerprint)
      )
        blocked.add(provider.instanceId);
    }
  }
  return blocked;
}

export function delegatedQuotaAllows(input: {
  readonly estimate: DelegatedQuotaEstimate;
  readonly sharedEstimate: DelegatedQuotaEstimate;
  readonly provider: ServerProvider;
  readonly providers: readonly ServerProvider[];
  readonly model: string;
  readonly now: number;
}): boolean {
  const { estimate, sharedEstimate, provider, providers, model, now } = input;
  const windows = providerUsageDisplaySource(provider, providers)?.usageLimits?.windows.filter(
    (window) => window.observedUntil === undefined && usageWindowApplies(window, model),
  );
  if (windows?.length && windows.every((window) => window.usedPercent < 90)) return true;
  if ((estimate.retryAt ?? 0) > now || (sharedEstimate.retryAt ?? 0) > now) return false;
  return (
    sharedEstimate.inFlight === 0 ||
    ((estimate.remaining ?? (estimate.inFlight === 0 ? 1 : 0)) > 0 &&
      (sharedEstimate.remaining ?? 0) > 0)
  );
}
