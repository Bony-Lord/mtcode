import type { DesktopUpdateState } from "@t3tools/contracts";

import { getDesktopUpdateOfferedVersion } from "../desktopUpdate.logic";

export interface AboutUpdateIndicator {
  readonly kind: "app" | "providers";
  readonly label: string;
  readonly title: string;
}

/**
 * The About row shows both kinds of available update at a glance. Provider
 * candidates come from the same hook that powers the one-click update action,
 * so an indicator never advertises an update the button cannot run.
 */
export function getAboutUpdateIndicators({
  appState,
  providerUpdateCount,
  providerNames = [],
}: {
  readonly appState: DesktopUpdateState | null;
  readonly providerUpdateCount: number;
  readonly providerNames?: ReadonlyArray<string>;
}): readonly AboutUpdateIndicator[] {
  const indicators: AboutUpdateIndicator[] = [];

  const appVersion = appState ? getDesktopUpdateOfferedVersion(appState) : null;
  if (appVersion) {
    indicators.push({
      kind: "app",
      label: "Доступно обновление приложения",
      title: `Версия ${appVersion} доступна для установки`,
    });
  }

  if (providerUpdateCount > 0) {
    const names = providerNames.filter((name) => name.trim().length > 0);
    indicators.push({
      kind: "providers",
      label: `Доступны обновления провайдеров: ${providerUpdateCount}`,
      title:
        names.length > 0
          ? `Обновления доступны: ${names.join(", ")}`
          : "Обновления провайдеров доступны",
    });
  }

  return indicators;
}
