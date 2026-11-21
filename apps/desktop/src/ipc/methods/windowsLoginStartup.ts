import * as HostProcess from "@t3tools/shared/HostProcess";
import { app } from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const windowsLoginStartup = makeIpcMethod({
  channel: IpcChannels.WINDOWS_LOGIN_STARTUP_CHANNEL,
  payload: Schema.UndefinedOr(Schema.Boolean),
  result: Schema.NullOr(Schema.Boolean),
  handler: Effect.fn("desktop.ipc.windowsLoginStartup")(function* (enabled) {
    if ((yield* HostProcess.Platform) !== "win32" || !app.isPackaged) return null;
    const path = yield* HostProcess.ExecutablePath;
    return yield* Effect.sync(() => {
      const launch = { path, args: [] };
      if (enabled !== undefined) {
        app.setLoginItemSettings({ ...launch, openAtLogin: enabled, enabled });
      }
      return app.getLoginItemSettings(launch).executableWillLaunchAtLogin;
    });
  }),
});
