// @effect-diagnostics nodeBuiltinImport:off -- Desktop-owned loopback streaming proxy.
// @effect-diagnostics globalTimers:off -- Node owns the idle timer so it can be unreferenced.
import * as NodeHttp from "node:http";

/** Keep the public loopback endpoint alive while the large gateway sleeps between requests. */
export async function createModelGatewayProxy(input: {
  readonly port: number;
  readonly upstream: URL;
  readonly idleMs: number;
  readonly start: () => Promise<void>;
  readonly stop: () => void;
}) {
  let ready = false;
  let restartRequired = false;
  let boot: Promise<void> | undefined;
  let active = 0;
  let closing = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const cancelIdle = () => {
    clearTimeout(idle);
    idle = undefined;
  };
  const stop = () => {
    ready = false;
    restartRequired = false;
    boot = undefined;
    input.stop();
  };
  const scheduleIdle = () => {
    cancelIdle();
    if (active || !ready || closing) return;
    if (restartRequired) {
      stop();
      return;
    }
    idle = setTimeout(() => {
      if (!active) stop();
    }, input.idleMs);
    idle.unref();
  };
  const wake = () =>
    (boot ??= input
      .start()
      .then(() => {
        if (closing) {
          input.stop();
          return;
        }
        ready = true;
        scheduleIdle();
      })
      .catch((error: unknown) => {
        boot = undefined;
        throw error;
      }));
  const server = NodeHttp.createServer(async (request, response) => {
    if (request.url === "/__mt/status" || request.url === "/api/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(
        JSON.stringify({
          status: ready ? "ready" : boot ? "starting" : "sleeping",
          activeRequests: active,
        }),
      );
      return;
    }
    if (closing) {
      response.writeHead(503);
      response.end();
      return;
    }
    active++;
    cancelIdle();
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      scheduleIdle();
    };
    response.once("close", release);
    try {
      await wake();
      if (response.destroyed) return;
      const upstream = NodeHttp.request(
        {
          hostname: input.upstream.hostname,
          port: input.upstream.port,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers);
          result.pipe(response);
          result.once("error", () => {
            if (!response.destroyed) restartRequired = true;
            response.destroy();
          });
        },
      );
      upstream.once("error", () => {
        if (response.destroyed) return;
        restartRequired = true;
        if (!response.headersSent) response.writeHead(502);
        response.end("Local model gateway is unavailable.");
      });
      response.once("close", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      if (!response.headersSent) response.writeHead(503);
      response.end("Local model gateway could not start. Retry shortly.");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return {
    server,
    close: () => {
      closing = true;
      cancelIdle();
      server.closeAllConnections();
      server.close();
      input.stop();
    },
  };
}
