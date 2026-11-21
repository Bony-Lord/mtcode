import { useAtomValue } from "@effect/atom-react";
import {
  AuthProvidersManageScope,
  ProviderDriverKind,
  ProviderInstanceId,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";
import { providerUsageDisplaySource } from "@t3tools/shared/usageLimits";
import { useState } from "react";
import * as Hash from "effect/Hash";
import { useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { ProviderAccountSignIn } from "./ProviderAccountSignIn";

export function CodexUsageSignInDialog({
  environmentId,
  managed,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly managed: ServerProvider;
  readonly onClose: () => void;
}) {
  const instanceId = ProviderInstanceId.make(
    managed.instanceId.length <= 58
      ? "quota-" + managed.instanceId
      : "quota-" +
          managed.instanceId.slice(0, 48) +
          "-" +
          (Hash.string(managed.instanceId) >>> 0).toString(36),
  );
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const providers = config?.providers ?? [];
  const profile = providers.find((provider) => provider.instanceId === instanceId);
  const mutate = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const canManage = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [preparing, setPreparing] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState(false);
  const linked = profile && providerUsageDisplaySource(managed, [managed, profile]) === profile;
  const wrongEmail =
    profile?.auth.email &&
    managed.auth.email &&
    profile.auth.email.trim().toLowerCase() !== managed.auth.email.trim().toLowerCase();
  const prepare = async () => {
    setError(false);
    setPreparing(true);
    try {
      const result = await mutate({
        operation: "create",
        instanceId,
        instance: {
          driver: ProviderDriverKind.make("codex"),
          displayName: `${managed.displayName ?? "ChatGPT"} · лимиты Codex`,
          enabled: true,
          hidden: true,
          routingRole: "excluded",
          config: { setupMode: "existing", usageProfile: true },
        },
      });
      if (result._tag === "Success") setCreated(true);
      else setError(true);
    } finally {
      setPreparing(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Подключить лимиты Codex</DialogTitle>
          <DialogDescription>
            Войдите в тот же аккаунт, который используете для чатов
            {managed.auth.email ? ` (${managed.auth.email})` : ""}. Вход сохранится в отдельном
            профиле внутри MT Code.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-6 pb-4 text-sm">
          {linked ? (
            <p role="status">Лимиты подключены. MT Code получит их при следующей проверке.</p>
          ) : wrongEmail ? (
            <p role="status">Выбран другой аккаунт. Перевойдите с адресом, указанным выше.</p>
          ) : error ? (
            <p role="alert">
              Не удалось подготовить профиль Codex. Проверьте права доступа и повторите.
            </p>
          ) : created && !profile ? (
            <p role="status">Подготавливаем профиль Codex…</p>
          ) : profile?.auth.status === "authenticated" ? (
            <p role="status">
              Вход выполнен. Ожидаем данные о лимитах и проверяем рабочее пространство.
            </p>
          ) : null}
          {profile?.accountLogin && !linked && canManage ? (
            <ProviderAccountSignIn
              environmentId={environmentId}
              instanceId={instanceId}
              driver="codex"
              accountLogin={{ ...profile.accountLogin, modes: ["oauth", "deviceCode"] }}
              isAuthenticated={profile.auth.status === "authenticated"}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Закрыть
          </Button>
          {!profile && !created && canManage ? (
            <Button disabled={preparing} onClick={() => void prepare()}>
              Подготовить вход
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
