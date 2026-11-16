import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { delegate, selectRoute } from "./economical-router.mjs";
NodeTest.test(
  "refuses paid, unknown, high-stakes routes and unbounded input before network access",
  async () => {
    for (const domain of ["medical", "credentials", "architecture"])
      NodeAssert.throws(() => selectRoute(domain));
    NodeAssert.throws(() => selectRoute("draft", "openai/paid"));
    await NodeAssert.rejects(
      delegate({ domain: "draft", input: "x".repeat(80_001) }, () => {
        throw Error("network must not run");
      }),
    );
  },
);
NodeTest.test(
  "a quota failure cannot trigger paid fallback; results require primary verification",
  async () => {
    let calls = 0;
    await NodeAssert.rejects(
      delegate({ domain: "extraction", input: "extract A" }, async () => {
        calls++;
        return { ok: false, status: 429 };
      }),
      /No paid fallback/,
    );
    NodeAssert.equal(calls, 1);
    const result = await delegate(
      { domain: "classification", input: "classify A" },
      async (_url, options) => {
        NodeAssert.equal(JSON.parse(options.body).model, "gpt-oss-20b");
        return { ok: true, json: async () => ({ choices: [{ message: { content: "A" } }] }) };
      },
    );
    NodeAssert.equal(result.verified, false);
    NodeAssert.equal(result.text, "A");
  },
);
