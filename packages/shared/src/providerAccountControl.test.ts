import { describe, expect, it } from "vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@t3tools/contracts";
import { freeAccountUpdates, availableAccountForModel } from "./providerAccountControl.ts";

it("switches only to a different verified saved account with fresh allowance and never cycles", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const provider = (id: string, used: number): ServerProvider => ({
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    status: "ready",
    version: null,
    checkedAt: new Date(now).toISOString(),
    auth: { status: "authenticated", email: `${id}@example.com` },
    models: [{ slug: "gpt-test", name: "Test", isCustom: false, capabilities: null }],
    skills: [],
    slashCommands: [],
    usageLimits: {
      checkedAt: new Date(now).toISOString(),
      windows: [
        {
          id: "session",
          label: "5 hours",
          kind: "session",
          usedPercent: used,
          resetsAt: new Date(now + 3600000).toISOString(),
        },
      ],
    },
  });
  const current = provider("a", 100),
    available = provider("b", 10),
    exhausted = provider("c", 100);
  const instances = Object.fromEntries(
    ["a", "b", "c"].map((id) => [
      id,
      { driver: current.driver, accountTier: "subscription" as const },
    ]),
  );
  const managed = {
    ...available,
    auth: { ...available.auth, subscriptionSharing: true },
    usageLimits: {
      ...available.usageLimits!,
      windows: [],
      unavailable: { reason: "unsupported" as const, message: "Plan usage is shown by ChatGPT" },
    },
  };
  expect(
    availableAccountForModel(
      current,
      [managed],
      { ...instances, b: { driver: current.driver } },
      "gpt-test",
      now,
    )?.instanceId,
  ).toBe("b");
  expect(
    availableAccountForModel(current, [managed], instances, "gpt-test", now, new Set(["b"])),
  ).toBeUndefined();
  expect(
    availableAccountForModel(current, [current, exhausted, available], instances, "gpt-test", now)
      ?.instanceId,
  ).toBe("b");
  expect(
    availableAccountForModel(current, [available], instances, "gpt-test", now, new Set(["b"])),
  ).toBeUndefined();
  expect(
    availableAccountForModel(
      current,
      [{ ...available, auth: current.auth }],
      instances,
      "gpt-test",
      now,
    ),
  ).toBeUndefined();
  expect(
    availableAccountForModel(
      current,
      [available],
      { ...instances, b: { driver: current.driver, accountTier: "paid-api" } },
      "gpt-test",
      now,
    ),
  ).toBeUndefined();
  expect(
    availableAccountForModel(
      current,
      [available],
      { ...instances, b: { ...instances.b!, freeAccountPaused: true } },
      "gpt-test",
      now,
    ),
  ).toBeUndefined();
  expect(
    availableAccountForModel(current, [available], instances, "gpt-test", now + 6 * 60000),
  ).toBeUndefined();
  expect(
    availableAccountForModel(current, [exhausted], instances, "gpt-test", now + 3600001)
      ?.instanceId,
  ).toBeUndefined();
});

describe("free account pause", () => {
  it("retains credentials and only restores free accounts paused by this action", () => {
    const driver = ProviderDriverKind.make("codex");
    const instances: Record<string, ProviderInstanceConfig> = {
      free: { driver, accountTier: "free", config: { shadowHomePath: "/profiles/free" } },
      disabled: { driver, accountTier: "free", enabled: false },
      paid: { driver, accountTier: "subscription" },
      unknown: { driver },
      other: { driver: ProviderDriverKind.make("antigravity"), accountTier: "free" },
    };
    const paused = freeAccountUpdates(instances, driver, true);
    expect(paused.map((update) => update.instanceId)).toEqual(["free"]);
    expect(paused[0]?.next.config).toBe(instances.free?.config);
    expect(paused[0]?.next.enabled).toBe(false);
    expect(instances.free?.enabled).toBeUndefined();
    const next = { ...instances, free: paused[0]!.next };
    const resumed = freeAccountUpdates(next, driver, false);
    expect(resumed.map((update) => update.instanceId)).toEqual(["free"]);
    expect(resumed[0]?.next).toEqual(instances.free && { ...instances.free, enabled: true });
    expect(next.disabled?.enabled).toBe(false);
  });
});
