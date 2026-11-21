import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { routingTask, routingTaskText, selectSmartModel } from "./smartModelRouting.ts";

const provider = (id: string, driver: string, models: string[]): ServerProvider => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  status: "ready",
  version: null,
  auth: { status: "authenticated", type: driver === "codex" ? "chatgpt" : "api" },
  checkedAt: "2026-11-17T00:00:00Z",
  models: models.map((slug) => ({ slug, name: slug, isCustom: false, capabilities: null })),
  slashCommands: [],
  skills: [],
});
const providers = [
  provider("free", "opencode", ["ovh-free/gpt-oss-20b", "ovh-free/gpt-oss-120b"]),
  provider("codex", "codex", ["gpt-6-astra", "gpt-6.1-sol"]),
  provider("paid", "opencode", ["paid/gpt-6-astra"]),
];
const input = {
  requested: { instanceId: ProviderInstanceId.make("codex"), model: "mt-auto" },
  providers,
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    providerInstances: {
      free: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        accountTier: "free" as const,
      },
      codex: {
        driver: ProviderDriverKind.make("codex"),
        enabled: true,
        accountTier: "subscription" as const,
      },
      paid: {
        driver: ProviderDriverKind.make("opencode"),
        enabled: true,
        accountTier: "paid-api" as const,
      },
    },
  },
  projectId: ProjectId.make("project"),
  text: "Переведи слово hello",
  now: Date.parse("2026-11-17T00:00:00Z"),
};

it("avoids exhausted account and model families while keeping usable models on the same gateway", () => {
  const [free, codex] = providers;
  const gateway = {
    ...free!,
    models: provider("free", "opencode", ["ovh-free/claude-haiku", "ovh-free/gemini-flash"]).models,
    usageLimits: {
      checkedAt: free!.checkedAt,
      windows: [
        {
          id: "claude-monthly",
          label: "Claude",
          kind: "monthly" as const,
          modelFamilies: ["Claude"],
          usedPercent: 100,
        },
      ],
    },
  };
  expect(selectSmartModel({ ...input, providers: [gateway, codex!] })?.selection).toMatchObject({
    instanceId: gateway.instanceId,
    model: "ovh-free/gemini-flash",
  });
});

it("keeps arithmetic cheap and recognizes the user's perceptron app as substantial coding", () => {
  expect(routingTaskText("продолжай", ["создай приложение перцептрона", "итоговый"])).toContain(
    "создай приложение",
  );
  expect(routingTaskText("1 + 1", ["создай приложение перцептрона"])).toBe("1 + 1");
  expect(routingTask("напиши простой перцептрон на C++", false)).toBe("code");
  expect(
    routingTask("сделай приложение с визуализацией работы перцептрона и обучения", false),
  ).toBe("code");
  expect(
    selectSmartModel({
      ...input,
      text: "1 + 1",
      previous: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
    })?.selection.instanceId,
  ).toBe("free");
  const app = selectSmartModel({
    ...input,
    text: "сделай приложение с визуализацией работы перцептрона и обучения",
    previous: { instanceId: ProviderInstanceId.make("free"), model: "ovh-free/gpt-oss-20b" },
  });
  expect(app?.selection.model).toBe("gpt-6.1-sol");
  expect(
    selectSmartModel({
      ...input,
      text: "1 + 1",
      settings: { ...input.settings, agentWorkModes: ["thinking", "research"] },
    })?.selection.instanceId,
  ).toBe("free");
  expect(
    selectSmartModel({
      ...input,
      excludedModels: ["ovh-free/gpt-oss-20b", "ovh-free/gpt-oss-120b"],
    })?.selection.instanceId,
  ).toBe("codex");
  const forbidden = selectSmartModel({
    ...input,
    advice: {
      task: "quick",
      complexity: "simple",
      preferredSelection: {
        instanceId: ProviderInstanceId.make("paid"),
        model: "paid/gpt-6-astra",
      },
      reason: "Bad advice",
    },
  });
  expect(forbidden?.selection.instanceId).toBe("free");
});

it("selects across all providers by task and preserves a healthy cached route when suitable", () => {
  expect(selectSmartModel(input)?.selection.model).toBe("ovh-free/gpt-oss-20b");
  const complex = selectSmartModel({
    ...input,
    text: "Исправь архитектуру и докажи причину ошибки",
    requested: { ...input.requested, model: "mt-auto/quality" },
  });
  expect(complex?.selection.instanceId).toBe("codex");
  expect(complex?.selection.model).toBe("gpt-6-astra");
  expect(
    selectSmartModel({
      ...input,
      previous: { instanceId: ProviderInstanceId.make("free"), model: "ovh-free/gpt-oss-20b" },
    })?.selection.model,
  ).toBe("ovh-free/gpt-oss-20b");
  expect(selectSmartModel({ ...input, images: true })?.selection.instanceId).toBe("codex");
  expect(
    selectSmartModel({
      ...input,
      providers: [{ ...providers[0]!, auth: { status: "unknown" } }, providers[1]!],
    })?.selection.instanceId,
  ).toBe("free");
  expect(
    selectSmartModel({
      ...input,
      providers: [{ ...providers[0]!, auth: { status: "unauthenticated" } }, providers[1]!],
    })?.selection.instanceId,
  ).toBe("codex");
});

it("uses only explicitly marked subscriptions in subscription-only mode", () => {
  const autoSubscription = {
    ...input,
    requested: { ...input.requested, model: "mt-auto/subscription" },
  };
  expect(selectSmartModel(autoSubscription)?.selection.instanceId).toBe("codex");
  expect(selectSmartModel({ ...autoSubscription, escalate: true })?.selection.instanceId).toBe(
    "codex",
  );
  expect(
    selectSmartModel({
      ...autoSubscription,
      settings: { ...input.settings, providerInstances: {} },
    }),
  ).toBeNull();
});

it("skips paid, disabled, exhausted and failed routes and honors actual quota resets", () => {
  const limited = {
    ...providers[0]!,
    usageLimits: {
      checkedAt: "2026-11-17T00:00:00Z",
      windows: [
        {
          id: "session",
          label: "Session",
          kind: "session" as const,
          usedPercent: 100,
          resetsAt: "2026-11-17T01:00:00Z",
        },
      ],
    },
  };
  expect(
    selectSmartModel({ ...input, providers: [limited, providers[1]!, providers[2]!] })?.selection
      .instanceId,
  ).toBe("codex");
  expect(
    selectSmartModel({ ...input, providers: [limited], now: Date.parse("2026-11-17T02:00:00Z") })
      ?.selection.instanceId,
  ).toBe("free");
  expect(selectSmartModel({ ...input, providers: [providers[2]!] })).toBeNull();
  expect(
    selectSmartModel({ ...input, providers: [{ ...providers[0]!, enabled: false }] }),
  ).toBeNull();
  expect(
    selectSmartModel({
      ...input,
      observations: providers[0]!.models.map((model) => ({
        instanceId: "free",
        model: model.slug,
        blocked: true,
      })),
    })?.selection.instanceId,
  ).toBe("codex");
});

it("escalates to another capable model and applies work profiles without paid API fallback", () => {
  const previous = { instanceId: ProviderInstanceId.make("free"), model: "ovh-free/gpt-oss-20b" };
  const escalated = selectSmartModel({ ...input, previous, escalate: true });
  expect(escalated?.selection.model).toBe("gpt-6-astra");
  expect(
    selectSmartModel({
      ...input,
      previous,
      escalate: true,
      excludedModels: ["gpt-6-astra", "gpt-6.1-sol"],
    })?.selection.model,
  ).toBe("ovh-free/gpt-oss-120b");
  expect(
    selectSmartModel({ ...input, settings: { ...input.settings, agentWorkProfile: "thinking" } })
      ?.selection.model,
  ).toBe("gpt-6-astra");
  expect(
    selectSmartModel({ ...input, settings: { ...input.settings, agentWorkProfile: "economy" } })
      ?.selection.instanceId,
  ).toBe("free");
});

it("combines Fast and economy with stronger reasoning for a deliberate task", () => {
  const first = selectSmartModel({
    ...input,
    settings: { ...input.settings, agentWorkModes: ["fast", "economy"] },
  });
  expect(first?.selection.model).toBe("ovh-free/gpt-oss-20b");
  const deliberate = selectSmartModel({
    ...input,
    settings: { ...input.settings, agentWorkModes: ["fast", "economy", "thinking", "web"] },
  });
  expect(deliberate?.selection.model).toBe("gpt-6-astra");
});
