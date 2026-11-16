import ts from "typescript-legacy";
import type { Plugin } from "vite-plus";

const attributes = new Set([
  "title",
  "description",
  "label",
  "placeholder",
  "aria-label",
  "alt",
  "tooltip",
  "heading",
  "emptyMessage",
  "helperText",
  "confirmLabel",
  "cancelLabel",
]);
const uiChildren = new Set([
  "Button",
  "SelectItem",
  "DropdownMenuItem",
  "MenuItem",
  "TooltipPopup",
  "DialogTitle",
  "AlertDialogTitle",
  "Badge",
  "SidebarMenuButton",
  "EmptyTitle",
  "Label",
]);
const human = (text: string) =>
  /[A-Za-z]{2}/.test(text) && text.length < 3000 && !/^(?:https?:|data:|[\w-]+:\/\/)/.test(text);
function jsxText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line, index, lines) => {
      let text = line.replaceAll("\t", " ");
      if (index > 0) text = text.trimStart();
      if (index < lines.length - 1) text = text.trimEnd();
      return text;
    })
    .filter(Boolean)
    .join(" ")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
        "&nbsp;": "\u00a0",
      };
      return (
        named[entity] ??
        String.fromCodePoint(
          entity[2]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(3, -1), 16)
            : Number(entity.slice(2, -1)),
        )
      );
    });
}

/** Marks static interface text, preserving identifiers, code blocks and existing GT translations. */
export function transformUi(code: string, file: string): { code: string; strings: string[] } {
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const changes: { start: number; end: number; text: string }[] = [];
  const strings = new Set<string>();
  const hooked = new Set<ts.FunctionLikeDeclaration>();
  function containsJsx(node: ts.Node): boolean {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
      return true;
    return ts.forEachChild(node, containsJsx) ?? false;
  }
  function component(node: ts.Node): ts.FunctionLikeDeclaration | null {
    for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
      if (
        !ts.isFunctionDeclaration(parent) &&
        !ts.isFunctionExpression(parent) &&
        !ts.isArrowFunction(parent)
      )
        continue;
      let name = parent.name && ts.isIdentifier(parent.name) ? parent.name.text : "";
      let owner: ts.Node = parent;
      if (
        ts.isCallExpression(owner.parent) &&
        /(?:^|\.)(?:memo|forwardRef)$/.test(owner.parent.expression.getText(tree))
      )
        owner = owner.parent;
      if (!name && ts.isVariableDeclaration(owner.parent) && ts.isIdentifier(owner.parent.name))
        name = owner.parent.name.text;
      if (/^[A-Z]|^use[A-Z]/.test(name) && parent.body) return parent;
    }
    return null;
  }
  function mark(node: ts.Node, text: string, expression: string) {
    if (!human(text)) return;
    strings.add(text);
    const owner = component(node);
    if (owner) hooked.add(owner);
    changes.push({
      start: ts.isJsxText(node) ? node.pos : node.getStart(tree),
      end: node.end,
      text: expression,
    });
  }
  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      ["T", "code", "pre", "script", "style", "svg"].includes(
        node.openingElement.tagName.getText(tree),
      )
    )
      return;
    if (ts.isJsxText(node)) {
      const text = jsxText(node.getText(tree));
      mark(node, text, `{_uiText(${JSON.stringify(text)})}`);
      return;
    }
    if (ts.isJsxAttribute(node) && node.initializer && attributes.has(node.name.getText(tree))) {
      if (ts.isStringLiteral(node.initializer)) {
        const text = node.initializer.text;
        mark(node.initializer, text, `{_uiText(${JSON.stringify(text)})}`);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const value = node.initializer.expression;
        if (containsJsx(value)) {
          ts.forEachChild(node.initializer, visit);
          return;
        }
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
          mark(value, value.text, `_uiText(${JSON.stringify(value.text)})`);
        else if (ts.isTemplateExpression(value)) {
          const text =
            value.head.text +
            value.templateSpans.map((part, index) => `{${index}}${part.literal.text}`).join("");
          mark(
            value,
            text,
            `_uiFormat(${JSON.stringify(text)}, [${value.templateSpans.map((part) => part.expression.getText(tree)).join(",")}])`,
          );
        } else {
          const owner = component(node);
          if (owner) hooked.add(owner);
          changes.push({
            start: value.getStart(tree),
            end: value.end,
            text: `_uiValue(${value.getText(tree)})`,
          });
        }
      }
      return;
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !containsJsx(node.expression) &&
      ts.isJsxElement(node.parent) &&
      uiChildren.has(node.parent.openingElement.tagName.getText(tree))
    ) {
      const value = node.expression;
      const owner = component(node);
      if (owner) hooked.add(owner);
      changes.push({
        start: value.getStart(tree),
        end: value.end,
        text: `_uiValue(${value.getText(tree)})`,
      });
      return;
    }
    if (ts.isJsxExpression(node) && node.expression) {
      const before = changes.length;
      const leaf = (value: ts.Expression): void => {
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
          mark(value, value.text, `_uiText(${JSON.stringify(value.text)})`);
        else if (ts.isConditionalExpression(value)) {
          leaf(value.whenTrue);
          leaf(value.whenFalse);
        }
      };
      leaf(node.expression);
      if (changes.length > before) return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!changes.length) return { code, strings: [] };
  for (const owner of hooked) {
    const body = owner.body!;
    if (ts.isBlock(body))
      changes.push({
        start: body.getStart(tree) + 1,
        end: body.getStart(tree) + 1,
        text: "\n_uiLocale();\n",
      });
    else {
      changes.push({
        start: body.getStart(tree),
        end: body.getStart(tree),
        text: "{ _uiLocale(); return (",
      });
      changes.push({ start: body.end, end: body.end, text: "); }" });
    }
  }
  changes.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const change of changes)
    code = code.slice(0, change.start) + change.text + code.slice(change.end);
  return {
    code: `import { uiText as _uiText, uiFormat as _uiFormat, uiValue as _uiValue, useUiLocale as _uiLocale } from "~/i18n/uiText";\n${code}`,
    strings: [...strings],
  };
}

export function uiLocalizationPlugin(): Plugin {
  return {
    name: "mtcode:ui-localization",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0]!.replaceAll("\\", "/");
      if (
        !file.includes("/apps/web/src/") ||
        !file.endsWith(".tsx") ||
        /\/i18n\/|\.test\.|\.browser\.|\/Icons\./.test(file)
      )
        return null;
      const result = transformUi(code, file);
      return result.code !== code ? { code: result.code, map: null } : null;
    },
  };
}
