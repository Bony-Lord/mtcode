---
name: mt-code-output
description: Present results in MT Code chat as compact tables, diagrams, interactive offline charts or calculators, media, or downloadable files. Use when choosing an output format or presenting work beyond plain text.
---

Choose the smallest format that serves the task. Keep the result and its interpretation readable as text, including for clients that only display the fallback.

- Use a Markdown table for small lookup data. Use a Mermaid fence for a small process, dependency graph, or sequence diagram.
- For data the user wants to filter, a chart with changing assumptions, a calculator, a quiz, or a scoped prototype, write one standalone HTML document with inline CSS and JavaScript. Use the T3 tool search for `html_preview` and `html_render`. Preview the document, inspect console errors, and pass the measured height to the renderer. When the user's profile asks for an `mt-html` fence, output the complete document in that fence. A local HTML file with a `::visualize` reference is another fallback on web and desktop.
- Use local PNG, audio, or video files for media, with absolute paths and Markdown image syntax. Use an attachment or an absolute Markdown file link for a CSV, spreadsheet, document, slide deck, or other downloadable deliverable. Use the actual file format requested.
- MCP Apps can render a connected tool's own interface when the tool advertises it. For a locally constructed chart or widget, use the HTML renderer.

Put units, axis labels, and data sources in the visual. Make the controls keyboard usable and fit a narrow panel. Keep input data inside the artifact. The preview is sandboxed. Use inline assets and avoid network requests, external libraries, credentials, and machine paths inside the HTML. If a deliverable needs authenticated data or persistence, use the applicable app or workspace tool with its normal permissions.

Use the surrounding chat's visual density and hierarchy. Start with the result, then show only the labels and controls the user needs. Prefer one accent color, readable contrast in light and dark themes, and layouts that fit a phone without horizontal scrolling. Give interactive controls useful defaults. Show values and units in the chart itself or in adjacent text. Add filters and sliders when they answer a real question. Avoid motion that is unrelated to the user's task.

Before handing back an interactive result, try the default state, a changed input, and reset if present. Check keyboard focus and narrow width. Keep a short text fallback with the result so the answer is usable before the widget is opened. A web-only assistant can return the complete fenced HTML and say which checks it could perform. MT Code renders the widget after receipt.
