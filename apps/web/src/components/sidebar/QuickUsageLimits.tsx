import { useAtomValue } from "@effect/atom-react";
import { collectLimitAccounts, remainingPercent } from "@t3tools/shared/usageLimits";
import { useEffect, useState } from "react";
import { environmentPresentations } from "../../state/presentation";
import { useNowMinute } from "../../hooks/useNowMinute";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { UsageLimitsSection } from "../usage/UsageLimits";

const HIDDEN = new Set<never>();

export function QuickUsageLimits({ onOpenUsage }: { readonly onOpenUsage: () => void }) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  const accounts = collectLimitAccounts(presentations);
  const account = accounts.find((entry) => entry.driver === "codex") ?? accounts[0];
  const windows = account?.limits.windows ?? [];
  const [hovered, setHovered] = useState(false);
  const [page, setPage] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Rotates the native hover tooltip timer only while the pointer or focus is on the control.
  useEffect(() => {
    if (!hovered || windows.length < 2) return;
    const timer = setInterval(() => setPage((value) => value + 1), 2500);
    return () => clearInterval(timer);
  }, [hovered, windows.length]);
  const current = windows[page % Math.max(1, windows.length)];
  const left = current ? remainingPercent(current) : null;
  const label = current
    ? current.kind === "weekly"
      ? "Недельный лимит"
      : /5.?hour|5.?h|primary/i.test(current.label + current.id)
        ? "5 часов"
        : current.label
    : "Лимиты пока недоступны";
  const summary = left === null ? label : `${label} · осталось ${left}%`;
  return (
    <SidebarMenuItem className="shrink-0">
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton
                    size="icon"
                    className="size-10 [&_svg]:size-8"
                    aria-label={summary}
                    onPointerEnter={() => setHovered(true)}
                    onPointerLeave={() => setHovered(false)}
                    onFocus={() => setHovered(true)}
                    onBlur={() => setHovered(false)}
                  >
                    <svg viewBox="0 0 36 36" fill="none" aria-hidden>
                      <circle
                        cx="18"
                        cy="18"
                        r="13"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        opacity="0.18"
                      />
                      {windows.slice(0, 2).map((window, index) => (
                        <circle
                          key={window.id}
                          cx="18"
                          cy="18"
                          r={13 - index * 3.8}
                          stroke="currentColor"
                          strokeWidth={index ? 1.5 : 2.6}
                          strokeLinecap="round"
                          pathLength="100"
                          strokeDasharray={`${remainingPercent(window)} 100`}
                          transform="rotate(-90 18 18)"
                          opacity={index ? 0.5 : 1}
                        />
                      ))}
                      <path d="m18 12 6 6-6 6-6-6Z" fill="currentColor" opacity="0.7" />
                    </svg>
                  </SidebarMenuButton>
                }
              />
            }
          />
          <TooltipPopup side="right">{summary}</TooltipPopup>
        </Tooltip>
        <PopoverPopup side="right" align="end" width="lg" className="max-h-[70vh] overflow-y-auto">
          <div className="mb-3 flex items-center justify-between gap-3">
            <strong className="text-sm">Лимиты аккаунтов</strong>
            <Button size="xs" variant="ghost" onClick={onOpenUsage}>
              Все Usage
            </Button>
          </div>
          {accounts.length ? (
            <UsageLimitsSection selectedEnvironmentIds={null} hiddenProviders={HIDDEN} now={now} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Провайдер ещё не передал лимиты. Открой Usage и обнови данные.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Время сброса сообщает провайдер. Настройки продолжения после сброса и переключения:
            Настройки → Чаты.
          </p>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
