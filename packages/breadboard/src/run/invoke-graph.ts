/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { timestamp } from "../timestamp.js";
import type {
  GraphDescriptor,
  InputValues,
  NodeHandlerContext,
  OutputValues,
} from "../types.js";
import { runGraph } from "./run-graph.js";

export async function invokeGraph(
  graph: GraphDescriptor,
  inputs: InputValues,
  context: NodeHandlerContext = {}
): Promise<OutputValues> {
  const args = { ...inputs, ...graph.args };
  const { probe } = context;

  try {
    let outputs: OutputValues = {};

    const path = context.invocationPath || [];

    for await (const result of runGraph(graph, context)) {
      if (result.type === "input") {
        // Pass the inputs to the board. If there are inputs bound to the
        // board (e.g. from a lambda node that had incoming wires), they will
        // overwrite supplied inputs.
        result.inputs = args;
      } else if (result.type === "output") {
        outputs = result.outputs;
        // Exit once we receive the first output.
        await probe?.report?.({
          type: "nodeend",
          data: {
            node: result.node,
            inputs: result.inputs,
            outputs,
            path: [...path, result.invocationId],
            timestamp: timestamp(),
          },
        });
        await probe?.report?.({
          type: "graphend",
          data: { path, timestamp: timestamp() },
        });
        break;
      }
    }
    return outputs;
  } catch (e) {
    // Unwrap unhandled error (handled errors are just outputs of the board!)
    if ((e as Error).cause)
      return { $error: (e as Error).cause } as OutputValues;
    else throw e;
  }
}
