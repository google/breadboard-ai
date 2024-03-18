/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineNodeType } from "@breadboard-ai/build";
import { test } from "node:test";

test("polymorphic inputs", () => {
  // $ExpectType NodeDefinition<{ in1: { type: "string"; }; "*": { type: "number"; }; }, { out1: { type: "string"; }; }>
  const definition = defineNodeType(
    {
      in1: {
        type: "string",
      },
      "*": {
        type: "number",
      },
    },
    {
      out1: {
        type: "string",
      },
    },

    (
      // $ExpectType StaticInvokeParams<{ in1: { type: "string"; }; "*": { type: "number"; }; }>
      params,
      // $ExpectType DynamicInvokeParams<{ in1: { type: "string"; }; "*": { type: "number"; }; }>
      dynamic
    ) => {
      // $ExpectType string
      params.in1;
      // @ts-expect-error in2 is dynamic
      params.in2;
      // @ts-expect-error Not a real port
      params["*"];
      // $ExpectType never
      dynamic.in1;
      // $ExpectType number | undefined
      dynamic.in2;
      // $ExpectType never
      dynamic["*"];
      return {
        out1: "foo",
      };
    }
  );
  // @ts-expect-error missing required parameter
  definition({});
  definition({ in1: "foo" });
  definition({ in1: "foo", in2: 123 });
  definition({
    in1: "foo",
    // @ts-expect-error expected number, got string
    in2: "123",
  });
  definition({
    in1: "foo",
    // @ts-expect-error expected number, got null
    in2: null,
  });
  const instance = definition({ in1: "foo", in2: 123 });
  // @ts-expect-error Wildcard port isn't real
  instance.inputs["*"];
  // $ExpectType InputPort<{ type: "string"; }>
  instance.inputs.in1;
  // $ExpectType InputPort<{ type: number; }>
  instance.inputs.in2;
  // @ts-expect-error No such port
  instance.inputs.in3;

  const definition2 = defineNodeType(
    {},
    {
      strOut: {
        type: "string",
      },
      numOut: {
        type: "number",
      },
    },
    () => {
      return {
        strOut: "foo",
        numOut: 123,
      };
    }
  );
  const instance2 = definition2({});
  definition({ in1: "foo", in2: instance2.outputs.numOut });
  // @ts-expect-error expected number, got string
  definition({ in1: "foo", in2: instance2.outputs.strOut });
  // @ts-expect-error expected number, got instance
  definition({ in1: "foo", in2: instance2 });
});
