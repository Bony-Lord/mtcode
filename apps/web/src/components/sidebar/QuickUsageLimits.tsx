import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { estimateDelegatedQuota } from "@t3tools/shared/delegatedQuota";
import { Link } from "@tanstack/react-router";
import {
  exhaustedUsageWindow,
  providerUsageDisplaySource,
  remainingPercent,
  usageWindowApplies,
} from "@t3tools/shared/usageLimits";
import { useState } from "react";
import { flushSync } from "react-dom";
import { isSmartModel } from "@t3tools/shared/smartModelRouting";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { CodexUsageSignInDialog } from "../settings/CodexUsageSignInDialog";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useThreadRouteTarget } from "../../hooks/useThreadRouteTarget";
import { useQuietThreadShell, useThreadProjection } from "../../state/entities";
import { useComposerDraftModelState, useComposerDraftStore } from "../../composerDraftStore";
import { threadHasStarted } from "../../lib/chatThreadActions";
import { selectedUsageModel } from "./QuickUsageLimits.logic";

const arcs = [
  { id: "session", path: "M9.771 6.674 A14 14 0 0 1 26.229 6.674", origin: "18px 5px" },
  { id: "weekly", path: "M29.326 9.771 A14 14 0 1 1 6.674 9.771", origin: "18px 21px" },
] as const;
type Segment = (typeof arcs)[number]["id"];

function windowLabel(window: ServerProviderUsageWindow | undefined, fallback: string) {
  if (!window) return fallback;
  if (window.kind === "weekly") return "Недельный лимит";
  if (window.kind === "session" && window.windowDurationMins === 300) return "5-часовой лимит";
  return window.label;
}

function windowSummary(window: ServerProviderUsageWindow | undefined, fallback: string) {
  const value = window ? `осталось ${remainingPercent(window)}%` : "нет данных";
  return `${windowLabel(window, fallback)} · ${value}`;
}

export function QuickUsageLimits({ onOpenUsage }: { readonly onOpenUsage: () => void }) {
  const minute = useNowMinute();
  const [openedAt, setOpenedAt] = useState(0);
  const now = Math.max(Date.parse(minute + "Z"), openedAt);
  const [open, setOpen] = useState(false);
  const [quotaLogin, setQuotaLogin] = useState<{
    environmentId: EnvironmentId;
    managed: ServerProvider;
  } | null>(null);
  const [segment, setSegment] = useState<Segment | null>(null);
  const target = useThreadRouteTarget();
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const thread = useQuietThreadShell(threadRef);
  const detail = useThreadProjection(threadRef);
  const activeRun = detail?.projection.runs.find((run) => run.id === thread?.runtime?.activeRunId);
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
    detail?.projection.thread.modelSelection ?? thread?.modelSelection,
    threadHasStarted(thread),
    activeRun?.modelSelection,
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
  const estimate =
    open && provider && selection
      ? estimateDelegatedQuota(
          detail?.projection.subagents ?? [],
          provider,
          selection.model,
          now,
          false,
        )
      : null;
  const estimatedRetry =
    estimate?.retryAt !== null && estimate?.retryAt !== undefined && estimate.retryAt > now
      ? new Date(estimate.retryAt).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" })
      : null;
  const windows =
    limits?.windows.filter(
      (window) =>
        (window.observedUntil === undefined || Date.parse(window.observedUntil) > now) &&
        (!selection || usageWindowApplies(window, selection.model)),
    ) ?? [];
  const session =
    windows.find((window) => window.kind === "session" && window.windowDurationMins === 300) ??
    windows.find((window) => window.kind === "session");
  const weekly = windows.find((window) => window.kind === "weekly");
  const exhausted = exhaustedUsageWindow(source, now, selection?.model) !== undefined;
  const hasNumbers = windows.some((window) => window.usedPercent !== undefined);
  const shortSummary = windowSummary(session, "5-часовой лимит");
  const longSummary = windowSummary(weekly, "Недельный лимит");
  const name =
    provider?.displayName ??
    (provider?.driver === "codex" ? "Codex" : provider?.driver) ??
    (automatic ? "Авто · все провайдеры" : "Лимиты");
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refresh = (open: boolean) => {
    setOpen(open);
    if (!open || !environmentId || !source) return;
    setOpenedAt(() => Date.now());
    if (presentations.get(environmentId)?.connection.phase !== "connected") return;
    void refreshUsageLimits(
      environmentId,
      () => refreshProviders({ environmentId, input: { instanceId: source.instanceId } }),
      true,
    ).catch(() => {});
  };
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={refresh}>
        <Tooltip disabled={open}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    aria-label={`Лимиты · ${name}`}
                    aria-description={`${shortSummary}. ${longSummary}`}
                    onBlur={() => setSegment(null)}
                    onPointerLeave={() => setSegment(null)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                      event.preventDefault();
                      setSegment(event.key === "ArrowLeft" ? "session" : "weekly");
                    }}
                  >
                    <svg
                      className="size-8 overflow-visible"
                      viewBox="0 0 36 36"
                      fill="none"
                      aria-hidden
                    >
                      {exhausted ? (
                        <circle
                          cx="18"
                          cy="18"
                          r="14"
                          stroke="currentColor"
                          strokeWidth="2.7"
                          className="text-warning"
                        />
                      ) : null}
                      {arcs.map(({ id, path, origin }) => {
                        const window = id === "session" ? session : weekly;
                        const percent = window ? remainingPercent(window) : 0;
                        const hovered = segment === id && !open;
                        return (
                          <g key={id}>
                            <path
                              d={path}
                              stroke="transparent"
                              strokeWidth="11"
                              onPointerEnter={() => setSegment(id)}
                              onPointerLeave={() =>
                                setSegment((current) => (current === id ? null : current))
                              }
                            />
                            {!exhausted ? (
                              <g
                                className={`pointer-events-none transition-transform duration-150 motion-reduce:transition-none ${hovered ? "scale-110" : ""}`}
                                style={{ transformOrigin: origin }}
                              >
                                <path
                                  d={path}
                                  stroke="currentColor"
                                  strokeWidth="2.7"
                                  strokeLinecap="round"
                                  opacity="0.35"
                                />
                                {percent > 0 ? (
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
                            ) : null}
                          </g>
                        );
                      })}
                      {exhausted || !hasNumbers ? (
                        <text
                          x="18"
                          y="23"
                          textAnchor="middle"
                          fill="currentColor"
                          className={
                            exhausted
                              ? "text-base font-bold text-warning"
                              : "text-base font-semibold"
                          }
                        >
                          {exhausted ? "!" : "?"}
                        </text>
                      ) : (
                        <path
                          d="M18 13.5 L22.5 18 L18 22.5 L13.5 18 Z"
                          fill="currentColor"
                          opacity="0.8"
                        />
                      )}
                    </svg>
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="top">
            {segment === "session"
              ? shortSummary
              : segment === "weekly"
                ? longSummary
                : exhausted
                  ? "Лимит исчерпан"
                  : `${shortSummary} · ${longSummary}`}
          </TooltipPopup>
        </Tooltip>
        {open ? (
          <PopoverPopup side="top" align="start" width="md" aria-label="Лимиты аккаунта">
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2 text-sm font-medium">
                {provider ? (
                  <ProviderInstanceIcon
                    driverKind={provider.driver}
                    displayName={name}
                    size="compact"
                  />
                ) : null}
                {name}
              </div>
              {selection ? (
                <div className="break-all text-muted-foreground">{selection.model}</div>
              ) : null}
              {provider?.auth.email ? (
                <div className="text-muted-foreground">{provider.auth.email}</div>
              ) : null}
              {source !== provider ? (
                <div className="text-muted-foreground">
                  Источник лимитов: {source?.displayName ?? "Codex"}
                </div>
              ) : null}
              {runIsActive &&
              activeRun &&
              activeRun.modelSelection.instanceId !== selection?.instanceId ? (
                <div className="text-muted-foreground">
                  Текущий запуск:{" "}
                  {providers?.find(
                    (entry) => entry.instanceId === activeRun.modelSelection.instanceId,
                  )?.displayName ?? activeRun.modelSelection.instanceId}
                </div>
              ) : null}
              {windows.length === 0 ? (
                <div>
                  {automatic
                    ? "Авто выберет модель при отправке запроса."
                    : provider?.auth.subscriptionSharing
                      ? "MT Code пока не получил числовые лимиты для этого аккаунта."
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
              {estimate &&
              (estimate.requestsPerCycle !== null || estimatedRetry) &&
              !windows.some((window) => window.observedUntil === undefined) ? (
                <div className="space-y-1 border-t border-border pt-2 text-muted-foreground">
                  <div>Оценка по запускам помощников в этом чате</div>
                  {estimate.requestsPerCycle !== null ? (
                    <div>
                      Около {estimate.requestsPerCycle} за цикл · осталось ≈ {estimate.remaining}
                    </div>
                  ) : null}
                  {estimate.recoveryMs !== null ? (
                    <div>
                      В прошлых циклах первый успех через ≈{" "}
                      {Math.ceil(estimate.recoveryMs / 60_000)} мин.
                    </div>
                  ) : null}
                  {estimatedRetry ? <div>Следующая проба с {estimatedRetry}</div> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap justify-end gap-1 border-t border-border pt-2">
                {provider && environmentId ? (
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    render={
                      <Link
                        to="/settings/providers"
                        search={{ environmentId, instanceId: provider.instanceId }}
                      />
                    }
                  >
                    Настройки аккаунта
                  </Button>
                ) : null}
                {provider?.auth.subscriptionSharing &&
                environmentId &&
                !windows.some((window) => window.observedUntil === undefined) ? (
                  <>
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      onClick={() => {
                        setOpen(false);
                        setQuotaLogin({ environmentId, managed: provider });
                      }}
                    >
                      Войти для лимитов Codex
                    </Button>
                    <ChatGptUsageButton size="xs" />
                  </>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => {
                    flushSync(() => setOpen(false));
                    onOpenUsage();
                  }}
                >
                  Все лимиты
                </Button>
              </div>
            </div>
          </PopoverPopup>
        ) : null}
      </Popover>
      {quotaLogin ? (
        <CodexUsageSignInDialog {...quotaLogin} onClose={() => setQuotaLogin(null)} />
      ) : null}
    </SidebarMenuItem>
  );
}
