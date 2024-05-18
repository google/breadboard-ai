/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphDescriptor } from "@google-labs/breadboard-schema/graph.js";
import { EditResult, EditSpec, EditableEdgeSpec } from "../types.js";
import { InspectableGraphWithStore } from "../../inspector/types.js";
import { fixUpStarEdge, fixupConstantEdge } from "../../inspector/edge.js";

export class AddEdge {
  #graph: GraphDescriptor;
  #inspector: InspectableGraphWithStore;

  constructor(graph: GraphDescriptor, inspector: InspectableGraphWithStore) {
    this.#graph = graph;
    this.#inspector = inspector;
  }

  async can(edge: EditableEdgeSpec): Promise<EditResult> {
    const inspector = this.#inspector;
    if (inspector.hasEdge(edge)) {
      return {
        success: false,
        error: `Edge from "${edge.from}:${edge.out}" to "${edge.to}:${edge.in}" already exists`,
      };
    }
    const from = inspector.nodeById(edge.from);
    if (!from) {
      return {
        success: false,
        error: `Node with id "${edge.from}" does not exist, but is required as the "from" part of the edge`,
      };
    }
    const to = inspector.nodeById(edge.to);
    if (!to) {
      return {
        success: false,
        error: `Node with id "${edge.to}" does not exist, but is required as the "to" part of the edge`,
      };
    }

    let error: string | null = null;
    if (edge.out === "*" && edge.in !== "*") {
      if (edge.in !== "") {
        edge = { ...edge, out: edge.in };
      }
      error = `A "*" output port cannot be connected to a named or control input port`;
    } else if (edge.out === "" && edge.in !== "") {
      error = `A control input port cannot be connected to a named or "*" output part`;
    } else if (edge.in === "*" && edge.out !== "*") {
      if (edge.out !== "") {
        edge = { ...edge, in: edge.out };
      }
      error = `A named input port cannot be connected to a "*" output port`;
    } else if (edge.in === "" && edge.out !== "") {
      error = `A named input port cannot be connected to a control output port`;
    }
    const fromPorts = (await from.ports()).outputs;
    if (fromPorts.fixed) {
      const found = fromPorts.ports.find((port) => port.name === edge.out);
      if (!found) {
        error ??= `Node with id "${edge.from}" does not have an output port named "${edge.out}"`;
        return {
          success: false,
          error,
        };
      }
    }
    const toPorts = (await to.ports()).inputs;
    if (toPorts.fixed) {
      const found = toPorts.ports.find((port) => port.name === edge.in);
      if (!found) {
        error ??= `Node with id "${edge.to}" does not have an input port named "${edge.in}"`;
        return {
          success: false,
          error,
        };
      }
    }
    if (error) {
      return { success: false, error, alternative: edge };
    }
    return { success: true };
  }

  async do(spec: EditSpec): Promise<EditResult> {
    if (spec.type !== "addedge") {
      throw new Error(
        `Editor API integrity error: expected type "addedge", received "${spec.type}" instead.`
      );
    }
    let edge = spec.edge;
    const strict = spec.strict;
    const can = await this.can(edge);
    if (!can.success) {
      if (!can.alternative || strict) {
        // this.#dispatchNoChange(can.error);
        return can;
      }
      if (can.alternative) {
        const canAlternative = await this.can(can.alternative);
        if (!canAlternative.success) {
          // this.#dispatchNoChange(canAlternative.error);
          return canAlternative;
        }
        edge = can.alternative;
      }
    }
    edge = fixUpStarEdge(edge);
    edge = fixupConstantEdge(edge);
    // TODO: Figure out how to make this work in multi-edit mode.
    this.#inspector.edgeStore.add(edge);
    this.#graph.edges.push(edge);
    return { success: true };
  }
}
