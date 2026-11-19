import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });

  it("shows each connected account by name and opens an unfiltered provider list", async () => {
    const mama = managedChatGpt("managed_mama", "mama");
    const profiles: ServerProvider[] = [
      {
        ...mama,
        auth: { status: "authenticated", subscriptionSharing: true, email: "mama@example.test" },
      },
      {
        ...managedChatGpt("native_mama", "mama quota source"),
        auth: {
          status: "authenticated",
          type: "chatgpt",
          email: "mama@example.test",
          label: "ChatGPT Plus Subscription",
        },
        usageLimits: {
          checkedAt,
          windows: [
            {
              id: "primary",
              kind: "session",
              label: "Session",
              windowDurationMins: 300,
              usedPercent: 14,
            },
          ],
        },
      },
      managedChatGpt("managed_smith", "smith"),
    ];
    const id = EnvironmentId.make("desk");
    const entry = { target: { label: "Desk" } };
    const presentations = new Map([[id, { entry, serverConfig: { providers: profiles } }]]);
    const allPresentations = new Map([
      [
        id,
        {
          entry,
          serverConfig: {
            providers: [
              ...profiles,
              {
                ...managedChatGpt("open-code", "OpenCode Custom"),
                driver: ProviderDriverKind.make("opencode"),
                enabled: false,
                usageLimits: undefined,
              },
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled
        presentations={presentations}
        allPresentations={allPresentations}
        now={Date.parse(checkedAt)}
      />,
    );

    await screen.getByRole("button", { name: "Другие аккаунты" }).click();
    const rows = screen.getByRole("list");
    await expect.element(rows.getByText("mama", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("86% left", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("smith", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Числовые лимиты пока недоступны")).toBeVisible();
    await expect
      .element(screen.getByText("mama quota source", { exact: true }))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Показать лимиты всех провайдеров" }).click();
    await expect.element(screen.getByText("OpenCode Custom")).toBeVisible();
    await expect.element(screen.getByText("Провайдер выключен")).toBeVisible();
  });
});
