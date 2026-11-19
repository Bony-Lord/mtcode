import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as Effect from "effect/Effect";
import * as Orchestrator from "./Orchestrator.ts";
import * as Registry from "./ProviderAdapterRegistry.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Harness from "./testkit/ProviderReplayHarness.ts";

it.effect(
  "resolves Auto before the first native turn across providers and keeps Auto selected",
  () =>
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace("smart-model-routing");
      const snapshots: ServerProvider[] = [
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
          models: [{ slug: "gpt-6-luna", name: "Luna", isCustom: false, capabilities: null }],
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated", type: "chatgpt" },
          version: null,
          checkedAt: "2026-11-17T00:00:00Z",
          skills: [],
          slashCommands: [],
        },
        {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          driver: ProviderDriverKind.make("claudeAgent"),
          models: [{ slug: "claude-opus-5-5", name: "Opus", isCustom: false, capabilities: null }],
          enabled: true,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          version: null,
          checkedAt: "2026-11-17T00:00:00Z",
          skills: [],
          slashCommands: [],
        },
      ];
      const adapters = snapshots.map(
        (provider) =>
          ({
            instanceId: provider.instanceId,
            driver: provider.driver,
            getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
            planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
          }) as unknown as ProviderAdapter.ProviderAdapterV2["Service"],
      );
      yield* Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        for (const [name, text, expected] of [
          ["quick", "Translate hello", "gpt-6-luna"],
          ["hard", "Prove the architecture root cause", "claude-opus-5-5"],
        ] as const) {
          const threadId = ThreadId.make(`smart:${name}`);
          const selection = { instanceId: snapshots[0]!.instanceId, model: "mt-auto" };
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`create:${name}`),
            threadId,
            projectId: ProjectId.make("routing-project"),
            title: name,
            modelSelection: selection,
            runtimeMode: "full-access",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdBy: "user",
            creationSource: "web",
          });
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(`send:${name}`),
            messageId: MessageId.make(`message:${name}`),
            threadId,
            text,
            attachments: [],
            modelSelection: selection,
            dispatchMode: { type: "start_immediately" },
            createdBy: "user",
            creationSource: "web",
          });
          const state = yield* orchestrator.getThreadProjection(threadId);
          assert.equal(state.runs.at(-1)?.modelSelection.model, expected);
          assert.equal(state.thread.modelSelection.model, "mt-auto");
          assert.isTrue(
            state.turnItems.some(
              (item) => item.type === "system_notice" && item.message.includes(expected),
            ),
          );
          const original = [...snapshots];
          snapshots.splice(
            0,
            snapshots.length,
            ...snapshots.map((snapshot) => ({ ...snapshot, status: "error" as const })),
          );
          try {
            yield* orchestrator.dispatch({
              type: "message.dispatch",
              commandId: CommandId.make(`steer:${name}`),
              messageId: MessageId.make(`steer-message:${name}`),
              threadId,
              text: "Include one more example",
              attachments: [],
              modelSelection: selection,
              dispatchMode: { type: "steer_active", targetRunId: state.runs.at(-1)!.id },
              createdBy: "user",
              creationSource: "web",
            });
            const steered = yield* orchestrator.getThreadProjection(threadId);
            assert.equal(
              steered.runs.find((run) => run.id === state.runs.at(-1)!.id)?.modelSelection.model,
              expected,
            );
            assert.equal(steered.runs.at(-1)?.steerWhenReadyRunId, state.runs.at(-1)!.id);
          } finally {
            snapshots.splice(0, snapshots.length, ...original);
          }
        }
      }).pipe(
        Effect.provide(
          Harness.layerWithRegistry(
            {
              name: "smart-routing",
              runtimePolicyOverride: {
                cwd,
                approvalPolicy: "never",
                sandboxPolicy: {
                  type: "readOnly",
                  access: { type: "fullAccess" },
                  networkAccess: false,
                },
              },
            },
            Registry.layerFromAdapters(adapters),
            {
              runEffectWorker: false,
              routingProviders: snapshots,
              providerInstances: {
                [snapshots[0]!.instanceId]: {
                  driver: snapshots[0]!.driver,
                  enabled: true,
                  accountTier: "subscription",
                },
                [snapshots[1]!.instanceId]: {
                  driver: snapshots[1]!.driver,
                  enabled: true,
                  accountTier: "subscription",
                },
              },
            },
          ),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
