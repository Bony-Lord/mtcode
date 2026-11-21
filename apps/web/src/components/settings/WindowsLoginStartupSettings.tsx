import { useEffect, useState } from "react";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";

const label = "Запускать MT Code при входе в Windows";

export function WindowsLoginStartupSettings() {
  const startup = window.desktopBridge?.windowsLoginStartup;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- read the current Windows startup registration
  useEffect(() => {
    let active = true;
    void startup?.()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [startup]);

  if (enabled === null || !startup) return null;
  return (
    <SettingsSection title="Запуск приложения">
      <SettingsRow
        title={label}
        control={
          <Switch
            aria-label={label}
            checked={enabled}
            disabled={pending}
            onCheckedChange={(next) => {
              setPending(true);
              void startup(next)
                .then((value) => {
                  setEnabled(value);
                  if (value !== next) throw new Error("Параметр автозагрузки не изменился.");
                })
                .catch(() =>
                  toastManager.add({
                    type: "error",
                    title: "Не удалось изменить автозагрузку Windows",
                  }),
                )
                .finally(() => setPending(false));
            }}
          />
        }
      />
    </SettingsSection>
  );
}
