/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from "node:test";
import { loadRuntime, NodeModuleManager } from "../src/node.js";
import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert";
import { Capabilities } from "../src/capabilities.js";

Capabilities.instance().install([["fetch", async (inputs) => inputs]]);

async function run(
  code: string,
  inputs: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const wasm = await loadRuntime();
  const manager = new NodeModuleManager(wasm);
  return manager.invoke({ test: code }, "test", inputs);
}

describe("runtime basics", () => {
  test("can run a simple module", async () => {
    deepStrictEqual(
      await run(
        `export default function() {
        return { result: "HELLO" }
      }`
      ),
      { result: "HELLO" }
    );
  });

  test("can accept arguments", async () => {
    deepStrictEqual(
      await run(
        `export default function({test}) {
        return { result: test }
      }`,
        { test: "HELLO" }
      ),
      { result: "HELLO" }
    );
  });

  test("supports async export", async () => {
    deepStrictEqual(
      await run(
        `export default async function({test}) {
        return new Promise((resolve) => resolve({ result: test }));
      }`,
        { test: "HELLO" }
      ),
      { result: "HELLO" }
    );
  });
});

describe("runtime errors", () => {
  test("handles invalid module", async () => {
    await rejects(run("export"), /invalid export syntax/);

    await rejects(
      run("FOO"),
      /Error converting from js 'undefined' into type 'function'/
    );
  });

  test("handles errors thrown", async () => {
    await rejects(
      run(
        `export default function() {
        throw new Error("OH NOES");
      }`
      ),
      /OH NOES/
    );
  });

  test("handles errors thrown in async functions", async () => {
    await rejects(
      run(
        `export default async function() {
        throw new Error("OH NOES");
      }`
      ),
      /OH NOES/
    );
  });

  test("handles syntax errors", async () => {
    await rejects(
      run(
        `export default async function() {
        foo += 1;
      }`
      ),
      /'foo' is not defined/
    );
  });
});

describe("can import capabilities", () => {
  test("can import breadboard:capabilities module", async () => {
    const result = await run(`import "breadboard:capabilities";
    export default function() {
      return { success: true }
    }`);
    ok(true);
  });

  test("can import fetch from breadboard:capabilities", async () => {
    const result = await run(`import { fetch } from "breadboard:capabilities";
    export default function() {
      return { fetch: typeof fetch }
    }
      `);
    deepStrictEqual(result, { fetch: "function" });
  });

  test("can call fetch from breadboard:capabilities", async () => {
    const result = await run(`import { fetch } from "breadboard:capabilities";
    export default async function() {
      return { result: await fetch({ test: "HELLO" }) }
    }
      `);
    deepStrictEqual(result, { result: { test: "HELLO" } });
  });

  test("gracefully handles unknown capability", async () => {
    await rejects(() =>
      run(`import { foo } from "breadboard:capabilities";
    export default async function() {
      return { result: await foo({ test: "HELLO" }) }
    }
      `)
    );
  });
});
