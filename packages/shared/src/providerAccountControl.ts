import {
  ProviderInstanceId,
  resolveProviderInstanceEnabled,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ServerProvider,
  isProviderAvailable,
} from "@t3tools/contracts";
import { exhaustedUsageWindow, remainingPercent } from "./usageLimits.ts";

/** A different saved login, same driver and model, with a fresh known allowance. */
export function availableAccountForModel(
  current: ServerProvider,
  providers: readonly ServerProvider[],
  instances: Readonly<Record<string, ProviderInstanceConfig>>,
  model: string,
  now: number,
  excluded: ReadonlySet<string> = new Set(),
): ServerProvider | undefined {
  return providers
    .filter((provider) => {
      const config = instances[provider.instanceId];
      const limits = provider.usageLimits;
      return (
        provider.instanceId !== current.instanceId &&
        provider.driver === current.driver &&
        !excluded.has(provider.instanceId) &&
        provider.enabled &&
        provider.installed &&
        provider.status === "ready" &&
        provider.auth.status === "authenticated" &&
        isProviderAvailable(provider) &&
        (config?.accountTier === "free" || config?.accountTier === "subscription") &&
        !config.freeAccountPaused &&
        resolveProviderInstanceEnabled(config) &&
        provider.models.some((entry) => entry.slug === model) &&
        limits !== undefined &&
        !limits.unavailable &&
        limits.windows.length > 0 &&
        now - Date.parse(limits.checkedAt) >= 0 &&
        now - Date.parse(limits.checkedAt) < 5 * 60_000 &&
        !exhaustedUsageWindow(provider, now, model) &&
        (!current.auth.email ||
          provider.auth.email?.toLowerCase() !== current.auth.email.toLowerCase()) &&
        (!current.usageLimits?.credentialFingerprint ||
          limits.credentialFingerprint !== current.usageLimits.credentialFingerprint)
      );
    })
    .sort(
      (a, b) =>
        Math.min(...b.usageLimits!.windows.map(remainingPercent)) -
        Math.min(...a.usageLimits!.windows.map(remainingPercent)),
    )[0];
}

export function freeAccountUpdates(
  instances: Readonly<Record<string, ProviderInstanceConfig>>,
  driver: ProviderDriverKind,
  paused: boolean,
): ReadonlyArray<{
  instanceId: ProviderInstanceId;
  previous: ProviderInstanceConfig;
  next: ProviderInstanceConfig;
}> {
  return Object.entries(instances).flatMap<{
    instanceId: ProviderInstanceId;
    previous: ProviderInstanceConfig;
    next: ProviderInstanceConfig;
  }>(([id, instance]) => {
    if (instance.driver !== driver || instance.accountTier !== "free") return [];
    if (paused) {
      if (!resolveProviderInstanceEnabled(instance) || instance.freeAccountPaused) return [];
      return [
        {
          instanceId: ProviderInstanceId.make(id),
          previous: instance,
          next: { ...instance, enabled: false, freeAccountPaused: true },
        },
      ];
    }
    if (!instance.freeAccountPaused) return [];
    const { freeAccountPaused: _paused, ...rest } = instance;
    return [
      {
        instanceId: ProviderInstanceId.make(id),
        previous: instance,
        next: { ...rest, enabled: true },
      },
    ];
  });
}
