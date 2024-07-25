/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from "node:test";
import { deepStrictEqual, fail, ok } from "assert";
import { runBoard } from "../src/server/boards/utils/run-board.js";
import type { GraphDescriptor, Kit } from "@google-labs/breadboard";

import simpleBoard from "./boards/simple.bgl.json" with { type: "json" };
import multipleInputsBoard from "./boards/many-inputs.bgl.json" with { type: "json" };
import type { RunBoardResult } from "../src/server/types.js";

const mockSecretsKit: Kit = {
  url: import.meta.url,
  handlers: {
    secrets: async () => {
      throw new Error("Secrets aren't implemented in tests.");
    },
  },
};

const assertResult = (
  result: RunBoardResult,
  expected: {
    type: string;
    outputs?: Record<string, any>;
  }
) => {
  if ("$error" in result) {
    fail(result.$error);
  }
  ok(result.$state);
  const { type, outputs } = expected;
  deepStrictEqual(result.$state.type, type);
  if (result.$state.type === "input" || result.$state.type === "output") {
    deepStrictEqual(result.$state.next, "[]");
  }
  if (expected.outputs) {
    const { $state, ...expectedOutputs } = result;
    deepStrictEqual(outputs, expectedOutputs);
  }
};

describe("Board Server Runs Boards", () => {
  test("can start a simple board", async () => {
    const path = "/path/to/board";
    const result = await runBoard({
      path,
      url: `https://example.com${path}`,
      loader: async () => simpleBoard,
    });
    assertResult(result, { type: "input" });
  });

  test("can start a simple board with inputs", async () => {
    const path = "/path/to/board";
    const inputs = { text: "bar" };
    const result = await runBoard({
      path,
      url: `https://example.com${path}`,
      inputs,
      loader: async () => simpleBoard,
    });
    assertResult(result, {
      type: "output",
      outputs: {
        text: "bar",
      },
    });
  });

  test("can start multiple a board with multiple inputs", async () => {
    const path = "/path/to/board";
    const inputs = { text: "bar", number: 42 };
    const result = await runBoard({
      path,
      url: `https://example.com${path}`,
      inputs,
      loader: async () => multipleInputsBoard as GraphDescriptor,
    });
    assertResult(result, { type: "input" });
  });
});
