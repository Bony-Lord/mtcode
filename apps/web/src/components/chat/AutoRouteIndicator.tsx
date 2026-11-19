import type { ScopedThreadRef } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { isSmartModel } from "@t3tools/shared/smartModelRouting";
import { RouteIcon } from "lucide-react";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { environmentPresentations } from "../../state/presentation";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function AutoRouteIndicator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const thread = useQuietThreadShell(threadRef);
  const detail = useThreadProjection(threadRef);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  if (!thread || !isSmartModel(thread.modelSelection.model)) return null;
  const run =
    detail?.projection.runs.find((entry) => entry.id === thread.runtime?.activeRunId) ??
    detail?.projection.runs.findLast(
      (entry) => entry.status !== "queued" && entry.status !== "cancelled",
    );
  const provider = presentations
    .get(threadRef.environmentId)
    ?.serverConfig?.providers.find((entry) => entry.instanceId === run?.modelSelection.instanceId);
  const model = provider?.models.find((entry) => entry.slug === run?.modelSelection.model);
  const name = model?.name ?? run?.modelSelection.model;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground"
            aria-live="polite"
          />
        }
      >
        <RouteIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-52 truncate">Авто → {name ?? "выбор при отправке"}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        <div>
          {name ? `Фактическая модель: ${name}` : "Модель будет выбрана при отправке запроса."}
        </div>
        {provider ? (
          <div>
            {provider.displayName ?? provider.instanceId}
            {provider.auth.email ? ` · ${provider.auth.email}` : ""}
          </div>
        ) : null}
        {run?.modelSelection.options?.map((option) => (
          <div key={option.id}>
            {option.id}: {String(option.value)}
          </div>
        ))}
        {run ? (
          <div>
            {["starting", "running", "waiting"].includes(run.status)
              ? "Выполняет текущий запрос"
              : "Выполняла последний запрос"}
            . Следующий запрос снова оценивает Авто.
          </div>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}
