import { useAtomValue } from "@effect/atom-react";
import {
  providerUsageDisplaySource,
  remainingPercent,
  usageWindowApplies,
} from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { isSmartModel } from "@t3tools/shared/smartModelRouting";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { useComposerDraftModelState, useComposerDraftStore } from "../../composerDraftStore";
import { threadHasStarted } from "../../lib/chatThreadActions";
import { selectedUsageModel } from "./QuickUsageLimits.logic";

const arcs = ["M9.771 6.674 A14 14 0 0 1 26.229 6.674", "M29.326 9.771 A14 14 0 1 1 6.674 9.771"];

export function QuickUsageLimits({ onOpenUsage }: { readonly onOpenUsage: () => void }) {
  const [now, setNow] = useState(Date.now);
  const target = useThreadRouteTarget();
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const thread = useQuietThreadShell(threadRef);
  const detail = useThreadProjection(threadRef);
  const activeRun = detail?.projection.runs.find((run) => run.id === thread?.runtime?.activeRunId);
  const execution =
    activeRun ??
    detail?.projection.runs.findLast(
      (run) => run.status !== "queued" && run.status !== "cancelled",
    );
  const runIsActive =
    activeRun !== undefined &&
    ["preparing", "queued", "starting", "running", "waiting"].includes(activeRun.status);
  const draftTarget = target?.kind === "draft" ? target.draftId : threadRef;
  const draft = useComposerDraftModelState(draftTarget);
  const draftEnvironmentId = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftThread(target.draftId)?.environmentId : undefined,
  );
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const selection = selectedUsageModel(
    draft,
    thread?.modelSelection,
    threadHasStarted(thread),
    execution?.modelSelection,
    runIsActive,
  );
  const environmentId = draftEnvironmentId ?? threadRef?.environmentId;
  const automatic = selection !== undefined && isSmartModel(selection.model);
  const providers = environmentId
    ? presentations.get(environmentId)?.serverConfig?.providers
    : undefined;
  const provider =
    selection && !automatic
      ? providers?.find((entry) => entry.instanceId === selection.instanceId)
      : undefined;
  const source = providerUsageDisplaySource(provider, providers ?? []);
  const limits = source?.usageLimits;
  const windows =
    limits?.windows.filter(
      (window) =>
        (window.observedUntil === undefined || Date.parse(window.observedUntil) > now) &&
        (!selection || usageWindowApplies(window, selection.model)),
    ) ?? [];
  const session =
    windows.find((window) => window.kind === "session") ??
    windows.find((window) => window.kind !== "weekly");
  const weekly = windows.find((window) => window.kind === "weekly");
  const name =
    provider?.displayName ??
    (provider?.driver === "codex" ? "Codex" : provider?.driver) ??
    (automatic ? "Авто · все провайдеры" : "Лимиты");
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refresh = (open: boolean) => {
    if (!open || !environmentId || !source) return;
    setNow(Date.now());
    if (presentations.get(environmentId)?.connection.phase !== "connected") return;
    void refreshUsageLimits(
      environmentId,
      () => refreshProviders({ environmentId, input: { instanceId: source.instanceId } }),
      true,
    ).catch(() => {});
  };
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip onOpenChange={refresh}>
        <TooltipTrigger
          delay={100}
          render={
            <SidebarMenuButton size="icon" aria-label="Лимиты использования" onClick={onOpenUsage}>
              <svg className="size-8" viewBox="0 0 36 36" fill="none" aria-hidden>
                {arcs.map((path, index) => {
                  const window = index === 0 ? session : weekly;
                  const percent = window ? remainingPercent(window) : null;
                  return (
                    <g key={path}>
                      <path
                        d={path}
                        stroke="currentColor"
                        strokeWidth="2.7"
                        strokeLinecap="round"
                        opacity="0.35"
                      />
                      {percent !== null && percent > 0 ? (
                        <path
                          d={path}
                          stroke="currentColor"
                          strokeWidth="2.7"
                          strokeLinecap="round"
                          pathLength="100"
                          strokeDasharray={`${percent} 100`}
                          strokeDashoffset={-(100 - percent) / 2}
                        />
                      ) : null}
                    </g>
                  );
                })}
                <path d="M18 12.5 L23.5 18 L18 23.5 L12.5 18 Z" fill="currentColor" opacity="0.8" />
              </svg>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top" align="center" className="max-w-80">
          <div className="space-y-1 text-xs">
            <div className="font-medium">{name}</div>
            {selection ? (
              <div className="break-all text-muted-foreground">{selection.model}</div>
            ) : null}
            {provider?.auth.email ? (
              <div className="text-muted-foreground">{provider.auth.email}</div>
            ) : null}
            {source !== provider ? (
              <div className="text-muted-foreground">Лимиты подписки Codex для этого аккаунта</div>
            ) : null}
            {windows.length === 0 ? (
              <div>
                {automatic
                  ? "Авто выберет модель при отправке запроса."
                  : provider?.auth.subscriptionSharing
                    ? "Лимиты доступны в ChatGPT → Настройки → Использование."
                    : "Провайдер не передаёт числовые лимиты."}
              </div>
            ) : (
              windows.map((window) => (
                <div key={window.id}>
                  <div>
                    {window.kind === "weekly"
                      ? "Недельный лимит"
                      : window.kind === "session"
                        ? window.windowDurationMins === 300
                          ? "5 часов"
                          : "Сессия"
                        : window.label}
                    {window.observedUntil === undefined
                      ? `: осталось ${remainingPercent(window)}%`
                      : ": лимит исчерпан"}
                  </div>
                  {window.resetsAt && Number.isFinite(Date.parse(window.resetsAt)) ? (
                    <div className="text-muted-foreground">
                      Сброс:{" "}
                      {new Date(window.resetsAt).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  ) : null}
                </div>
              ))
            )}
            <div className="pt-1 text-muted-foreground">Нажми, чтобы открыть использование</div>
          </div>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
