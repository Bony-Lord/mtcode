import { describe, expect, it } from "vite-plus/test";
import { transformUi } from "../../../scripts/lib/ui-i18n-transform";

describe("UI localization", () => {
  it("translates visible section names without changing conditional component props", () => {
    const { code, strings } = transformUi(
      `function SidebarSection({ dragging }) {
        return <Header tone={dragging ? "accent" : "muted"} hidden={false}>
          {dragging ? "Dragging" : "Working"}
        </Header>;
      }`,
      "SidebarSection.tsx",
    );
    expect(code).toContain('tone={dragging ? "accent" : "muted"}');
    expect(code).toContain('_uiText("Working")');
    expect(strings).toEqual(["Dragging", "Working"]);
  });
});
