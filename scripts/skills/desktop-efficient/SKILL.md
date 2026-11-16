---
name: desktop-efficient
description: Fast, text-first Windows and browser automation in MT Code through its native mt-desktop tools. Reduces round trips, avoids idle screen capture and supports real mouse fallback with result verification.
---

Default to the fast workflow: application APIs/CLI first, then targeted text/UIA or browser DOM tools. If the application is already known, reuse its identity instead of listing every window again. `get_app_state` accepts a narrow `query`; use `ocr: "never"` when accessibility labels are sufficient. Read only the relevant subtree or text segment.

Batch a short known sequence with `run_steps` only when each action has observed targets and later steps do not depend on unknown UI state. Stop on the first failure. For a state-dependent action use `return_state: true` and a narrow `state_query`, then use the newly returned IDs; earlier IDs are stale. The flag is a boolean. Avoid a redundant separate state request after a tool already returned it. Use `return_state: false` for independent steps whose result will be checked together once. Wait for observed UI readiness rather than inserting fixed multi-second sleeps.

Prefer native/background element actions. The Windows backend can fall back to real cursor input when an app ignores them; coordinates require a recent valid observation and correct window focus. Verify the result before dependent actions. Real mouse use must not click through an unrelated window. Do not claim Claude-level speed without a measured comparable task.

Use screenshots only for an actual visual need, and close/release live capture immediately after use, during coding and while waiting. Never hide Windows capture indicators. Browser text tools do not require a live desktop view. The activity effect should follow actual tool execution and disappear while idle. Preserve user drafts, accounts and VPN.
