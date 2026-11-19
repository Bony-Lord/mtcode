import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";

// Qwen implements OAuth authenticate, but its ACP initialize advertises only API-key login.
const entrypoint = process.argv[2];
if (!entrypoint) throw new Error("Qwen CLI entrypoint is required");
const child = NodeChildProcess.spawn(
  process.execPath,
  [entrypoint, "--acp", "--auth-type", "qwen-oauth"],
  {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  },
);
const initializeIds = new Set();
const browserRequestIds = new Set();
let authSequence = 0;
NodeReadline.createInterface({ input: process.stdin })
  .on("line", (line) => {
    try {
      const request = JSON.parse(line);
      if (browserRequestIds.delete(request.id)) return;
      if (request.method === "initialize") initializeIds.add(request.id);
    } catch {
      /* Forward the original native protocol line. */
    }
    if (!child.stdin.destroyed) child.stdin.write(`${line}\n`);
  })
  .once("close", () => child.stdin.end());
NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const response = JSON.parse(line);
    const authUrl = response.method === "authenticate/update" && response.params?._meta?.authUri;
    if (typeof authUrl === "string") {
      const id = `qwen-account-browser-${++authSequence}`;
      browserRequestIds.add(id);
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method: "elicitation/create", params: { mode: "url", message: "Войдите в аккаунт Qwen по свежей ссылке. Код действует ограниченное время.", url: authUrl, elicitationId: id } })}\n`,
      );
    }
    if (initializeIds.delete(response.id) && response.result) {
      const methods = response.result.authMethods ?? [];
      if (!methods.some((method) => method.id === "qwen-oauth")) {
        response.result.authMethods = [
          {
            id: "qwen-oauth",
            name: "Войти через аккаунт Qwen",
            description: "Вход через браузер; для Qwen Code требуется Plus или Pro",
          },
          ...methods,
        ];
      }
      line = JSON.stringify(response);
    }
  } catch {
    /* Preserve native diagnostics. */
  }
  process.stdout.write(`${line}\n`);
});
child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.once("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill());
