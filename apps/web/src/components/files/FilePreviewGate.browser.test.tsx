import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";
import { FilePreviewGate } from "./FilePreviewGate";

vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: object) => unknown) =>
    select({ filePreviewOnDemand: true, filePreviewMaxActive: 1 }),
}));

it("keeps hidden and queued viewers unmounted until the user reveals them and a slot opens", async () => {
  const first = (
    <FilePreviewGate key="first">
      <p>First file contents</p>
    </FilePreviewGate>
  );
  const second = (
    <FilePreviewGate key="second">
      <p>Second file contents</p>
    </FilePreviewGate>
  );
  await using screen = await render(
    <>
      {first}
      {second}
    </>,
    { router: false },
  );
  await expect.element(screen.getByText("First file contents")).not.toBeInTheDocument();
  await expect.element(screen.getByText("Second file contents")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Показать предпросмотр" }).first().click();
  await expect.element(screen.getByText("First file contents")).toBeVisible();
  await screen.getByRole("button", { name: "Показать предпросмотр" }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Предпросмотр в очереди");
  await expect.element(screen.getByText("Second file contents")).not.toBeInTheDocument();
  await screen.rerender(
    <>
      <FilePreviewGate key="second">
        <p>Second file contents</p>
      </FilePreviewGate>
    </>,
  );
  await expect.element(screen.getByText("Second file contents")).toBeVisible();
});
