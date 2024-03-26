/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// TODO(aomarks) Switch import to schema package
import type {
  GraphDescriptor,
  NodeDescriptor,
  NodeValue,
} from "@google-labs/breadboard";
import type {
  BoardDefinition,
  BoardInputPorts,
  BoardOutputPorts,
} from "./board.js";
import type { GenericBreadboardNodeInstance } from "../common/instance.js";
import { isOutputPortReference, OutputPortGetter } from "../common/port.js";

/**
 * Serialize a Breadboard board to Breadboard Graph Language (BGL) so that it
 * can be executed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serialize(board_: BoardDefinition<any, any>): GraphDescriptor {
  // TODO(aomarks) Fix this weirdness. Something about the type system for
  // boards doesn't allow some supposedly legitimate paramterizations of
  // BoardDefinition to be passed to BoardDefinition<BoardInputPorts,
  // BoardInputPorts>, even though that should be the fully generic form.
  const board = board_ as BoardDefinition<BoardInputPorts, BoardOutputPorts>;
  const nodes = new Map<object, NodeDescriptor>();
  // Note this is a slightly stricter type than Edge from GraphDescriptor, since
  // ports can't be undefined, and that simplifies this implementation.
  const edges: { from: string; out: string; to: string; in: string }[] = [];
  const typeCounts = new Map<string, number>();

  const output = addNode({ type: "output", inputs: {}, outputs: {} });
  for (const [name, port] of Object.entries(board.outputs)) {
    addEdge(
      addNode(port[OutputPortGetter].node),
      port[OutputPortGetter].name,
      output,
      name
    );
  }

  // TODO(aomarks) We might actually want each input/output to be its own
  // input/output node, but then we should add the ability to create input
  // "sets" or something, for when you actually *do* need to gate until all
  // inputs/outputs are fulfilled.
  const input = addNode({ type: "input", inputs: {}, outputs: {} });
  const errors = [];
  for (const [name, port] of Object.entries(board.inputs)) {
    if (nodes.has(port.node)) {
      addEdge(input, name, addNode(port.node), port.name);
    } else {
      errors.push(
        `Board input "${name}" is not reachable from any of its outputs.`
      );
    }
  }

  if (errors.length > 0) {
    // TODO(aomarks) Refactor this to a Result<> return, because these errors are
    // expected as part of the normal course of operation.
    throw new Error(`Error serializing board:\n\n${errors.join("\n\n")}`);
  }

  return {
    // Sort the nodes and edges for deterministic BGL output.
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: edges.sort((a, b) => {
      if (a.from != b.from) {
        return a.from.localeCompare(b.from);
      }
      if (a.out != b.out) {
        return a.out.localeCompare(b.out);
      }
      if (a.to != b.to) {
        return a.to.localeCompare(b.to);
      }
      if (a.in != b.in) {
        return a.in.localeCompare(b.in);
      }
      return 0;
    }),
  };

  function addNode(node: GenericBreadboardNodeInstance): string {
    const descriptor = nodes.get(node);
    if (descriptor !== undefined) {
      return descriptor.id;
    }

    const { type } = node;
    const id = nextIdForType(type);
    const configuration: Record<string, NodeValue> = {};

    // Note we add this node -> descriptor mapping here because we have to do it
    // before the next call to addNode to prevent infinite recursion in case we
    // end up here again.
    nodes.set(node, { id, type, configuration });

    const configEntries: Array<[string, NodeValue]> = [];
    for (const [name, input] of Object.entries(node.inputs)) {
      if (isOutputPortReference(input.value)) {
        const port = input.value[OutputPortGetter];
        addEdge(addNode(port.node), port.name, id, name);
      } else {
        configEntries.push([name, input.value as NodeValue]);
      }
    }

    // Sort the configuration object for deterministic BGL output.
    configEntries.sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
    for (const [key, val] of Object.values(configEntries)) {
      configuration[key] = val;
    }

    return id;
  }

  function addEdge(from: string, fromPort: string, to: string, toPort: string) {
    edges.push({ from, out: fromPort, to, in: toPort });
  }

  function nextIdForType(type: string): string {
    const count = typeCounts.get(type) ?? 0;
    typeCounts.set(type, count + 1);
    return `${type}-${count}`;
  }
}
