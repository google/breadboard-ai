/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from "node:test";
import {
  choicePickerFunction,
  chooseSchemaBuilderFunction,
  modeRouterFunction,
} from "../src/boards/human.js";
import { Context, LlmContentRole, SplitMarkerData } from "../src/context.js";
import { deepStrictEqual } from "node:assert";

const text = (text: string, role: LlmContentRole): Context => {
  return { parts: [{ text }], role };
};

const split = (type: SplitMarkerData["type"], id: string): Context => {
  return { role: "$metadata", type: "split", data: { id, type } };
};

const looper = (): Context => {
  return { role: "$metadata", type: "looper", data: {} };
};

describe("human/modeRouterFunction", () => {
  test("correctly recognizes the `input` mode when context is empty", () => {
    const context: Context[] = [];
    const wires = {};
    const result = modeRouterFunction({ context, wires });
    deepStrictEqual(result, { input: context });
  });
  test("correctly recognizes the `input` mode", () => {
    const context: Context[] = [text("Hello", "user")];
    const wires = {};
    const result = modeRouterFunction({ context, wires });
    deepStrictEqual(result, { input: context });
  });
  test("correctly recognizes the `input-output` mode", () => {
    const context: Context[] = [text("Hello", "model")];
    const wires = {};
    const result = modeRouterFunction({ context, wires });
    deepStrictEqual(result, { input: context, output: context });
  });
  test("correctly recognizes the `choose` mode", () => {
    {
      const context: Context[] = [looper()];
      const wires = {};
      const result = modeRouterFunction({ context, wires });
      deepStrictEqual(result, { input: context, output: context });
    }
    {
      const context: Context[] = [split("end", "1")];
      const wires = {};
      const result = modeRouterFunction({ context, wires });
      deepStrictEqual(result, { output: context, input: context });
    }
    {
      const context: Context[] = [
        split("start", "1"),
        split("next", "1"),
        split("end", "1"),
      ];
      const wires = { outgoing: ["foo"] };
      const result = modeRouterFunction({ context, wires });
      deepStrictEqual(result, { output: context, choose: context });
    }
    {
      const context: Context[] = [split("start", "1"), split("end", "1")];
      const wires = {};
      const result = modeRouterFunction({ context, wires });
      deepStrictEqual(result, { output: context, input: context });
    }
    {
      const context: Context[] = [
        split("start", "2"),
        split("next", "1"),
        split("end", "1"),
      ];
      const wires = {};
      const result = modeRouterFunction({ context, wires });
      deepStrictEqual(result, { output: context, input: context });
    }
  });
});

describe("human/chooseSchemaBuilderFunction", () => {
  test("correctly builds the schema for the `choose` mode", () => {
    const context: Context[] = [
      split("start", "2"),
      text("1", "tool"),
      split("next", "2"),
      text("2", "tool"),
      split("end", "1"),
    ];
    const title = "Choose";
    const description = "Choose some options";
    const result = chooseSchemaBuilderFunction({
      context,
      title,
      description,
    });
    deepStrictEqual(result, {
      schema: {
        type: "object",
        properties: {
          choice: {
            title,
            description,
            type: "string",
            enum: ["Choice 1", "Choice 2"],
          },
        },
      },
      total: 2,
    });
  });
});

describe("human/choicePickerFunction", () => {
  test("correctly picks the choice", () => {
    const context: Context[] = [
      text("0", "model"),
      split("start", "2"),
      text("1", "tool"),
      split("next", "2"),
      text("2", "tool"),
      text("2.5", "tool"),
      split("next", "2"),
      text("3", "tool"),
      split("end", "2"),
    ];
    const choice = "Choice 2";
    const total = 3;
    const result = choicePickerFunction({ context, choice, total });
    deepStrictEqual(result, {
      context: [text("0", "model"), text("2", "tool"), text("2.5", "tool")],
    });
  });
});
