import { CommandId, MessageId, type OrchestrationV2Command } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { availableAccountForModel } from "@t3tools/shared/providerAccountControl";
import { isSmartModel, selectSmartModel } from "@t3tools/shared/smartModelRouting";
import { resolveProjectProviderInstanceEnabled } from "@t3tools/contracts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import type { OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as DueHint from "../scheduling/DueHint.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

export const MAX_OVERDUE_ARM_MS = 24 * 60 * 60 * 1000;

export function limitRecoveryCommand(
  thread: ProjectionStore.ProjectionLimitRecoveryCandidate,
  autoResume: boolean,
  nowMs: number,
  snooze = false,
): OrchestrationV2Command | null {
  if (
    thread.status !== "failed" ||
    thread.lastErrorClass !== "usage_limit" ||
    !thread.latestRunId ||
    !thread.usageLimitResetAt ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled" ||
    thread.pendingRuntimeRequest !== null
  )
    return null;
  const resetMs = Date.parse(thread.usageLimitResetAt);
  // An already-expired window reported with a fresh failure cannot start a retry loop.
  if (
    !Number.isFinite(resetMs) ||
    resetMs <= DateTime.toEpochMillis(thread.latestRunCompletedAt ?? thread.updatedAt)
  )
    return null;
  const identity = `${thread.id}:${thread.latestRunId}:${resetMs}`;
  const recovery = thread.limitRecovery;
  if (recovery?.runId !== thread.latestRunId || recovery.resetAt !== thread.usageLimitResetAt) {
    if (nowMs - resetMs > MAX_OVERDUE_ARM_MS) return null;
    if (!autoResume && (!snooze || resetMs <= nowMs)) return null;
    return {
      type: "thread.metadata.update",
      commandId: CommandId.make(`limit-arm:${identity}`),
      threadId: thread.id,
      limitRecovery: {
        runId: thread.latestRunId,
        resetAt: thread.usageLimitResetAt,
        autoResume,
        snooze: snooze && resetMs > nowMs,
      },
    };
  }
  if (
    !recovery.autoResume ||
    resetMs > nowMs ||
    (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs)
  )
    return null;
  const deliveryIdentity = `${identity}:${recovery.requestId ?? "legacy"}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(`limit-resume:${deliveryIdentity}`),
    messageId: MessageId.make(`limit-resume:${deliveryIdentity}`),
    threadId: thread.id,
    usageLimitContinuationOfRunId: thread.latestRunId,
    ...(recovery.requestId === undefined
      ? {}
      : { usageLimitRecoveryRequestId: recovery.requestId }),
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "agent",
    creationSource: "server",
  };
}

// Events that can make a thread a candidate or change its command; streaming items cannot.
const affectsLimitRecovery = (event: OrchestrationV2DomainEvent) =>
  event.type.startsWith("thread.") ||
  event.type === "run.created" ||
  event.type === "run.updated" ||
  event.type === "runtime-request.updated" ||
  event.type.startsWith("provider-session.") ||
  (event.type === "turn-item.updated" && event.payload.type === "error");

const makeSweep = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const settings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* Effect.serviceOption(ProviderRegistry.ProviderRegistry);
  // Never cycle through a login again after it failed; a real user message starts a new chain.
  const attempted = new Map<string, Set<string>>();
  const due = DueHint.make();
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
      Effect.gen(function* () {
        if (
          event.type === "turn-item.updated" &&
          event.payload.type === "user_message" &&
          event.payload.createdBy === "user"
        )
          attempted.delete(event.threadId);
        if (affectsLimitRecovery(event)) yield* due.invalidate;
      }),
    ),
  );
  yield* forkParked(Stream.runForEach(settings.streamChanges, () => due.invalidate));
  if (Option.isSome(providerRegistry)) {
    yield* forkParked(
      Stream.runForEach(providerRegistry.value.streamChanges, () => due.invalidate),
    );
  }
  return Effect.fn("UsageLimitRecoveryWorker.sweep")(function* () {
    const now = yield* DateTime.now;
    const nowMs = DateTime.toEpochMillis(now);
    if (yield* due.isIdle(nowMs)) return;
    const readVersion = yield* due.version;
    const preferences = yield* settings.getSettings;
    const candidates = yield* projections.getLimitRecoveryCandidates({
      now,
      autoResume: preferences.autoResumeLimitedThreads || preferences.autoSwitchLimitedAccounts,
      autoSwitchAccounts: preferences.autoSwitchLimitedAccounts,
      snooze: preferences.snoozeLimitedThreads,
    });
    let acted = false;
    for (const thread of candidates) {
      if (preferences.autoSwitchLimitedAccounts && Option.isSome(providerRegistry)) {
        const shell = yield* projections.getThreadShell(thread.id);
        if (
          shell?.status === "failed" &&
          (shell.lastErrorClass === "usage_limit" ||
            (isSmartModel(shell.modelSelection.model) &&
              (shell.lastErrorClass === "transport_error" ||
                shell.lastErrorClass === "provider_error"))) &&
          shell.latestRunId &&
          shell.archivedAt === null &&
          shell.settledOverride !== "settled" &&
          (shell.snoozedUntil == null || DateTime.toEpochMillis(shell.snoozedUntil) <= nowMs) &&
          shell.pendingRuntimeRequest === null
        ) {
          const providers = yield* providerRegistry.value.getProviders;
          const current = providers.find(
            (provider) => provider.instanceId === shell.modelSelection.instanceId,
          );
          const excluded = attempted.get(thread.id) ?? new Set<string>();
          excluded.add(shell.modelSelection.instanceId);
          if (attempted.size > 1000) attempted.delete(attempted.keys().next().value!);
          attempted.set(thread.id, excluded);
          const target =
            isSmartModel(shell.modelSelection.model) && excluded.size >= 4
              ? undefined
              : isSmartModel(shell.modelSelection.model)
                ? selectSmartModel({
                    requested: shell.modelSelection,
                    providers: providers.filter((provider) => !excluded.has(provider.instanceId)),
                    settings: preferences,
                    projectId: shell.projectId,
                    text: shell.title,
                    now: nowMs,
                  })?.selection
                : current &&
                  availableAccountForModel(
                    current,
                    providers,
                    preferences.providerInstances,
                    shell.modelSelection.model,
                    nowMs,
                    excluded,
                  );
          if (
            target &&
            resolveProjectProviderInstanceEnabled(preferences, shell.projectId, target.instanceId)
          ) {
            excluded.add(target.instanceId);
            const identity = `limit-switch:${thread.id}:${shell.latestRunId}:${target.instanceId}`;
            yield* threads
              .dispatch({
                type: "message.dispatch",
                commandId: CommandId.make(identity),
                messageId: MessageId.make(identity),
                threadId: thread.id,
                manualContinuationOfRunId: shell.latestRunId,
                modelSelection: { ...shell.modelSelection, instanceId: target.instanceId },
                text: "Continue where you left off using the selected saved account. Check the latest tool results before repeating any action.",
                attachments: [],
                dispatchMode: { type: "start_immediately" },
                createdBy: "agent",
                creationSource: "server",
              })
              .pipe(
                Effect.catchCause((cause) =>
                  Effect.logWarning("usage-limit.account-switch.failed", {
                    threadId: thread.id,
                    cause,
                  }),
                ),
              );
            acted = true;
            continue;
          }
        }
      }
      const command = limitRecoveryCommand(
        thread,
        preferences.autoResumeLimitedThreads,
        nowMs,
        preferences.snoozeLimitedThreads,
      );
      if (command === null) continue;
      acted = true;
      yield* Effect.gen(function* () {
        if (command.type === "thread.metadata.update" && command.limitRecovery != null) {
          yield* orchestrator.autoArmLimitRecovery({
            commandId: command.commandId,
            threadId: command.threadId,
            limitRecovery: command.limitRecovery,
          });
        } else {
          yield* threads.dispatch(command);
        }
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.limit-recovery.dispatch-failed", {
            threadId: thread.id,
            cause,
          }),
        ),
      );
    }
    // A sweep that acted, or failed to, re-checks on the next tick.
    if (acted) return;
    const wakeAt = yield* projections.getLimitRecoveryWakeAt(now);
    yield* due.record(readVersion, wakeAt ?? Infinity, nowMs);
  });
});

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const sweep = yield* makeSweep;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("usage-limit-recovery", sweep());
  }),
);
