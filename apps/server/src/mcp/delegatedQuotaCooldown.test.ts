import { describe, expect, it } from "vite-plus/test";
import {
  ProviderInstanceId,
  type OrchestrationV2Subagent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { delegatedQuotaCooldown } from "./delegatedQuotaCooldown.ts";

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
});
