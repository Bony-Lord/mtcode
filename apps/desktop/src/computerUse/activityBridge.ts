// @effect-diagnostics nodeBuiltinImport:off -- The private local pipe is shared with a standalone stdio child.
// @effect-diagnostics globalTimers:off -- Timers manage the warning, idle delay and overlay fade.
import * as NodeCrypto from "node:crypto";
import * as NodeNet from "node:net";
import * as NodeReadline from "node:readline";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { app, BrowserWindow, globalShortcut, screen } from "electron";

export const COMPUTER_WARNING_MS = 650;
export const COMPUTER_IDLE_MS = 2300;
const LEASE_MS = 4000;
type Phase = "prepare" | "active" | "waiting" | "done" | "stopped";
const labels: Record<Phase, string> = {
  prepare: "Агент начнёт управление · Esc остановит",
  active: "Агент управляет компьютером · Esc остановит",
  waiting: "Ожидание следующего действия · Esc остановит",
  done: "Управление завершено",
  stopped: "Управление остановлено",
};
const windows = new Map<number, BrowserWindow>();
const peers = new Set<NodeNet.Socket>();
const leases = new Map<NodeNet.Socket, ReturnType<typeof setTimeout>>();
let state: Phase | null = null;
let finish: ReturnType<typeof setTimeout> | undefined;
let warning: Promise<void> | undefined;
let paused = false;
let escRegistered = false;
let stopMarker: string | undefined;

function render(next: Phase): Promise<void> {
  state = next;
  const drawing = [...screen.getAllDisplays()].map(async (display) => {
    let window = windows.get(display.id);
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({
        ...display.bounds,
        frame: false,
        transparent: true,
        focusable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        hasShadow: false,
        resizable: false,
        movable: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      window.setIgnoreMouseEvents(true);
      window.setAlwaysOnTop(true, "screen-saver");
      windows.set(display.id, window);
      const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;overflow:hidden;background:transparent}
      .frame{position:fixed;inset:0;background:linear-gradient(90deg,#9163ff55,transparent 25px,transparent calc(100% - 25px),#9163ff55);border-left:2px solid #a78bfa99;border-right:2px solid #a78bfa99;opacity:1;transition:opacity .45s}
      .status{position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:20px;color:#ede9fe;background:#211935ed;font:13px system-ui;border:1px solid #a78bfa88}
      body[data-phase=done] .frame,body[data-phase=stopped] .frame{opacity:0}
      </style><div class="frame"></div><div class="status" role="status"></div>`;
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    }
    if (window.isDestroyed()) return;
    const value = state ?? next;
    await window.webContents.executeJavaScript(
      `document.body.dataset.phase=${JSON.stringify(value)};document.querySelector('.status').textContent=${JSON.stringify(labels[value])};`,
    );
    if (!window.isVisible()) window.showInactive();
  });
  return Promise.all(drawing).then(() => {});
}

function closeOverlay(): void {
  for (const window of windows.values()) if (!window.isDestroyed()) window.destroy();
  windows.clear();
  state = null;
  if (escRegistered) globalShortcut.unregister("Escape");
  escRegistered = false;
}
function end(phase: "done" | "stopped"): void {
  if (finish) clearTimeout(finish);
  void render(phase).catch(() => {});
  finish = setTimeout(closeOverlay, 900);
}
function release(peer: NodeNet.Socket): void {
  const lease = leases.get(peer);
  if (lease) clearTimeout(lease);
  leases.delete(peer);
  if (leases.size || paused || !state || state === "done") return;
  if (finish) clearTimeout(finish);
  void render("waiting").catch(() => {});
  finish = setTimeout(() => end("done"), COMPUTER_IDLE_MS);
}
function keepAlive(peer: NodeNet.Socket): void {
  const lease = leases.get(peer);
  if (lease) clearTimeout(lease);
  leases.set(
    peer,
    setTimeout(() => release(peer), LEASE_MS),
  );
}
function escape(): void {
  paused = true;
  if (stopMarker) {
    try {
      NodeFS.mkdirSync(NodePath.dirname(stopMarker), { recursive: true });
      NodeFS.writeFileSync(stopMarker, "paused\n");
    } catch {
      /* In-memory pause still applies. */
    }
  }
  for (const lease of leases.values()) clearTimeout(lease);
  leases.clear();
  for (const peer of peers) peer.write('{"event":"escape"}\n');
  end("stopped");
}
export function resumeComputerUse(): void {
  if (stopMarker) NodeFS.rmSync(stopMarker, { force: true });
  paused = false;
  for (const peer of peers) peer.write('{"event":"resume"}\n');
}
export function isComputerUsePaused(): boolean {
  return paused;
}

export function startComputerActivityBridge(): void {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- This process-level bridge is created before the Effect runtime.
  if (NodeOS.platform() !== "win32") return;
  const pipe = `\\\\.\\pipe\\mtcode-computer-${NodeCrypto.randomUUID()}`;
  process.env.MTCODE_ACTIVITY_PIPE = pipe;
  const server = NodeNet.createServer((peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.once("close", () => {
      peers.delete(peer);
      release(peer);
    });
    NodeReadline.createInterface({ input: peer, crlfDelay: Infinity }).on("line", (line) => {
      if (line.length > 4096) {
        peer.destroy();
        return;
      }
      void (async () => {
        let request: { id?: number; phase?: string };
        try {
          request = JSON.parse(line);
        } catch {
          return;
        }
        const send = (ok: boolean, message?: string) => {
          if (!peer.destroyed) peer.write(`${JSON.stringify({ id: request.id, ok, message })}\n`);
        };
        if (paused) {
          send(false, "Управление остановлено. Разрешите его снова в настройках MT Code.");
          return;
        }
        if (request.phase === "check") {
          send(true);
          return;
        }
        if (request.phase === "waiting") {
          release(peer);
          send(true);
          return;
        }
        if (request.phase !== "prepare" && request.phase !== "active") {
          send(false);
          return;
        }
        if (!escRegistered) escRegistered = globalShortcut.register("Escape", escape);
        if (!escRegistered) {
          send(false, "Esc занят другим приложением. Управление не началось.");
          return;
        }
        if (finish) clearTimeout(finish);
        keepAlive(peer);
        if (!warning && (!state || state === "done" || state === "stopped")) {
          warning = render("prepare")
            .then(() => new Promise<void>((resolve) => setTimeout(resolve, COMPUTER_WARNING_MS)))
            .finally(() => {
              warning = undefined;
            });
        }
        try {
          if (warning) await warning;
          if (paused || peer.destroyed) {
            send(false);
            return;
          }
          if (state !== "active") await render("active");
          send(!paused);
        } catch {
          release(peer);
          send(false, "Не удалось показать предупреждение. Управление не началось.");
        }
      })().catch(() => peer.destroy());
    });
  });
  server.on("error", () => {});
  server.listen(pipe).unref();
  void app.whenReady().then(() => {
    stopMarker = NodePath.join(app.getPath("userData"), "computer-use.paused");
    paused ||= NodeFS.existsSync(stopMarker);
  });
  app.once("will-quit", () => {
    closeOverlay();
    if (finish) clearTimeout(finish);
    for (const lease of leases.values()) clearTimeout(lease);
    for (const peer of peers) peer.destroy();
    server.close();
  });
}
