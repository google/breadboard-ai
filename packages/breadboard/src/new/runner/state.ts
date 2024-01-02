/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AbstractNode,
  InputValues,
  EdgeInterface,
  StateInterface,
  NodeValue,
} from "./types.js";

export class State implements StateInterface {
  queue: AbstractNode[] = [];
  inputs: Map<AbstractNode, Map<string, NodeValue[]>> = new Map();
  constants: Map<AbstractNode, Partial<InputValues>> = new Map();
  controlWires: Map<AbstractNode, AbstractNode[]> = new Map();
  haveRun: Set<AbstractNode> = new Set();

  distributeResults(edge: EdgeInterface, inputs: InputValues) {
    const data =
      edge.out === "*"
        ? inputs
        : edge.out === ""
        ? {}
        : inputs[edge.out] !== undefined
        ? { [edge.in]: inputs[edge.out] }
        : {};

    // Update constants; pverwrite current values if present
    if (edge.constant)
      this.constants.set(edge.to, { ...this.constants.get(edge.to), ...data });

    // Regular inputs: Add to the input queues
    if (!this.inputs.has(edge.to)) this.inputs.set(edge.to, new Map());
    const queues = this.inputs.get(edge.to);
    for (const port of Object.keys(data)) {
      if (!queues?.has(port)) queues?.set(port, []);
      queues?.get(port)?.push(data[port]);
    }

    if (edge.in === "")
      this.controlWires.set(edge.to, [
        ...(this.controlWires.get(edge.to) ?? []),
        edge.from,
      ]);

    // return which wires were used
    return Object.keys(data);
  }

  /**
   * Compute required inputs from edges and compare with present inputs
   *
   * Required inputs are
   *  - for all named incoming edges, the presence of any data, irrespective of
   *    which node they come from
   *  - at least one of the incoming empty or * wires, if present (TODO: Is that
   *    correct?)
   *  - data from at least one node if it already ran
   *
   * @returns false if none are missing, otherwise string[] of missing inputs.
   * NOTE: A node with no incoming wires returns an empty array after  first
   * run.
   */
  missingInputs(node: AbstractNode): string[] | false {
    if (node.incoming.length === 0 && this.haveRun.has(node)) return [];

    const requiredKeys = new Set(node.incoming.map((edge) => edge.in));

    const presentKeys = new Set([
      ...Object.keys(node.configuration),
      ...Object.keys(this.constants.get(node) ?? {}),
    ]);
    for (const [port, values] of (this.inputs.get(node) ?? new Map()).entries())
      if (values.length) presentKeys.add(port);
    if (this.controlWires.get(node)?.length) presentKeys.add("");

    const missingInputs = [...requiredKeys].filter(
      (key) => !presentKeys.has(key)
    );
    return missingInputs.length ? missingInputs : false;
  }

  shiftInputs<I extends InputValues>(node: AbstractNode<I>): I {
    const inputs = { ...node.configuration, ...this.constants.get(node) } as I;

    // Shift inputs from queues
    const queues = this.inputs.get(node) ?? new Map();
    for (const [port, values] of queues.entries())
      if (values.length > 0) inputs[port as keyof I] = values.shift();

    // Mark as run, reset control wires
    this.haveRun.add(node);
    this.controlWires.delete(node);

    return inputs;
  }

  reset() {
    this.queue = [];
    this.inputs = new Map();
    this.constants = new Map();
    this.controlWires = new Map();
    this.haveRun = new Set();
  }
}
