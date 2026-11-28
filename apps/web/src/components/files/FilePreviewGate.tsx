import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { EyeIcon } from "lucide-react";
import { useClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";

const openPreviews = new Set<symbol>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => {
  for (const listener of listeners) listener();
};

/** A hidden or waiting preview never mounts the viewer or starts its reads. */
export function FilePreviewGate({
  children,
  alreadyRevealed = false,
  revealKey = "preview",
  onClose,
}: {
  readonly children: ReactNode;
  readonly alreadyRevealed?: boolean;
  readonly revealKey?: string;
  readonly onClose?: () => void;
}) {
  const onDemand = useClientSettings((settings) => settings.filePreviewOnDemand);
  const maxActive = useClientSettings((settings) => settings.filePreviewMaxActive);
  const [token] = useState(() => Symbol("file-preview"));
  const [revealed, setRevealed] = useState<string | null>(null);
  const requested = alreadyRevealed || revealed === revealKey || !onDemand;
  const admitted = useSyncExternalStore(
    subscribe,
    () => {
      if (!requested) return false;
      let count = 0;
      for (const preview of openPreviews) {
        if (count >= maxActive) break;
        if (preview === token) return true;
        count += 1;
      }
      return false;
    },
    () => false,
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registering a render slot is external to the component
  useEffect(() => {
    if (!requested) return;
    openPreviews.add(token);
    publish();
    return () => {
      openPreviews.delete(token);
      publish();
    };
  }, [requested, token]);
  if (admitted) return children;
  return (
    <div
      className="grid min-h-40 flex-1 place-items-center border bg-muted/55 p-4"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--muted-foreground) 0.4px, transparent 0.65px)",
        backgroundSize: "5px 5px",
      }}
    >
      <div className="flex max-w-xs flex-col items-center gap-3 rounded-lg border bg-background p-4 text-center shadow-sm">
        {requested ? (
          <p role="status" className="text-sm text-muted-foreground">
            Предпросмотр в очереди. Закройте другой предпросмотр, чтобы открыть этот.
          </p>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setRevealed(revealKey)}>
            <EyeIcon className="size-4" />
            Показать предпросмотр
          </Button>
        )}
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
        )}
      </div>
    </div>
  );
}
