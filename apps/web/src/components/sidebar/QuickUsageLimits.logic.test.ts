import { ProviderInstanceId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { selectedUsageModel } from "./QuickUsageLimits.logic";

it("uses the unsent model/account pick and ignores old sticky choices in an existing chat", () => {
  const first = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
  const next = { instanceId: ProviderInstanceId.make("codex-second"), model: "mt-auto" };
  const draft = {
    activeProvider: next.instanceId,
    modelSelectionByProvider: { [next.instanceId]: next },
    modelSelectionExplicit: true,
  };
  expect(selectedUsageModel(draft, first, true)).toBe(next);
  expect(selectedUsageModel({ ...draft, modelSelectionExplicit: false }, first, true)).toBe(first);
  expect(selectedUsageModel({ ...draft, modelSelectionExplicit: false }, undefined, false)).toBe(
    next,
  );
});

it("uses the executed account during Auto and clears it after the run", () => {
  const auto = { instanceId: ProviderInstanceId.make("codex"), model: "mt-auto" };
  const draft = {
    activeProvider: auto.instanceId,
    modelSelectionByProvider: { [auto.instanceId]: auto },
    modelSelectionExplicit: false,
  };
  const first = { instanceId: ProviderInstanceId.make("kilo-free"), model: "kilo-free/ernie" };
  const second = { instanceId: ProviderInstanceId.make("codex-second"), model: "gpt-6.1-sol" };
  expect(selectedUsageModel(draft, auto, true, first, true)).toBe(first);
  expect(selectedUsageModel(draft, auto, true, second, true)).toBe(second);
  expect(selectedUsageModel(draft, auto, true, second)).toBe(auto);
  expect(selectedUsageModel(draft, auto, false)).toBe(auto);
});

it("shows the account selected in the composer while a different account is still running", () => {
  const running = { instanceId: ProviderInstanceId.make("codex-first"), model: "gpt-6.1-sol" };
  const picked = { instanceId: ProviderInstanceId.make("codex-second"), model: "gpt-6.1-sol" };
  const draft = {
    activeProvider: picked.instanceId,
    modelSelectionByProvider: { [picked.instanceId]: picked },
    modelSelectionExplicit: true,
  };
  expect(selectedUsageModel(draft, running, true, running, true)).toBe(picked);
  expect(selectedUsageModel(draft, running, true, running, false)).toBe(picked);
});
