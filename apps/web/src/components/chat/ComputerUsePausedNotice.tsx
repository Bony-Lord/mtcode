import { useEffect, useState } from "react";
import { Button } from "../ui/button";

export function ComputerUsePausedNotice() {
  const [paused, setPaused] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Subscribe to the native Esc pause and load its persisted state.
  useEffect(() => {
    const bridge = window.desktopBridge;
    let current = true;
    let receivedEvent = false;
    const unsubscribe = bridge?.onComputerUsePauseChange?.((next) => {
      receivedEvent = true;
      setPaused(next);
      setResumeFailed(false);
    });
    void bridge
      ?.computerUsePause?.()
      .then((next) => {
        if (current && !receivedEvent) setPaused(next);
      })
      .catch(() => {});
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, []);

  if (!paused) return null;
  return (
    <div className="mx-3 mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span role="status">
        {resumeFailed ? "Не удалось снять паузу управления ПК" : "Управление ПК на паузе"}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            const next = await window.desktopBridge?.computerUsePause?.(true);
            if (next !== undefined) setPaused(next);
          } catch {
            setResumeFailed(true);
          }
        }}
      >
        Снять паузу
      </Button>
    </div>
  );
}
