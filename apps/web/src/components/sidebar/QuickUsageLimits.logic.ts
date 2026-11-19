import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import { draftModelSelectionApplies } from "../../lib/chatThreadActions";
import { isSmartModel } from "@t3tools/shared/smartModelRouting";

export function selectedUsageModel(
  draft: {
    readonly activeProvider: ProviderInstanceId | null;
    readonly modelSelectionExplicit: boolean;
    readonly modelSelectionByProvider: Partial<Record<ProviderInstanceId, ModelSelection>>;
  },
  threadSelection: ModelSelection | undefined,
  threadStarted: boolean,
  executedSelection?: ModelSelection | undefined,
  executedIsActive = false,
) {
  // A running turn spends on the account it started with; the composer pick only affects
  // the next send, so the limits indicator must follow the run instead of a newer pick.
  if (executedIsActive && executedSelection) return executedSelection;
  const selected =
    (draftModelSelectionApplies(draft, threadStarted) && draft.activeProvider
      ? draft.modelSelectionByProvider[draft.activeProvider]
      : undefined) ?? threadSelection;
  return selected &&
    isSmartModel(selected.model) &&
    executedSelection &&
    !isSmartModel(executedSelection.model)
    ? executedSelection
    : selected;
}
