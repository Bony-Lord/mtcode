import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { estimateDelegatedQuota } from "./delegatedQuota.ts";

const provider = {
  driver: ProviderDriverKind.make("opencode"),
  instanceId: ProviderInstanceId.make("free"),
};
const minute = 60_000;
const start = Date.UTC(2026, 10, 21);

function task(model: string, status: "completed" | "failed" | "pending", offset: number) {
  const time = DateTime.makeUnsafe(start + offset * minute);
  return {
    origin: "app_owned" as const,
    providerInstanceId: provider.instanceId,
    model,
    status,
    result: status === "failed" ? "Free usage limit reached." : null,
    updatedAt: time,
    completedAt: status === "pending" ? null : time,
  };
}

it("estimates capacity only across a completed cycle and remembers how soon a probe succeeded", () => {
  const model = "opencode/example";
  const history = [
    task(model, "failed", 0),
    task(model, "completed", 12),
    task(model, "completed", 13),
    task(model, "failed", 14),
  ];
  expect(estimateDelegatedQuota(history, provider, model, start + 15 * minute, false)).toEqual({
    inFlight: 0,
    requestsPerCycle: 2,
    remaining: 0,
    recoveryMs: 12 * minute,
    retryAt: start + 26 * minute,
  });
});

it("counts an in-flight probe across OpenCode models in its pool only", () => {
  const history = [task("opencode/first", "pending", 1)];
  expect(
    estimateDelegatedQuota(history, provider, "opencode/second", start + minute, true).inFlight,
  ).toBe(1);
  expect(
    estimateDelegatedQuota(history, provider, "opencode/second", start + minute, false).inFlight,
  ).toBe(0);
  expect(
    estimateDelegatedQuota(history, provider, "ovh/second", start + minute, true).inFlight,
  ).toBe(0);
});
