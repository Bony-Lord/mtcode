import { AuthProvidersManageScope } from "@t3tools/contracts";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { useAtomValue } from "@effect/atom-react";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { WizardFooter, WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";
import { MultipleAccountsNote } from "./MultipleAccountsNote";
import { SettingsRow } from "./settingsLayout";

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");

export function AddCodexAccountDialog({
  environmentId,
  onClose,
  renderSetup,
  onAccountCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  // Told when the account is created; the dialog then runs its own sign-in.
  readonly onAccountCreated?:
    | ((instanceId: ProviderInstanceId, displayName: string) => void)
    | undefined;
  readonly renderSetup: (instanceId: ProviderInstanceId, provider: ServerProvider) => ReactNode;
}) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const settings = useEnvironmentSettings(environmentId);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const update = useAtomCommand(serverEnvironment.updateSettings, "Add ChatGPT account");
  const [name, setName] = useState("");
  const displayName = name.trim() ? `ChatGPT · ${name.trim()}` : "Аккаунт ChatGPT";
  const [instanceId, setInstanceId] = useState<ProviderInstanceId | null>(null);
  const [pending, setPending] = useState(false);
  const provider = providers?.find((candidate) => candidate.instanceId === instanceId);
  // Closes itself once the new account connects; the owner unmounts it after
  // the close animation.
  const connected = usesChatGptSharing(provider);
  const namedAccount = useRef<ProviderInstanceId | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Persist provider-reported identity once after the new account signs in.
  useEffect(() => {
    const instance = instanceId && settings.providerInstances[instanceId];
    if (
      !instance ||
      !connected ||
      (!provider?.auth.email && !provider?.usageLimits?.plan) ||
      namedAccount.current === instanceId
    )
      return;
    namedAccount.current = instanceId;
    void update({
      environmentId,
      input: {
        patch: {},
        providerInstanceMutation: {
          operation: "upsert",
          instanceId: instanceId!,
          instance: {
            ...instance,
            ...(!name.trim() && provider?.auth.email
              ? { displayName: `ChatGPT · ${provider.auth.email}` }
              : {}),
            ...(!instance.accountTier && provider?.usageLimits?.plan
              ? {
                  accountTier:
                    provider.usageLimits.plan.toLowerCase() === "free"
                      ? ("free" as const)
                      : ("subscription" as const),
                }
              : {}),
          },
        },
      },
    });
  }, [
    connected,
    environmentId,
    instanceId,
    name,
    provider?.auth.email,
    provider?.usageLimits?.plan,
    settings.providerInstances,
    update,
  ]);

  const createAccount = async () => {
    if (pending || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setPending(true);
    const id = ProviderInstanceId.make(`codex_${randomUUID()}`);
    const result = await update({
      environmentId,
      input: {
        patch: {},
        providerInstanceMutation: {
          operation: "create",
          instanceId: id,
          instance: {
            driver: CODEX_DRIVER_KIND,
            displayName,
            enabled: true,
            ...(settings.providerInstances[ProviderInstanceId.make("codex")]
              ? { settingsProfileId: ProviderInstanceId.make("codex") }
              : {}),
            config: { enabled: true, setupMode: "managed" },
          },
        },
      },
    });
    if (result._tag === "Success") {
      onAccountCreated?.(id, displayName);
      setInstanceId(id);
    }
    setPending(false);
  };

  return (
    <Dialog
      open={!connected}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onOpenChangeComplete={(open) => {
        if (!open && connected) onClose();
      }}
    >
      <WizardPopup size="wide">
        <WizardHeader
          title={instanceId ? displayName : "Add ChatGPT account"}
          description="Общая установка Codex и настройки основного профиля. Имя аккаунта заполнится после входа."
        />
        <WizardPanel>
          {instanceId ? (
            provider?.setup ? (
              renderSetup(instanceId, provider)
            ) : (
              <SettingsRow title="Codex runtime" description="Preparing managed setup." />
            )
          ) : (
            <form
              id="add-codex-account"
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void createAccount();
              }}
            >
              <SettingsRow
                title="Account name"
                description="Необязательно. Можно оставить пустым и использовать имя из аккаунта."
                control={
                  <Input
                    aria-label="Account name"
                    value={name}
                    disabled={pending}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Автоматически после входа"
                  />
                }
              />
              <MultipleAccountsNote environmentId={environmentId} driver={CODEX_DRIVER_KIND} />
            </form>
          )}
        </WizardPanel>
        <WizardFooter>
          {instanceId ? (
            <Button variant="outline" onClick={onClose}>
              Finish later
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="add-codex-account"
                disabled={pending || !canManageProviders}
              >
                {pending ? "Adding account…" : "Continue"}
              </Button>
            </>
          )}
        </WizardFooter>
      </WizardPopup>
    </Dialog>
  );
}
