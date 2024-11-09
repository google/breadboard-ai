/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  GraphDescriptor,
  ImperativeGraph,
  ModuleIdentifier,
} from "@breadboard-ai/types";

export { isImperativeGraph, toDeclarativeGraph, toImperativeGraph };

function isImperativeGraph(graph: unknown): graph is ImperativeGraph {
  return "main" in (graph as ImperativeGraph);
}
function toDeclarativeGraph(graph: ImperativeGraph): GraphDescriptor {
  const { main } = graph;
  const declarative = structuredClone(graph) as GraphDescriptor;
  declarative.nodes = [
    {
      id: "input",
      type: "input",
      metadata: {
        title: "Input",
      },
    },
    {
      id: "run-module",
      type: "runModule",
      configuration: {
        $module: main,
      },
      metadata: {
        title: `Run "${graph.title || '"main"'}" module`,
      },
    },
    {
      id: "output",
      type: "output",
      metadata: {
        title: "Output",
      },
    },
  ];
  declarative.edges = [
    {
      from: "input",
      to: "run-module",
      out: "*",
      in: "",
    },
    {
      from: "run-module",
      to: "output",
      out: "*",
      in: "",
    },
  ];
  return declarative;
}

function toImperativeGraph(
  main: ModuleIdentifier,
  graph: GraphDescriptor
): GraphDescriptor {
  const imperative = structuredClone(graph) as Partial<GraphDescriptor>;
  imperative.main = main;
  delete imperative.nodes;
  delete imperative.edges;
  delete imperative.graphs;
  return imperative as GraphDescriptor;
}
