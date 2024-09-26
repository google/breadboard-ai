import { makeRunJavascriptComponent } from "./support.js";
import type { Inputs, Outputs } from "../str-is-foo.js";

/**
 * This function was generated by @breadboard-ai/build-code from
 * src/test/testdata/str-is-foo.ts
 */
export const strIsFoo = makeRunJavascriptComponent<Inputs, Outputs>({
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
`,
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
          },
        },
        required: ["foo"],
      },
    },
    required: ["deepObj", "numArr", "str"],
  },
  outputSchema: {
    type: "object",
    properties: { bool: { type: "boolean" }, opt: { type: "string" } },
    required: ["bool"],
  },
});
