import { useState, type ReactNode } from "react";
import { Button } from "../ui/button";

export function interactiveHtmlDocument(code: string) {
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:14px system-ui;color:#ddd;background:#171717}button,input,select{font:inherit}canvas,svg,img{max-width:100%}</style></head><body>${code}</body></html>`;
}

export function InteractiveHtmlBlock({
  code,
  isStreaming,
  children,
}: {
  code: string;
  isStreaming: boolean;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [source, setSource] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border" data-interactive-html>
      <div className="flex items-center gap-2 bg-muted px-3 py-1.5 text-xs">
        <span className="mr-auto">Интерактивный результат</span>
        <Button
          size="xs"
          variant="ghost"
          disabled={isStreaming || code.length > 300_000}
          onClick={() => setActive(!active)}
        >
          {active ? "Остановить" : "Открыть"}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setSource(!source)}>
          {source ? "Скрыть код" : "Код"}
        </Button>
      </div>
      {active && !isStreaming ? (
        <iframe
          title="Интерактивный результат"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={interactiveHtmlDocument(code)}
          className="h-100 w-full border-0"
        />
      ) : (
        <p className="m-3 text-xs text-muted-foreground">
          График, симуляция или форма. Открывается без доступа к сети и файлам компьютера.
        </p>
      )}
      {source ? children : null}
    </div>
  );
}
