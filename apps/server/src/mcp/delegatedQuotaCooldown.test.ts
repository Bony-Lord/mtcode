import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import {
  delegatedQuotaCooldown,
  recentlyUsedDelegatedSelections,
} from "./delegatedQuotaCooldown.ts";

const now = Date.parse("2026-11-19T10:00:00Z");
const provider = (id: string, email: string) =>
  ({
    instanceId: ProviderInstanceId.make(id),
    driver: "codex",
    auth: { email },
  }) as ServerProvider;
const providers = [
  provider("a", "same@example.test"),
  provider("alias", "SAME@example.test"),
  provider("b", "other@example.test"),
];
const task = (result: string, ageMs: number) =>
  ({
    providerInstanceId: ProviderInstanceId.make("a"),
    status: "failed",
    result,
    completedAt: DateTime.makeUnsafe(now - ageMs),
    updatedAt: DateTime.makeUnsafe(now - ageMs),
  }) as OrchestrationV2Subagent;

describe("delegatedQuotaCooldown", () => {
  it("blocks the exhausted account and its alias, but keeps other accounts available", () => {
    expect([
      ...delegatedQuotaCooldown(
        [task("Your ChatGPT usage limit was reached.", 1000)],
        providers,
        now,
      ),
    ]).toEqual(["a", "alias"]);
  });
  it("expires after five minutes and does not treat unrelated failures as quota", () => {
    expect(
      delegatedQuotaCooldown([task("usage limit reached", 300_000)], providers, now).size,
    ).toBe(0);
    expect(delegatedQuotaCooldown([task("network timeout", 1000)], providers, now).size).toBe(0);
  });
  it("collects distinct recent helper selections, newest first", () => {
    const helper = (
      id: string,
      model: string,
      ageMs: number,
      overrides: Partial<OrchestrationV2Subagent> = {},
    ) =>
      ({
        origin: "app_owned",
        providerInstanceId: ProviderInstanceId.make(id),
        model,
        completedAt: DateTime.makeUnsafe(now - ageMs),
        updatedAt: DateTime.makeUnsafe(now - ageMs),
        ...overrides,
      }) as OrchestrationV2Subagent;

    expect(
      recentlyUsedDelegatedSelections(
        [
          helper("a", "old", 60_000),
          helper("b", "new", 1_000),
          helper("a", "old", 2_000),
          helper("c", "too-old", 8 * 24 * 60 * 60_000),
          helper("d", "provider-owned", 500, { origin: "provider_native" }),
          helper("e", "ignored", 600, {
            modelSelection: { instanceId: ProviderInstanceId.make("e"), model: "explicit" },
          }),
        ],
        now,
      ),
    ).toEqual([
      { instanceId: "e", model: "explicit" },
      { instanceId: "b", model: "new" },
      { instanceId: "a", model: "old" },
    ]);
  });
});
