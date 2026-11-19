// @effect-diagnostics nodeBuiltinImport:off -- Optional local helper starts outside the server's Effect runtime.
// @effect-diagnostics globalFetch:off globalConsole:off globalTimers:off -- Loopback boot and polling run outside the Effect runtime.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { app } from "electron";
import { createModelGatewayProxy } from "./modelGatewayProxy.ts";

/** Start the user's configured gateway without delaying the desktop's first window. */
export function startConfiguredModelGateway(): void {
  let owned: NodeChildProcess.ChildProcess | undefined;
  let closing = false;
  let proxy: Awaited<ReturnType<typeof createModelGatewayProxy>> | undefined;
  app.once("will-quit", () => {
    closing = true;
    proxy?.close();
    owned?.kill();
  });
  void app.whenReady().then(async () => {
    const configPath = NodePath.join(app.getPath("home"), ".mt", "gateway", "launch.json");
    if (!NodeFS.existsSync(configPath)) return;
    try {
      const config: {
        binary?: unknown;
        args?: unknown;
        enabled?: boolean;
        healthUrl?: string;
        environmentFile?: string;
        proxyPort?: number;
        upstreamPort?: number;
        idleTimeoutSeconds?: number;
      } = JSON.parse(NodeFS.readFileSync(configPath, "utf8"));
      if (
        config.enabled !== true ||
        typeof config.binary !== "string" ||
        !NodePath.isAbsolute(config.binary) ||
        !NodeFS.existsSync(config.binary) ||
        !Array.isArray(config.args) ||
        !config.args.every((arg: unknown) => typeof arg === "string")
      )
        return;
      const healthUrl = new URL(config.healthUrl ?? "http://127.0.0.1:38080/health");
      if (healthUrl.protocol !== "http:" || healthUrl.hostname !== "127.0.0.1") return;
      const environment: Record<string, string> =
        config.environmentFile && NodePath.isAbsolute(config.environmentFile)
          ? JSON.parse(NodeFS.readFileSync(config.environmentFile, "utf8"))
          : {};
      if (!Object.values(environment).every((value) => typeof value === "string")) return;
      const ready = await fetch(healthUrl, {
        signal: AbortSignal.timeout(1000),
      })
        .then((response) => response.ok)
        .catch(() => false);
      if (ready || closing) return;
      if (
        Number.isInteger(config.proxyPort) &&
        Number.isInteger(config.upstreamPort) &&
        config.proxyPort! > 1024 &&
        config.upstreamPort! > 1024 &&
        config.proxyPort !== config.upstreamPort
      ) {
        const upstream = new URL(healthUrl);
        upstream.port = String(config.upstreamPort);
        const stop = () => {
          const child = owned;
          owned = undefined;
          child?.kill();
        };
        proxy = await createModelGatewayProxy({
          port: config.proxyPort!,
          upstream,
          idleMs: Math.max(30, config.idleTimeoutSeconds ?? 120) * 1000,
          stop,
          start: async () => {
            const healthy = () =>
              fetch(upstream, { signal: AbortSignal.timeout(500) })
                .then((response) => response.ok)
                .catch(() => false);
            if (closing) throw new Error("Desktop is closing");
            if (await healthy()) return;
            let startError = false;
            if (!owned) {
              owned = NodeChildProcess.spawn(config.binary as string, config.args as string[], {
                windowsHide: true,
                stdio: "ignore",
                shell: false,
                env: { ...process.env, ...environment, PORT: String(config.upstreamPort) },
              });
              owned.once("error", () => {
                startError = true;
              });
              owned.unref();
            }
            for (let attempt = 0; attempt < 30; attempt++) {
              if (closing || startError || owned?.exitCode !== null) {
                stop();
                throw new Error("Gateway stopped during startup");
              }
              if (await healthy()) return;
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            stop();
            throw new Error("Gateway startup timed out");
          },
        });
        if (closing) proxy.close();
        return;
      }
      owned = NodeChildProcess.spawn(config.binary, config.args, {
        windowsHide: true,
        stdio: "ignore",
        shell: false,
        env: { ...process.env, ...environment },
      });
      owned.on("error", (error) =>
        console.warn("Local model gateway could not start", error.message),
      );
      owned.unref();
    } catch (error) {
      console.warn("Local model gateway configuration could not load", String(error));
    }
  });
}
