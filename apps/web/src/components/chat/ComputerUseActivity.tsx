import { MonitorIcon } from "lucide-react";

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
  if (!active) return null;
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
        <MonitorIcon className="size-3.5 motion-safe:animate-pulse" />
        Агент управляет компьютером
      </span>
    </div>
  );
}
