import type {
  OrchestrationV2Subagent,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const DELEGATED_QUOTA_COOLDOWN_MS = 5 * 60_000;
const QUOTA_FAILURE =
  /(?:usage|plan|account)\s+limit\s+(?:was\s+|has\s+been\s+)?(?:reached|exceeded)|(?:quota|rate[ -]?limit)\s+(?:was\s+|has\s+been\s+)?(?:reached|exceeded|exhausted)/i;

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
    blocked.add(task.providerInstanceId);
    const source = providers.find((provider) => provider.instanceId === task.providerInstanceId);
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
