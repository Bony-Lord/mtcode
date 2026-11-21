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
  const selected =
    (draftModelSelectionApplies(draft, threadStarted) && draft.activeProvider
      ? draft.modelSelectionByProvider[draft.activeProvider]
      : undefined) ?? threadSelection;
  return executedIsActive &&
    executedSelection &&
    (!selected || isSmartModel(selected.model)) &&
    !isSmartModel(executedSelection.model)
    ? executedSelection
    : selected;
}
