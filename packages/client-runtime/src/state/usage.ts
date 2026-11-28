import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  UsageModelFilter,
  UsageSummaryInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";

import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import type { createEnvironmentPresentationAtoms } from "./presentation.ts";
import { executeAtomQuery, runAtomCommand, squashAtomCommandFailure } from "./runtime.ts";
import type { createServerEnvironmentAtoms } from "./server.ts";

const isEnvironmentRpcUnavailable = Schema.is(EnvironmentRpcUnavailableError);

/** The Usage tab asks each environment with that environment's configured model filter. */
export function usageSummaryInput(
  input: UsageSummaryInput,
  modelFilter: UsageModelFilter | undefined,
): UsageSummaryInput {
  return modelFilter === undefined ? input : { ...input, modelFilter };
}

export const CODEX_LIMITS_REFRESH_INTERVAL_MS = 60_000;

export function canRefreshCodexLimits(provider: ServerProvider | undefined): boolean {
  return (
    provider?.driver === "codex" &&
    provider.enabled &&
    provider.installed &&
    provider.auth.status === "authenticated" &&
    provider.auth.type === "chatgpt" &&
    provider.auth.subscriptionSharing !== true
  );
}

const ALL_LIMITS_REFRESH_INTERVAL_MS = 5 * 60_000;
const limitsRefreshAfter = new Map<string, number>();
const limitsRefreshes = new Map<string, Promise<unknown>>();

export async function refreshUsageLimits<A>(
  environmentId: EnvironmentId,
  refresh: () => Promise<A>,
  automatic = false,
  instanceId?: ProviderInstanceId,
): Promise<A | undefined> {
  const environmentKey = JSON.stringify([environmentId]);
  const key =
    instanceId === undefined ? environmentKey : JSON.stringify([environmentId, instanceId]);
  const pending = limitsRefreshes.get(key);
  if (pending !== undefined) {
    return automatic ? undefined : ((await pending) as A);
  }
  if (automatic && instanceId !== undefined && limitsRefreshes.has(environmentKey)) return;
  // @effect-diagnostics-next-line globalDate:off
  const now = Date.now();
  if (automatic && now < (limitsRefreshAfter.get(key) ?? 0)) return;
  limitsRefreshAfter.set(
    key,
    now +
      (instanceId === undefined
        ? ALL_LIMITS_REFRESH_INTERVAL_MS
        : CODEX_LIMITS_REFRESH_INTERVAL_MS),
  );
  const current = Promise.resolve()
    .then(refresh)
    .finally(() => {
      limitsRefreshes.delete(key);
    });
  limitsRefreshes.set(key, current);
  return await current;
}

export async function refreshUsage({
  registry,
  server,
  presentations,
  environmentIds,
  input,
}: {
  registry: AtomRegistry.AtomRegistry;
  server: Pick<
    ReturnType<typeof createServerEnvironmentAtoms>,
    "usageSummary" | "refreshUsageRates" | "usageModelFilterAtom"
  >;
  presentations: Pick<ReturnType<typeof createEnvironmentPresentationAtoms>, "presentationAtom">;
  environmentIds: readonly EnvironmentId[];
  input: UsageSummaryInput;
}): Promise<void> {
  await Promise.all(
    environmentIds.map(async (environmentId) => {
      const query = server.usageSummary({
        environmentId,
        input: usageSummaryInput(input, registry.get(server.usageModelFilterAtom(environmentId))),
      });
      const presentation = presentations.presentationAtom(environmentId);
      const controller = new AbortController();
      const abortWhenDisconnected = () => {
        if (registry.get(presentation)?.connection.phase !== "connected") controller.abort();
      };
      const unsubscribe = registry.subscribe(presentation, abortWhenDisconnected);
      abortWhenDisconnected();
      try {
        const ratesResult = await runAtomCommand(
          registry,
          server.refreshUsageRates,
          { environmentId, input: {} },
          { reportFailure: false },
        );
        const sessionUnavailable =
          ratesResult._tag === "Failure" &&
          isEnvironmentRpcUnavailable(squashAtomCommandFailure(ratesResult));
        registry.refresh(query);
        if (sessionUnavailable || controller.signal.aborted) return;
        await executeAtomQuery(registry, query, {
          reportFailure: false,
          signal: controller.signal,
        });
      } finally {
        unsubscribe();
      }
    }),
  );
}
