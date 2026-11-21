import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { ProviderStatusBanner } from "./ProviderStatusBanner";

it("offers Reauth for the signed-out account and opens that account's setup", async () => {
  const account: ServerProvider = {
    instanceId: ProviderInstanceId.make("chatgpt-work"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "0.171.0",
    status: "error",
    auth: { status: "unauthenticated", label: "ChatGPT" },
    checkedAt: "2026-11-21T00:00:00.000Z",
    models: [],
    skills: [],
    slashCommands: [],
    setup: { canAuthenticate: true, canInstall: true },
  };
  const open = vi.fn();
  await using screen = await render(
    <ProviderStatusBanner
      environmentId={EnvironmentId.make("environment")}
      status={account}
      onDismiss={vi.fn()}
      onOpenProviderSetup={open}
    />,
  );
  await screen.getByRole("button", { name: "Reauth" }).click();
  expect(open).toHaveBeenCalledWith(account.instanceId);
});
