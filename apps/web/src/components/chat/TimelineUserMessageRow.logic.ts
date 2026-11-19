import { type ChatFileAttachment, type ChatImageAttachment } from "../../types";
import type { ComposerContextRecord, KnownComposerContextRecord } from "@t3tools/contracts";
import { asKnownContextRecord } from "~/lib/composerContextRecords";

/** Display the Codex clipboard image envelope using the existing local media viewer. */
export function importedCodexMessageMarkdown(text: string): string {
  let hasImage = false;
  const rendered = text.replace(
    /<image\s+name="([^"]*)"\s+path="([^"]+)"\s*>[\s\S]*?<\/image>/g,
    (source, name: string, path: string) => {
      const normalized = path.replaceAll("\\", "/");
      if (
        !/^(?:[A-Za-z]:\/|\/)/.test(normalized) ||
        /[<>\r\n]/.test(normalized) ||
        !/\.(?:png|jpe?g|webp|gif|avif|bmp)$/i.test(normalized)
      )
        return source;
      hasImage = true;
      const label = name.replace(/[[\]\\]/g, "") || "Изображение";
      return `\n\n![${label}](<${normalized}>)\n\n`;
    },
  );
  if (!hasImage) return text;
  return rendered
    .replace(/^\s*# Files mentioned by the user:[\s\S]*?^## My request:\s*/m, "")
    .trim();
}

export function userMessageFileLabel(file: Pick<ChatFileAttachment, "name" | "source">) {
  return file.source?._tag === "pasted-text" ? "Pasted text" : file.name;
}

export function resolvePreviewAnnotationImage(input: {
  record: Extract<KnownComposerContextRecord, { kind: "preview-annotation" }>;
  recordsById: ReadonlyMap<string, ComposerContextRecord>;
  userImages: ReadonlyArray<ChatImageAttachment>;
  previewImages: ReadonlyArray<ChatImageAttachment>;
  annotationRecordIds: ReadonlyArray<string>;
}): ChatImageAttachment | null {
  const screenshotRecord = input.record.screenshotContextId
    ? asKnownContextRecord(input.recordsById.get(input.record.screenshotContextId))
    : undefined;
  return (
    (screenshotRecord?.kind === "image"
      ? input.userImages.find((image) => image.id === screenshotRecord.attachmentId)
      : undefined) ??
    input.previewImages.find(
      (image) => image.name === `preview-annotation-${input.record.annotationId}.png`,
    ) ??
    input.previewImages[input.annotationRecordIds.indexOf(input.record.contextId)] ??
    null
  );
}
