import { useAtomValue } from "@effect/atom-react";
import { collectLimitAccounts, remainingPercent } from "@t3tools/shared/usageLimits";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { useQuietThreadShell } from "../../state/entities";

export function QuickUsageLimits({ onOpenUsage }: { readonly onOpenUsage: () => void }) {
  const threadRef = useThreadRouteRef();
  const thread = useQuietThreadShell(threadRef);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const accounts = collectLimitAccounts(presentations);

  const activeModel = thread?.modelSelection?.model;
  const activeInstanceId = thread?.modelSelection?.instanceId;
  const activeProvider = thread?.modelSelection?.provider;

  const activeAccount =
    activeInstanceId || activeProvider
      ? accounts.find(
          (entry) =>
            (activeInstanceId && entry.key === activeInstanceId) ||
            (activeProvider && entry.driver === activeProvider),
        )
      : undefined;

  const defaultAccount =
    accounts.find(
      (entry) =>
        entry.driver === "codex" && entry.limits.windows.length > 0 && !entry.limits.unavailable,
    ) ??
    accounts.find((entry) => entry.limits.windows.length > 0 && !entry.limits.unavailable) ??
    accounts[0];

  const currentAccount = activeAccount ?? defaultAccount;
  const hasAccountLimits =
    (currentAccount?.limits?.windows?.length ?? 0) > 0 && !currentAccount?.limits?.unavailable;

  // If there's an active thread with a local, free, or unlimited provider (or no limit windows)
  const isUnlimited = Boolean(
    thread &&
      (!hasAccountLimits ||
        activeModel?.toLowerCase().includes("free") ||
        activeModel?.toLowerCase().includes("ollama") ||
        activeModel?.toLowerCase().includes("ovh") ||
        activeModel?.toLowerCase().includes("bifrost")),
  );

  const windows = currentAccount?.limits.windows ?? [];

  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });

  const refreshOnHover = (open: boolean) => {
    if (!open) return;
    for (const [environmentId, presentation] of presentations) {
      if (presentation.connection.phase === "connected") {
        void refreshUsageLimits(
          environmentId,
          () => refreshProviders({ environmentId, input: {} }),
          true,
        ).catch(() => {});
      }
    }
  };

  const sessionLimit = windows.find((item) => item.kind !== "weekly");
  const weeklyLimit = windows.find((item) => item.kind === "weekly");

  const sessionPercent = isUnlimited
    ? 100
    : sessionLimit
      ? Math.max(0, Math.min(100, remainingPercent(sessionLimit)))
      : null;
  const weeklyPercent = isUnlimited
    ? 100
    : weeklyLimit
      ? Math.max(0, Math.min(100, remainingPercent(weeklyLimit)))
      : null;

  const formatReset = (resetsAt: number | string | undefined | null) => {
    if (!resetsAt) return null;
    const date = new Date(resetsAt);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString("ru-RU", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const sessionReset = formatReset(sessionLimit?.resetsAt);
  const weeklyReset = formatReset(weeklyLimit?.resetsAt);

  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip onOpenChange={refreshOnHover}>
        <TooltipTrigger
          delay={100}
          render={
            <SidebarMenuButton
              size="icon"
              aria-label="Лимиты использования"
              onClick={onOpenUsage}
            >
              <svg className="size-4.5" viewBox="0 0 24 24" fill="none" aria-hidden>
                {/* Top arc: 1 quarter (session limit), centered strictly at 12 o'clock above the rhombus */}
                <path
                  d="M 6.46 4.91 A 9 9 0 0 1 17.54 4.91"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.3"
                />
                {sessionPercent !== null && sessionPercent > 0 ? (
                  <path
                    d="M 6.46 4.91 A 9 9 0 0 1 17.54 4.91"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${sessionPercent} 100`}
                    opacity="1"
                  />
                ) : null}

                {/* Bottom arc: 3 quarters (weekly limit), on the same circle, separated by gaps */}
                <path
                  d="M 19.09 6.46 A 9 9 0 1 1 4.91 6.46"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.3"
                />
                {weeklyPercent !== null && weeklyPercent > 0 ? (
                  <path
                    d="M 19.09 6.46 A 9 9 0 1 1 4.91 6.46"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    pathLength="100"
                    strokeDasharray={`${weeklyPercent} 100`}
                    opacity="1"
                  />
                ) : null}

                {/* Central rhombus: strictly centered with top point under the 1/4 arc center */}
                <path
                  d="M 12 8.5 L 15.5 12 L 12 15.5 L 8.5 12 Z"
                  fill="currentColor"
                  opacity="0.8"
                />
              </svg>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top" align="center" className="p-2 min-w-[220px]">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between border-b pb-1">
              <span className="font-semibold text-foreground">
                {isUnlimited
                  ? (activeModel ?? "Бесплатная модель")
                  : (currentAccount?.driver === "codex"
                      ? "Лимиты Codex"
                      : (currentAccount?.displayName ?? "Лимиты провайдера"))}
              </span>
              {isUnlimited ? (
                <span className="text-[10px] text-emerald-500 font-medium">Free / Local</span>
              ) : currentAccount?.label ? (
                <span className="text-[10px] text-muted-foreground font-normal truncate max-w-[100px]">
                  {currentAccount.label}
                </span>
              ) : null}
            </div>

            {isUnlimited ? (
              <div className="space-y-1 py-0.5">
                <div className="flex items-center justify-between gap-3 text-emerald-500 font-medium">
                  <span>Без ограничений квоты</span>
                  <span>100%</span>
                </div>
                <div className="text-[10px] text-muted-foreground leading-tight">
                  Для активной модели ({activeModel}) не действуют ограничения по сессионной или недельной квоте.
                </div>
              </div>
            ) : (
              <>
                {activeModel && (
                  <div className="text-[10px] text-muted-foreground -mt-1 pb-0.5">
                    Модель: <span className="text-foreground font-medium">{activeModel}</span>
                  </div>
                )}
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">5 часов (сессия):</span>
                    <span className="font-medium text-foreground">
                      {sessionPercent !== null ? `${sessionPercent}%` : "—"}
                    </span>
                  </div>
                  {sessionReset ? (
                    <div className="text-[10px] text-muted-foreground/80">
                      Сброс: {sessionReset}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Недельный лимит:</span>
                    <span className="font-medium text-foreground">
                      {weeklyPercent !== null ? `${weeklyPercent}%` : "—"}
                    </span>
                  </div>
                  {weeklyReset ? (
                    <div className="text-[10px] text-muted-foreground/80">
                      Сброс: {weeklyReset}
                    </div>
                  ) : null}
                </div>
              </>
            )}

            <div className="border-t pt-1 text-[10px] text-muted-foreground/70">
              Нажми, чтобы открыть страницу Usage
            </div>
          </div>
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
