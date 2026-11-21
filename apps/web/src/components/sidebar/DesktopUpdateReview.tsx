import { useAtom } from "@effect/atom-react";
import { managedUpdatesDenial, type DesktopUpdateState } from "@t3tools/contracts";
import { useEffect, useState } from "react";
import { desktopUpdateReviewOpenAtom, useDesktopUpdateState } from "../../state/desktopUpdate";
import { usePrimaryManagedPolicy } from "../../state/managedPolicy";
import {
  getDesktopUpdateOfferedVersion,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { downloadLocalUpdate, installLocalUpdate } from "./SidebarUpdatePill";
import { SidebarUpdateReleaseNotes } from "./SidebarUpdateReleaseNotes";

export function DesktopUpdateReview() {
  const [open, setOpen] = useAtom(desktopUpdateReviewOpenAtom);
  const state = useDesktopUpdateState();
  const denial = managedUpdatesDenial(usePrimaryManagedPolicy());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listen for checks initiated from the native application menu
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction?.((action) => {
        if (action === "review-desktop-update") setOpen(true);
      }),
    [setOpen],
  );
  return state && open ? (
    <DesktopUpdateReviewDialog state={state} close={() => setOpen(false)} denial={denial} />
  ) : null;
}

function DesktopUpdateReviewDialog({
  state,
  close,
  denial,
}: {
  readonly state: DesktopUpdateState;
  readonly close: () => void;
  readonly denial: string | undefined;
}) {
  const [pending, setPending] = useState(false);
  const version = getDesktopUpdateOfferedVersion(state);
  const action = resolveDesktopUpdateButtonAction(state);
  const install = async () => {
    const bridge = window.desktopBridge;
    if (!bridge || !version || pending || denial || action === "none") return;
    setPending(true);
    try {
      if (
        action === "download" &&
        !(await downloadLocalUpdate(bridge, { notifyDownloaded: false, expectedVersion: version }))
      ) {
        return;
      }
      if (await installLocalUpdate(bridge, undefined, version)) close();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogPopup showCloseButton={!pending} className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{version ? `MT Code ${version}` : "Обновление MT Code"}</DialogTitle>
          <DialogDescription>
            {denial ??
              "Установка перезапустит приложение. Дождитесь завершения активных задач перед установкой."}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea scrollFade>
          <div className="px-6 pb-4">
            <SidebarUpdateReleaseNotes inline shell={window.desktopBridge} state={state} />
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={close}>
            Позже
          </Button>
          <Button
            disabled={pending || !!denial || action === "none"}
            onClick={() => void install()}
          >
            {pending
              ? state.status === "downloading" && state.downloadPercent !== null
                ? `Загрузка ${Math.floor(state.downloadPercent)}%`
                : "Установка…"
              : "Установить"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
