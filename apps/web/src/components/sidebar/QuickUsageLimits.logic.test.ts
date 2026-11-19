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

it("uses the actual account and model of an Auto run and follows a handoff", () => {
  const auto = { instanceId: ProviderInstanceId.make("codex"), model: "mt-auto" };
  const draft = {
    activeProvider: auto.instanceId,
    modelSelectionByProvider: { [auto.instanceId]: auto },
    modelSelectionExplicit: false,
  };
  const first = { instanceId: ProviderInstanceId.make("kilo-free"), model: "kilo-free/ernie" };
  const second = { instanceId: ProviderInstanceId.make("codex-second"), model: "gpt-6.1-sol" };
  expect(selectedUsageModel(draft, auto, true, first)).toBe(first);
  expect(selectedUsageModel(draft, auto, true, second)).toBe(second);
  expect(selectedUsageModel(draft, auto, false)).toBe(auto);
});

it("shows the account spending the active run, not a newer pick for the next send", () => {
  const running = { instanceId: ProviderInstanceId.make("codex-first"), model: "gpt-6.1-sol" };
  const picked = { instanceId: ProviderInstanceId.make("codex-second"), model: "gpt-6.1-sol" };
  const draft = {
    activeProvider: picked.instanceId,
    modelSelectionByProvider: { [picked.instanceId]: picked },
    modelSelectionExplicit: true,
  };
  // The run in flight still spends on its own account after an automatic account switch.
  expect(selectedUsageModel(draft, running, true, running, true)).toBe(running);
  // Once nothing runs, the pick decides the next send and its limits.
  expect(selectedUsageModel(draft, running, true, running, false)).toBe(picked);
});
