// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- Test the proxy over a real loopback socket.
import * as NodeHttp from "node:http";
import { expect, it, vi } from "vite-plus/test";
import { createModelGatewayProxy } from "./modelGatewayProxy.ts";

it("does not boot for health checks, streams requests and releases the idle gateway", async () => {
  const upstream = NodeHttp.createServer((request, response) => request.pipe(response));
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as { port: number };
  let starts = 0,
    stops = 0;
  const gateway = await createModelGatewayProxy({
    port: 0,
    upstream: new URL(`http://127.0.0.1:${address.port}`),
    idleMs: 1000,
    start: async () => {
      starts++;
    },
    stop: () => {
      stops++;
    },
  });
  const proxyAddress = gateway.server.address() as { port: number };
  const url = `http://127.0.0.1:${proxyAddress.port}`;
  vi.useFakeTimers();
  try {
    expect((await (await fetch(`${url}/api/health`)).json()).status).toBe("sleeping");
    expect(starts).toBe(0);
    const body = "bounded assistant input";
    expect(await (await fetch(`${url}/v1/chat/completions`, { method: "POST", body })).text()).toBe(
      body,
    );
    expect(starts).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(stops).toBe(1);
    expect((await (await fetch(`${url}/api/health`)).json()).status).toBe("sleeping");
    expect(await (await fetch(`${url}/v1/models`, { method: "POST", body: "next" })).text()).toBe(
      "next",
    );
    expect(starts).toBe(2);
  } finally {
    vi.useRealTimers();
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  }
});

it("releases a failed gateway once its other requests finish, then starts it again", async () => {
  const held = Promise.withResolvers<NodeHttp.ServerResponse>();
  const upstream = NodeHttp.createServer((request, response) => {
    if (request.url === "/hold") held.resolve(response);
    else if (request.url === "/fail") response.destroy();
    else response.end("ok");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address() as { port: number };
  const started = vi.fn(async () => {});
  const stopped = Promise.withResolvers<void>();
  const stop = vi.fn(() => stopped.resolve());
  const gateway = await createModelGatewayProxy({
    port: 0,
    upstream: new URL(`http://127.0.0.1:${address.port}`),
    idleMs: 60_000,
    start: started,
    stop,
  });
  const proxyAddress = gateway.server.address() as { port: number };
  const url = `http://127.0.0.1:${proxyAddress.port}`;
  try {
    const pending = fetch(`${url}/hold`);
    const heldResponse = await held.promise;
    expect((await fetch(`${url}/fail`)).status).toBe(502);
    expect(stop).not.toHaveBeenCalled();
    heldResponse.end("finished");
    expect(await (await pending).text()).toBe("finished");
    await stopped.promise;
    expect((await (await fetch(`${url}/__mt/status`)).json()).status).toBe("sleeping");
    expect(await (await fetch(`${url}/v1/models`)).text()).toBe("ok");
    expect(started).toHaveBeenCalledTimes(2);
  } finally {
    gateway.close();
    upstream.closeAllConnections();
    upstream.close();
  }
});
