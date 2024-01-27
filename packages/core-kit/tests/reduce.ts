/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";

import reduce, {
  ReduceFunctionInputs,
  ReduceInputs,
} from "../src/nodes/reduce.js";
import Core, { core } from "../src/index.js";
import {
  Board,
  Capability,
  InputValues,
  asRuntimeKit,
  code,
  recipe,
} from "@google-labs/breadboard";

test("reduce with no board just outputs accumulator", async (t) => {
  const inputs = {
    list: [1, 2, 3],
    accumulator: 0,
  };
  const outputs = await reduce(inputs);
  t.deepEqual(outputs, { accumulator: 0 });
});

test("reduce with board", async (t) => {
  const inputs = {
    list: [1, 2, 3],
    board: {
      kind: "board",
      board: {
        kits: [],
        edges: [],
        nodes: [],
        runOnce: async (inputs: InputValues) => {
          const { accumulator, item } = inputs as ReduceFunctionInputs;
          return {
            accumulator:
              ((accumulator || 0) as number) + ((item || 0) as number),
          };
        },
      },
    },
    accumulator: 0,
  };
  const outputs = await reduce(inputs);
  t.deepEqual(outputs, {
    accumulator: 6,
  });
});

test("using reduce as part of a board", async (t) => {
  const reducer = await recipe(({ value }) => {
    const { accumulator } = core.reduce({
      list: [1, 2, 3],
      accumulator: value,
      board: code(({ accumulator, item }) => {
        const sum = ((accumulator || 0) as number) + ((item || 0) as number);
        return { accumulator: sum };
      }),
    });
    return { value: accumulator.isNumber() };
  }).serialize();
  const board = await Board.fromGraphDescriptor(reducer);
  const { value } = await board.runOnce(
    { value: 4 },
    { kits: [asRuntimeKit(Core)] }
  );
  t.is(value, 10);
});
