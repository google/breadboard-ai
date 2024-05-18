/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";
import { EditHistoryManager } from "../../src/editor/history.js";
import { GraphDescriptor } from "@google-labs/breadboard-schema/graph.js";

test("EditHistoryManager correctly adds new items", (t) => {
  const mockGraph1 = {} as GraphDescriptor;
  const mockGraph2 = {} as GraphDescriptor;
  const history = new EditHistoryManager();
  t.assert(history.current() === null);
  history.add(mockGraph1);
  t.assert(history.current() === mockGraph1);
  t.assert(history.history.length === 1);
  history.add(mockGraph2);
  t.assert(history.current() === mockGraph2);
  t.assert(history.history.length === 2);
});

test("EditHistoryManager correctly goes back", (t) => {
  const mockGraph1 = {} as GraphDescriptor;
  const mockGraph2 = {} as GraphDescriptor;
  const mockGraph3 = {} as GraphDescriptor;
  const history = new EditHistoryManager();
  history.add(mockGraph1);
  history.add(mockGraph2);
  history.add(mockGraph3);
  t.assert(history.back() === mockGraph2);
  t.assert(history.back() === mockGraph1);
  t.assert(history.back() === mockGraph1);
});

test("EditHistoryManager correctly goes forth", (t) => {
  const mockGraph1 = {} as GraphDescriptor;
  const mockGraph2 = {} as GraphDescriptor;
  const mockGraph3 = {} as GraphDescriptor;
  const history = new EditHistoryManager();
  history.add(mockGraph1);
  history.add(mockGraph2);
  history.add(mockGraph3);
  t.assert(history.back() === mockGraph2);
  t.assert(history.back() === mockGraph1);
  t.assert(history.back() === mockGraph1);
  t.assert(history.forth() === mockGraph2);
  t.assert(history.forth() === mockGraph3);
  t.assert(history.forth() === mockGraph3);
});

test("EditHistoryManager correctly combines add, back, and forth", (t) => {
  const mockGraph1 = {} as GraphDescriptor;
  const mockGraph2 = {} as GraphDescriptor;
  const mockGraph3 = {} as GraphDescriptor;
  const mockGraph4 = {} as GraphDescriptor;
  const history = new EditHistoryManager();
  history.add(mockGraph1);
  history.add(mockGraph2);
  t.assert(history.back() === mockGraph1);
  history.add(mockGraph3);
  t.assert(history.current() === mockGraph3);
  t.assert(history.forth() === mockGraph3);
  t.assert(history.back() === mockGraph1);
  t.assert(history.forth() === mockGraph3);
  history.add(mockGraph4);
  t.assert(history.current() === mockGraph4);
  t.assert(history.back() === mockGraph3);
  t.assert(history.back() === mockGraph1);
});
