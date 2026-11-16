// @effect-diagnostics nodeBuiltinImport:off -- Standalone stdio proxy; no application runtime.
// @effect-diagnostics globalTimers:off -- IPC deadlines and heartbeat only while tools run.
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodeReadline from "node:readline";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const CONTROL_TOOLS = new Set([
  "click",
  "right_click",
  "type_text",
  "press_key",
  "scroll",
  "drag",
  "hover",
  "activate_app",
  "run_steps",
  "set_value",
  "select_text",
  "clipboard_write",
  "screenshot",
  "zoom",
  "browser_screenshot",
  "browser_open_tab",
  "browser_navigate",
  "browser_select_tab",
  "browser_click",
  "browser_type",
  "browser_fill",
  "browser_press_key",
  "browser_handle_dialog",
  "browser_close_tab",
  "browser_close_all_tabs",
  "browser_upload_file",
]);
export const isComputerControlTool = (name: unknown): boolean =>
  typeof name === "string" && CONTROL_TOOLS.has(name);

export function runDesktopActivityProxy(binary: string, args: readonly string[] = []): void {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = NodeChildProcess.spawn(binary, args, {
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const scopeId = NodeCrypto.randomUUID();
  const pipe =
    process.env.MTCODE_DESKTOP_REMOTE_CONTROL === "1"
      ? undefined
      : process.env.MTCODE_ACTIVITY_PIPE;
  const running = new Set<string | number>(),
    denied = new Set<string | number>();
  let socket: NodeNet.Socket | undefined, connection: Promise<void> | undefined;
  let sequence = 0,
    escaped = false;
  const requests = new Map<
    number,
    {
      resolve: (result: { ok: boolean; message?: string }) => void;
      reject: (cause: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const output = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const refuse = (id: unknown, message: string) =>
    output({
      jsonrpc: "2.0",
      id,
      result: { isError: true, content: [{ type: "text", text: message }] },
    });
  const stopped =
    "Пользователь остановил управление клавишей Esc. Не повторяйте команды ПК и браузера и не обходите паузу. Продолжение возможно только после явного разрешения пользователя в настройках.";
  const connect = (): Promise<void> => {
    if (!pipe) return Promise.resolve();
    if (connection) return connection;
    connection = new Promise<void>((resolve, reject) => {
      socket = NodeNet.createConnection(pipe);
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.on("close", () => {
        connection = undefined;
        for (const request of requests.values()) {
          clearTimeout(request.timer);
          request.reject(Error("Activity bridge disconnected"));
        }
        requests.clear();
      });
      NodeReadline.createInterface({ input: socket, crlfDelay: Infinity }).on("line", (line) => {
        let message: { event?: string; id?: number; ok: boolean; message?: string };
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.event === "escape") {
          escaped = true;
          for (const id of running) {
            refuse(id, stopped);
            denied.add(id);
          }
          running.clear();
          child.kill();
          return;
        }
        const request = message.id === undefined ? undefined : requests.get(message.id);
        if (request) {
          clearTimeout(request.timer);
          requests.delete(message.id!);
          request.resolve(message);
        }
      });
    });
    return connection;
  };
  const notify = async (phase: string) => {
    if (!pipe) return { ok: true };
    await connect();
    return await new Promise<{ ok: boolean; message?: string }>((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          requests.delete(id);
          reject(Error("Activity warning unavailable"));
        }, 5000);
      requests.set(id, { resolve, reject, timer });
      socket!.write(`${JSON.stringify({ id, scopeId, phase })}\n`);
    });
  };
  const heartbeat = setInterval(() => {
    if (running.size) void notify("active").catch(() => {});
  }, 1000);
  let inputQueue = Promise.resolve();
  const input = NodeReadline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    inputQueue = inputQueue
      .then(async () => {
        let request: {
          id?: string | number;
          method?: string;
          params?: { name?: string; arguments?: Record<string, unknown> };
        };
        try {
          request = JSON.parse(line);
        } catch {
          child.stdin.write(`${line}\n`);
          return;
        }
        if (request.method === "tools/call") {
          const isAppState = request.params?.name === "get_app_state";
          const args = request.params?.arguments;
          const control =
            isComputerControlTool(request.params?.name) ||
            (isAppState && args?.ocr !== undefined && args.ocr !== "never");
          if (isAppState && request.params && args?.ocr === undefined) {
            request.params.arguments = { ...args, ocr: "never" };
            line = JSON.stringify(request);
          }
          try {
            const permission = escaped
              ? { ok: false, message: stopped }
              : await notify(control ? "prepare" : "check");
            if (!permission.ok) {
              refuse(request.id, permission.message ?? stopped);
              return;
            }
          } catch {
            refuse(
              request.id,
              "Не удалось подключить предупреждение и Esc. Управление не началось. Проверьте, что MT Code запущен.",
            );
            return;
          }
          if (escaped) {
            refuse(request.id, stopped);
            return;
          }
          if (control && request.id !== undefined) running.add(request.id);
        }
        if (!child.stdin.destroyed) child.stdin.write(`${line}\n`);
      })
      .catch(() => {});
  });
  NodeReadline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
    try {
      const response = JSON.parse(line);
      if (denied.has(response.id)) return;
      if (response.id !== undefined && running.delete(response.id) && running.size === 0)
        void notify("waiting").catch(() => {});
    } catch {
      /* Preserve native protocol diagnostics. */
    }
    process.stdout.write(`${line}\n`);
  });
  child.stderr.pipe(process.stderr);
  const close = () => {
    clearInterval(heartbeat);
    input.close();
    socket?.destroy();
    if (!child.killed) child.kill();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  input.once("close", () => {
    if (!child.killed) child.kill();
  });
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    close();
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    close();
    process.exit(escaped ? 0 : (code ?? 0));
  });
}
if (
  process.argv[1] &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(process.argv[1])).href
) {
  const binary = process.argv[2];
  if (!binary) {
    process.stderr.write("Native desktop binary is required\n");
    process.exitCode = 1;
  } else runDesktopActivityProxy(binary);
}
