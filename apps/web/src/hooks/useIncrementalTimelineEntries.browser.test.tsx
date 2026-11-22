import { expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import type { TimelineEntriesInput } from "../session-logic";
import { makeStreamingTimelineFixture } from "../test-fixtures";
import { isImageAttachment } from "../types";
import { useIncrementalTimelineEntries } from "./useIncrementalTimelineEntries";

const image = {
  type: "image",
  id: "image-1",
  name: "photo.png",
  mimeType: "image/png",
  sizeBytes: 42,
} as const;
const noRows: TimelineEntriesInput["visibleTurnItems"] = [];
const noOptimisticMessages: TimelineEntriesInput["optimisticMessages"] = [];
const history = makeStreamingTimelineFixture("Saved reply").visibleTurnItems.map((row) =>
  row.item.type === "assistant_message"
    ? { ...row, item: { ...row.item, attachments: [image] } }
    : row,
);

function Timeline({ draft, previewUrl }: { draft: boolean; previewUrl?: string }) {
  "use no memo"; // Reproduce the fresh attachment map returned on every render by ChatView.

  const entries = useIncrementalTimelineEntries(draft ? "draft" : "server", {
    visibleTurnItems: draft ? noRows : history,
    optimisticMessages: noOptimisticMessages,
    attachmentUrlById: new Map(previewUrl ? [[image.id, previewUrl]] : []),
  });
  const last = entries.at(-1);
  const attachment = last?.kind === "message" ? last.message.attachments?.[0] : undefined;
  return (
    <output
      data-testid="timeline"
      data-preview={attachment && isImageAttachment(attachment) ? attachment.previewUrl : undefined}
    >
      {last?.kind === "message" ? last.message.text : "Empty draft"}
    </output>
  );
}

it("renders a draft and server history when attachment maps are rebuilt on every render", async () => {
  await using screen = await render(<Timeline draft />, { router: false });
  const timeline = screen.getByTestId("timeline");
  await expect.element(timeline).toHaveTextContent("Empty draft");

  await screen.rerender(<Timeline draft={false} />);
  await expect.element(timeline).toHaveTextContent("Saved reply");

  await screen.rerender(<Timeline draft={false} previewUrl="blob:local-preview" />);
  await expect.element(timeline).toHaveAttribute("data-preview", "blob:local-preview");

  await screen.rerender(<Timeline draft={false} previewUrl="https://example.test/preview" />);
  await expect.element(timeline).toHaveAttribute("data-preview", "https://example.test/preview");

  await screen.rerender(<Timeline draft={false} />);
  await expect.element(timeline).not.toHaveAttribute("data-preview");
});
