import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { InteractiveHtmlBlock } from "./InteractiveHtmlBlock";

it("starts an interactive widget only after opening it and isolates it from app data", async () => {
  const messages: unknown[] = [];
  const listener = (event: MessageEvent) => { if (event.data?.type === "mt-widget-test") messages.push(event.data); };
  window.addEventListener("message", listener);
  try {
    const code = `<button id="counter" onclick="this.textContent=Number(this.textContent)+1">1</button><script>document.getElementById('counter').click();let isolated=false;try{parent.document.body}catch(e){isolated=true}parent.postMessage({type:'mt-widget-test',count:document.getElementById('counter').textContent,isolated},'*')</script>`;
    await using screen = await render(<InteractiveHtmlBlock code={code} isStreaming={false}><pre>source</pre></InteractiveHtmlBlock>, { router: false });
    expect(screen.container.querySelector("iframe")).toBeNull();
    await screen.getByRole("button", { name: "Открыть", exact: true }).click();
    const frame = screen.container.querySelector("iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.srcdoc).toContain("connect-src 'none'");
    await expect.poll(() => messages).toEqual([{ type: "mt-widget-test", count: "2", isolated: true }]);
    await screen.getByRole("button", { name: "Остановить" }).click();
    expect(screen.container.querySelector("iframe")).toBeNull();
  } finally { window.removeEventListener("message", listener); }
});

it("does not run a widget while its response is still streaming", async () => {
  await using screen = await render(<InteractiveHtmlBlock code="<b>pending</b>" isStreaming><pre /></InteractiveHtmlBlock>, { router: false });
  await expect.element(screen.getByRole("button", { name: "Открыть", exact: true })).toBeDisabled();
  expect(screen.container.querySelector("iframe")).toBeNull();
});
