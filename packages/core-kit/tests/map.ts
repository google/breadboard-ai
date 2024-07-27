/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";

import map from "../src/nodes/map.js";
import { Capability, InputValues, Board } from "@google-labs/breadboard";
import TemplateKit from "@google-labs/template-kit";
import { Core } from "../src/index.js";
import { asRuntimeKit } from "@google-labs/breadboard";

test("map with no board just outputs list", async (t) => {
  const inputs = {
    list: [1, 2, 3],
  };
  const outputs = await map.invoke(inputs, {});
  t.deepEqual(outputs, { list: [1, 2, 3] });
});

test("map with board", async (t) => {
  const inputs = {
    list: [1, 2, 3],
    board: {
      kind: "board",
      board: {
        kits: [],
        edges: [],
        nodes: [],
        runOnce: async (inputs: InputValues) => {
          return inputs;
        },
      },
    },
  };
  const outputs = await map.invoke(inputs, {});
  t.deepEqual(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("using map as part of a board", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const map = core.map({
    board: {
      kind: "board",
      board: {
        kits: [],
        edges: [],
        nodes: [],
        runOnce: async (inputs: InputValues) => {
          return inputs;
        },
      },
    } as Capability, // TODO: Fix types.
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce({ list: [1, 2, 3] });
  t.deepEqual(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("sending a real board to a map", async (t) => {
  const fun = new Board();
  fun.input().wire("*->", fun.output());

  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const map = core.map({
    board: {
      kind: "board",
      board: fun,
    } as Capability, // TODO: Fix types.
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce({ list: [1, 2, 3] });
  t.like(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("using lambda syntactic sugar (JS)", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const map = core.map((board, input, output) => {
    input.wire("*->", output);
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce({ list: [1, 2, 3] });
  t.like(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("using lambda syntactic sugar (JS, with config)", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const map = core.map({
    board: (board, input, output) => {
      input.wire("*->", output);
    },
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce({ list: [1, 2, 3] });
  t.like(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("using lambda syntactic sugar (Node)", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const lambda = board.lambda((board, input, output) => {
    input.wire("*->", output);
  });
  const map = core.map(lambda);
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce({ list: [1, 2, 3] });
  t.like(outputs, {
    list: [
      { index: 0, item: 1, list: [1, 2, 3] },
      { index: 1, item: 2, list: [1, 2, 3] },
      { index: 2, item: 3, list: [1, 2, 3] },
    ],
  });
});

test("using lambda with promptTemplate", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const input = board.input();
  const map = core.map((board, input, output) => {
    const templates = board.addKit(TemplateKit);
    const template = templates.promptTemplate({
      template: "item: {{item}}",
    });
    input.wire("item->", template.wire("prompt->", output));
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const outputs = await board.runOnce(
    { list: [1, 2, 3] },
    {
      kits: [asRuntimeKit(TemplateKit)],
    }
  );
  t.deepEqual(outputs, {
    list: [{ prompt: "item: 1" }, { prompt: "item: 2" }, { prompt: "item: 3" }],
  });
});

test("using lambda with promptTemplate with input from outer board", async (t) => {
  const board = new Board();
  const core = board.addKit(Core);
  const templates = board.addKit(TemplateKit);

  const input = board.input();
  const label = core.passthrough({ label: "name" });
  const map = core.map((_, input, output) => {
    const template = templates
      .promptTemplate({
        template: "{{label}}: {{item}}",
      })
      .wire("label<-.", label);
    input.wire("item->", template.wire("prompt->", output));
  });
  input.wire("list->", map);
  map.wire("list->", board.output());
  const result = await board.runOnce({ list: [1, 2, 3] });
  t.deepEqual(result, {
    list: [{ prompt: "name: 1" }, { prompt: "name: 2" }, { prompt: "name: 3" }],
  });
});
