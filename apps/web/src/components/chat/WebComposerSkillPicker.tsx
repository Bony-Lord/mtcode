import type { EnvironmentId, SkillInventoryInstallation } from "@t3tools/contracts";
import { fetchEnvironmentSkillInventory } from "@t3tools/client-runtime/state/skills";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";

import { runtime } from "~/lib/runtime";
import { usePreparedConnection } from "../../state/session";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export function WebComposerSkillPicker({
  environmentId,
  onClose,
  onAttach,
}: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
  readonly onAttach: (skill: SkillInventoryInstallation) => void;
}) {
  const prepared = usePreparedConnection(environmentId);
  const [skills, setSkills] = useState<ReadonlyArray<SkillInventoryInstallation> | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch the selected environment's inventory only while the dialog is mounted.
  useEffect(() => {
    if (Option.isNone(prepared)) return;
    const controller = new AbortController();
    void runtime
      .runPromise(fetchEnvironmentSkillInventory({ prepared: prepared.value }), {
        signal: controller.signal,
      })
      .then(
        (inventory) => setSkills(inventory.installations),
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      );
    return () => controller.abort();
  }, [prepared]);
  const filtered = new Map<string, SkillInventoryInstallation>();
  const needle = query.trim().toLowerCase();
  for (const skill of skills ?? []) {
    if (
      !skill.content.trim() ||
      !`${skill.name} ${skill.description ?? ""}`.toLowerCase().includes(needle)
    )
      continue;
    if (!filtered.has(skill.content)) filtered.set(skill.content, skill);
  }
  const visible = [...filtered.values()].toSorted((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Прикрепить навык</DialogTitle>
          <DialogDescription>
            Выбранный SKILL.md отправится в веб-чат вместе с сообщением. Файлы, на которые он
            ссылается, можно добавить отдельно.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Найти навык"
              placeholder="Найти навык"
            />
            {failed || Option.isNone(prepared) ? (
              <p role="status" className="text-sm text-muted-foreground">
                Не удалось загрузить навыки с этого компьютера.
              </p>
            ) : skills === null ? (
              <p role="status" className="text-sm text-muted-foreground">
                Загрузка навыков…
              </p>
            ) : visible.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                Навыки не найдены.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {visible.map((skill) => (
                  <li key={skill.skillFilePath + skill.providerInstanceId}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost-muted"
                      onClick={() => onAttach(skill)}
                    >
                      {skill.name}
                    </Button>
                    {skill.description ? (
                      <p className="line-clamp-2 px-2 pb-1 text-xs text-muted-foreground">
                        {skill.description}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
