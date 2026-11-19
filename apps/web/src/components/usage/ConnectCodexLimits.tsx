import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderAccountSignIn } from "../settings/ProviderAccountSignIn";
import { Button } from "../ui/button";

export function ConnectCodexLimits({
  environmentId,
  profile,
}: {
  readonly environmentId: EnvironmentId;
  readonly profile: ServerProvider;
}) {
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [open, setOpen] = useState(false);
  const shadowHome = profile.runtimePaths?.shadowHomePath;
  if (!canManage || !shadowHome || !profile.auth.email) return null;
  return open ? (
    <CodexLimitsSignIn
      environmentId={environmentId}
      profile={profile}
      homePath={`${shadowHome}/native-usage`}
    />
  ) : (
    <Button type="button" size="xs" variant="outline" onClick={() => setOpen(true)}>
      Подключить проценты
    </Button>
  );
}

function CodexLimitsSignIn({
  environmentId,
  profile,
  homePath,
}: {
  readonly environmentId: EnvironmentId;
  readonly profile: ServerProvider;
  readonly homePath: string;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const settings = useEnvironmentSettings(environmentId);
  const installation = useEnvironmentQuery(
    serverEnvironment.providerInstallState({
      environmentId,
      input: { instanceId: profile.instanceId },
    }),
  );
  const update = useAtomCommand(serverEnvironment.updateSettings, "Подключить лимиты Codex");
  const [created, setCreated] = useState<ProviderInstanceId | null>(null);
  const [creating, setCreating] = useState(false);
  const existing = Object.keys(settings.providerInstances).find((id) => {
    const instance = settings.providerInstances[ProviderInstanceId.make(id)];
    return (
      id.startsWith("codex-quota-") &&
      instance?.driver === "codex" &&
      (instance.config as { homePath?: string } | undefined)?.homePath === homePath
    );
  });
  const instanceId = created ?? (existing ? ProviderInstanceId.make(existing) : null);
  const native = providers?.find((provider) => provider.instanceId === instanceId);
  const binaryPath = installation.data?.executablePath;
  const create = async () => {
    if (creating || instanceId !== null || !binaryPath) return;
    setCreating(true);
    const id = ProviderInstanceId.make(`codex-quota-${randomUUID()}`);
    try {
      const result = await update({
        environmentId,
        input: {
          patch: {},
          providerInstanceMutation: {
            operation: "create",
            instanceId: id,
            instance: {
              driver: ProviderDriverKind.make("codex"),
              displayName: `${profile.displayName ?? "Codex"} · лимиты`,
              enabled: true,
              hidden: true,
              routingRole: "excluded",
              config: {
                setupMode: "existing",
                binaryPath,
                homePath,
                launchArgs: '-c cli_auth_credentials_store="file"',
              },
            },
          },
        },
      });
      if (result._tag === "Success") setCreated(id);
    } finally {
      setCreating(false);
    }
  };
  const wrongAccount =
    native?.auth.email &&
    native.auth.email.trim().toLowerCase() !== profile.auth.email?.trim().toLowerCase();
  return (
    <div className="grid w-full gap-2 rounded-lg bg-muted/30 p-2.5">
      <p>
        Один раз войдите в Codex под тем же аккаунтом. Проценты будут обновляться автоматически.
      </p>
      {wrongAccount ? (
        <p className="text-warning">Выбран другой аккаунт. Повторите вход под нужным профилем.</p>
      ) : null}
      {instanceId && native?.accountLogin ? (
        <ProviderAccountSignIn
          environmentId={environmentId}
          instanceId={instanceId}
          driver="codex"
          accountLogin={{ modes: ["oauth", "deviceCode"], supportsLogout: false }}
          isAuthenticated={native.auth.status === "authenticated" && !wrongAccount}
        />
      ) : instanceId ? (
        <span>Подготавливаю вход…</span>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="w-fit"
          disabled={!binaryPath || creating}
          onClick={() => void create()}
        >
          {binaryPath ? "Подготовить вход в Codex" : "Ожидаю сведения об установке Codex…"}
        </Button>
      )}
    </div>
  );
}
