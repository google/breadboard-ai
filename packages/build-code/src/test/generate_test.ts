/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { board, input, serialize } from "@breadboard-ai/build";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Config } from "../config.js";
import { generate } from "../generate.js";

const testDataDir = join(
  import.meta.dirname,
  "..",
  "..",
  "src",
  "test",
  "testdata"
);

test("generates module", async () => {
  const fooPath = join(testDataDir, "str-is-foo.ts");
  const config: Config = {
    inputPaths: [fooPath],
    outputDir: join(testDataDir, "out"),
    tsconfigPath: join(testDataDir, "tsconfig.json"),
  };
  const actual = await generate(config, fooPath);
  const expected = await readFile(
    join(testDataDir, "generated", "str-is-foo.ts"),
    "utf8"
  );
  assert.equal(actual, expected);
});

test("serializes to BGL", async () => {
  const { strIsFoo } = await import("./testdata/generated/str-is-foo.js");
  const str = input();
  const fooInst = strIsFoo({
    str,
    numArr: [1, 2, 3],
    deepObj: { foo: { bar: "bar" } },
  });
  const myBoard = board({
    inputs: { str },
    outputs: { isFoo: fooInst.outputs.bool },
  });
  const actual = serialize(myBoard);
  const expected = {
    edges: [
      { from: "input-0", to: "runJavascript-0", out: "str", in: "str" },
      { from: "runJavascript-0", to: "output-0", out: "bool", in: "isFoo" },
    ],
    nodes: [
      {
        id: "input-0",
        type: "input",
        configuration: {
          schema: {
            type: "object",
            properties: { str: { type: "string" } },
            required: ["str"],
          },
        },
      },
      {
        id: "output-0",
        type: "output",
        configuration: {
          schema: {
            type: "object",
            properties: { isFoo: { type: "boolean" } },
            required: ["isFoo"],
          },
        },
      },
      {
        id: "runJavascript-0",
        type: "runJavascript",
        configuration: {
          raw: true,
          name: "run",
          code: `// src/test/testdata/util.ts
/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
function strIsFoo(str) {
  return str === "foo";
}

// src/test/testdata/str-is-foo.ts
/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
var run = ({ str }) => {
  return { bool: strIsFoo(str) };
};
export {
  run
};
`,
          numArr: [1, 2, 3],
          deepObj: { foo: { bar: "bar" } },
          inputSchema: {
            type: "object",
            properties: {
              str: { type: "string" },
              opt: { type: "string" },
              numArr: { type: "array", items: { type: "number" } },
              deepObj: {
                type: "object",
                properties: {
                  foo: {
                    type: "object",
                    properties: { bar: { type: "string" } },
                    required: ["bar"],
                    additionalProperties: false,
                  },
                },
                required: ["foo"],
                additionalProperties: false,
              },
            },
            required: ["str", "numArr", "deepObj"],
            additionalProperties: false,
          },
          outputSchema: {
            type: "object",
            properties: {
              bool: { type: "boolean" },
              opt: { type: "string" },
            },
            required: ["bool"],
            additionalProperties: false,
          },
        },
      },
    ],
  };
  assert.deepEqual(actual, expected);
});
