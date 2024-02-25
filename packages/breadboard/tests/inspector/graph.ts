/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test from "ava";

import { inspectableGraph } from "../../src/inspector/index.js";
import { GraphDescriptor } from "@google-labs/breadboard-schema/graph.js";

test("inspectableGraph correctly reacts to edits", (t) => {
  const graph: GraphDescriptor = {
    nodes: [{ id: "a", type: "foo" }],
    edges: [],
  };
  const inspectable = inspectableGraph(graph);
  t.deepEqual(
    inspectable.nodes().map((n) => n.descriptor.id),
    ["a"]
  );
  const editReceiver = inspectable.editReceiver();
  const edge = { from: "a", to: "b", out: "text", in: "text" };
  editReceiver.onEdit([
    { type: "addNode", node: { id: "b", type: "bar" } },
    { type: "addEdge", edge },
  ]);
  graph.nodes.push({ id: "b", type: "bar" });
  graph.edges.push(edge);

  t.deepEqual(
    inspectable.nodes().map((n) => n.descriptor.id),
    ["a", "b"]
  );
  t.is(inspectable.nodesByType("bar")?.[0], inspectable.nodeById("b")!);
  t.true(inspectable.hasEdge(edge));
  t.is(inspectable.incomingForNode("b")?.[0].from, inspectable.nodeById("a")!);

  editReceiver.onEdit([
    { type: "removeNode", id: "b" },
    { type: "removeEdge", edge },
  ]);
  graph.nodes = graph.nodes.filter((n) => n.id !== "b");
  graph.edges = graph.edges.filter((e) => e !== edge);

  t.deepEqual(
    inspectable.nodes().map((n) => n.descriptor.id),
    ["a"]
  );
  t.false(inspectable.hasEdge(edge));
});
