import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import "~/index.css";
import { render } from "../../../test/render";
import { QuickUsageLimits } from "./QuickUsageLimits";

it("closes the compact limits panel before opening all limits", async () => {
  const onOpenUsage = vi.fn(() => {
    expect(document.querySelector('[aria-label="Лимиты аккаунта"]')).toBeNull();
  });
  await using screen = await render(<QuickUsageLimits onOpenUsage={onOpenUsage} />);
  await screen.getByRole("button", { name: "Лимиты · Лимиты" }).click();
  await page.getByRole("button", { name: "Все лимиты" }).click();
  expect(onOpenUsage).toHaveBeenCalledOnce();
  await expect.element(page.getByRole("button", { name: "Все лимиты" })).not.toBeInTheDocument();
});
