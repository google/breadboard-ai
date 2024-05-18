/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";
import { testEditGraph } from "./graph.js";

test("Multi-edit returns a last failed edit's error message", async (t) => {
  const graph = testEditGraph();
  const result = await graph.edit(
    [{ type: "addnode", node: { id: "node0", type: "foo" } }],
    true
  );

  if (result.success) {
    t.fail();
    return;
  }
  t.true(result.log.length === 1);
  const singleEdit = result.log[0].result;
  if (singleEdit.success) {
    t.fail();
    return;
  }
  t.assert(result.error === singleEdit.error);
});

test("Multi-edit can do multiple successful edits", async (t) => {
  {
    const graph = testEditGraph();
    const result = await graph.edit([
      { type: "addnode", node: { id: "node-1", type: "foo" } },
      { type: "addnode", node: { id: "node-2", type: "foo" } },
      { type: "addnode", node: { id: "node-3", type: "foo" } },
    ]);
    t.true(result.success);
    const inspector = graph.inspect();
    t.assert(inspector.nodeById("node-1"));
    t.assert(inspector.nodeById("node-2"));
    t.assert(inspector.nodeById("node-3"));
  }
  {
    const graph = testEditGraph();
    const result = await graph.edit(
      [
        { type: "addnode", node: { id: "node-1", type: "foo" } },
        { type: "addnode", node: { id: "node-2", type: "foo" } },
        { type: "addnode", node: { id: "node-3", type: "foo" } },
      ],
      true
    );
    t.true(result.success);
    const inspector = graph.inspect();
    t.assert(!inspector.nodeById("node-1"));
    t.assert(!inspector.nodeById("node-2"));
    t.assert(!inspector.nodeById("node-3"));
  }
});

test("Multi-edit gracefully fails", async (t) => {
  {
    const graph = testEditGraph();
    const result = await graph.edit([
      { type: "addnode", node: { id: "node-1", type: "foo" } },
      { type: "addnode", node: { id: "node0", type: "foo" } },
      { type: "addnode", node: { id: "node-3", type: "foo" } },
    ]);
    if (result.success) {
      t.fail();
      return;
    }
    const failedEdit = result.log[1];
    t.is(failedEdit.edit, "addnode");
    if (failedEdit.result.success) {
      t.fail();
      return;
    }
    const inspector = graph.inspect();
    t.assert(!inspector.nodeById("node-1"));
    t.assert(!inspector.nodeById("node-3"));
  }
});
