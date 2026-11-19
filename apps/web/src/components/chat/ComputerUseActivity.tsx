import { MonitorIcon } from "lucide-react";
import { useEffect, useState } from "react";

const IDLE_GRACE_MS = 2300;

/** Uses tool lifecycle events only; this indicator never starts a screen capture. */
export function ComputerUseActivity({
  items,
  working,
}: {
  readonly items: readonly {
    readonly status: string;
    readonly type: string;
    readonly toolSurface?: string | undefined;
    readonly toolName?: string | null | undefined;
  }[];
  readonly working: boolean;
}) {
  const active =
    working &&
    items.some(
      (item) =>
        item.status === "running" &&
        (item.toolSurface === "computer" ||
          (item.type === "dynamic_tool" &&
            /(?:mt-desktop|mt_desktop|computer.use)/i.test(item.toolName ?? ""))),
    );
  const [recentlyActive, setRecentlyActive] = useState(false);
  // Keep the indicator visible between short tool calls, using the overlay's idle timeout.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronizes the indicator with a cancellable idle timer.
  useEffect(() => {
    const timer = window.setTimeout(() => setRecentlyActive(active), active ? 0 : IDLE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!working || (!active && !recentlyActive)) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center"
    >
      <span
        className="m-2 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1 text-xs shadow-lg"
        style={{ borderColor: "#a78bfa66", color: "#a78bfa", boxShadow: "0 0 16px 2px #a78bfa33" }}
      >
        <MonitorIcon className="size-3.5" />
        {active ? "Агент управляет компьютером" : "Ожидание следующего действия"}
      </span>
    </div>
  );
}
