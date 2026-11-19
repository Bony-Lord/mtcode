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
  const scopeId = NodeCrypto.randomUUID();
  const pipe =
    process.env.MTCODE_DESKTOP_REMOTE_CONTROL === "1"
      ? undefined
      : process.env.MTCODE_ACTIVITY_PIPE;
  type Child = ReturnType<typeof spawn>;
  type RpcId = string | number;
  const running = new Set<RpcId>();
  const forwarded = new Map<RpcId, string | undefined>();
  const spawn = () =>
    NodeChildProcess.spawn(binary, args, {
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  let child: Child | undefined;
  let initialize: Record<string, unknown> | undefined;
  let initialized: string | undefined;
  let escapeVersion = 0;
  let closed = false;
  let socket: NodeNet.Socket | undefined, connection: Promise<void> | undefined;
  let sequence = 0;
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
    "Пользователь остановил управление клавишей Esc. Не повторяйте команды ПК и браузера и не обходите паузу. Пользователь может снять паузу в поле ввода чата.";
  const rejectRequest = (id: RpcId, method: string | undefined, message: string) => {
    if (method === "tools/call") refuse(id, message);
    else output({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  };
  const stopChild = (message: string) => {
    const previous = child;
    child = undefined;
    previous?.kill();
    for (const [id, method] of forwarded) rejectRequest(id, method, message);
    forwarded.clear();
    running.clear();
  };
  const connect = (): Promise<void> => {
    if (!pipe) return Promise.resolve();
    if (connection) return connection;
    connection = new Promise<void>((resolve, reject) => {
      socket = NodeNet.createConnection(pipe);
      socket.once("connect", resolve);
      socket.once("error", reject);
      socket.on("close", () => {
        connection = undefined;
        if (running.size > 0) {
          escapeVersion++;
          stopChild("Activity bridge disconnected");
        }
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
          escapeVersion++;
          stopChild(stopped);
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
  const startChild = (reinitialize: boolean): Promise<Child> => {
    const native = spawn();
    child = native;
    const replayId = reinitialize && initialize ? `mtcode-${NodeCrypto.randomUUID()}` : undefined;
    return new Promise<Child>((resolve, reject) => {
      const fail = (cause: Error) => {
        clearTimeout(timer);
        if (child === native) {
          const wasRunning = running.size > 0;
          stopChild(cause.message);
          if (wasRunning) void notify("waiting").catch(() => {});
        }
        reject(cause);
      };
      const timer = replayId
        ? setTimeout(() => fail(Error("Desktop helper initialization timed out")), 5000)
        : undefined;
      native.stdin.on("error", fail);
      native.on("error", fail);
      native.on("exit", () => {
        clearTimeout(timer);
        fail(Error("Desktop helper stopped"));
      });
      native.stderr.pipe(process.stderr);
      NodeReadline.createInterface({ input: native.stdout, crlfDelay: Infinity }).on(
        "line",
        (line) => {
          if (child !== native) return;
          try {
            const response = JSON.parse(line);
            if (replayId !== undefined && response.id === replayId) {
              clearTimeout(timer);
              if (response.error || !response.result)
                fail(Error("Desktop helper could not reconnect"));
              else {
                if (initialized) native.stdin.write(`${initialized}\n`);
                resolve(native);
              }
              return;
            }
            forwarded.delete(response.id);
            if (running.delete(response.id) && running.size === 0)
              void notify("waiting").catch(() => {});
          } catch {
            /* Preserve native protocol diagnostics. */
          }
          process.stdout.write(`${line}\n`);
        },
      );
      if (replayId === undefined) resolve(native);
      else native.stdin.write(`${JSON.stringify({ ...initialize, id: replayId })}\n`);
    });
  };
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
          return;
        }
        const version = escapeVersion;
        if (request.method === "initialize") initialize = request;
        if (request.method === "notifications/initialized") initialized = line;
        let control = false;
        if (request.method === "tools/call") {
          const isAppState = request.params?.name === "get_app_state";
          const args = request.params?.arguments;
          control =
            isComputerControlTool(request.params?.name) ||
            (isAppState && args?.ocr !== undefined && args.ocr !== "never");
          if (isAppState && request.params && args?.ocr === undefined) {
            request.params.arguments = { ...args, ocr: "never" };
            line = JSON.stringify(request);
          }
        }
        try {
          if ((!child && request.method !== "initialize") || request.method === "tools/call") {
            const permission = await notify("check");
            if (!permission.ok || version !== escapeVersion) {
              if (request.id !== undefined)
                rejectRequest(request.id, request.method, permission.message ?? stopped);
              return;
            }
          }
          if (closed) return;
          const native = child ?? (await startChild(request.method !== "initialize"));
          if (control && !(await notify("prepare")).ok) {
            refuse(request.id, stopped);
            return;
          }
          if (closed) return;
          if (version !== escapeVersion || child !== native) {
            if (request.id !== undefined) rejectRequest(request.id, request.method, stopped);
            return;
          }
          if (request.id !== undefined) {
            forwarded.set(request.id, request.method);
            if (control) running.add(request.id);
          }
          native.stdin.write(`${line}\n`);
        } catch (error) {
          if (request.id !== undefined)
            rejectRequest(
              request.id,
              request.method,
              version === escapeVersion ? String(error) : stopped,
            );
        }
      })
      .catch(() => {});
  });
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    input.close();
    socket?.destroy();
    const previous = child;
    child = undefined;
    previous?.kill();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  input.once("close", close);
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
