/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GraphMetadata,
  NodeMetadata,
} from "@google-labs/breadboard-schema/graph.js";
import { fixUpStarEdge } from "../inspector/edge.js";
import { inspectableGraph } from "../inspector/graph.js";
import { InspectableGraphWithStore } from "../inspector/types.js";
import {
  GraphDescriptor,
  GraphIdentifier,
  NodeConfiguration,
  NodeIdentifier,
} from "../types.js";
import {
  EdgeEditResult,
  SingleEditResult,
  EditableEdgeSpec,
  EditableGraph,
  EditableGraphOptions,
  RejectionReason,
  EditSpec,
  EditResult,
} from "./types.js";
import { ChangeEvent, ChangeRejectEvent } from "./events.js";
import { AddEdge } from "./operations/add-edge.js";
import { AddNode } from "./operations/add-node.js";
import { RemoveNode } from "./operations/remove-node.js";
import { edgesEqual, findEdgeIndex } from "./edge.js";
import { RemoveEdge } from "./operations/remove-edge.js";

export class Graph implements EditableGraph {
  #version = 0;
  #options: EditableGraphOptions;
  #inspector: InspectableGraphWithStore;
  #graph: GraphDescriptor;
  #parent: Graph | null;
  #graphs: Record<GraphIdentifier, Graph> | null;
  #eventTarget: EventTarget = new EventTarget();

  constructor(
    graph: GraphDescriptor,
    options: EditableGraphOptions,
    parent: Graph | null
  ) {
    this.#graph = graph;
    this.#parent = parent || null;
    if (parent) {
      // Embedded subgraphs can not have subgraphs.
      this.#graphs = null;
    } else {
      this.#graphs = Object.fromEntries(
        Object.entries(graph.graphs || {}).map(([id, graph]) => [
          id,
          new Graph(graph, options, this),
        ])
      );
    }
    this.#options = options;
    this.#version = parent ? 0 : options.version || 0;
    this.#inspector = inspectableGraph(this.#graph, options);
  }

  #makeIndependent() {
    this.#parent = null;
    this.#graphs = {};
  }

  #updateGraph(visualOnly: boolean) {
    if (this.#parent) {
      this.#graph = { ...this.#graph };
      // Update parent version.
      this.#parent.#updateGraph(visualOnly);
    } else {
      if (!this.#graphs) {
        throw new Error(
          "Integrity error: a supergraph with no ability to add subgraphs"
        );
      }
      const entries = Object.entries(this.#graphs);
      if (entries.length === 0) {
        if ("graphs" in this.#graph) delete this.#graph["graphs"];
        this.#graph = { ...this.#graph };
      } else {
        const graphs = Object.fromEntries(
          entries.map(([id, graph]) => [id, graph.raw()])
        );
        this.#graph = { ...this.#graph, graphs };
      }
      this.#version++;
    }
    this.#inspector.updateGraph(this.#graph);
    this.#eventTarget.dispatchEvent(
      new ChangeEvent(this.#graph, this.#version, visualOnly)
    );
  }

  #dispatchNoChange(error?: string) {
    if (this.#parent) {
      this.#parent.#dispatchNoChange(error);
    }
    this.#graph = { ...this.#graph };
    const reason: RejectionReason = error
      ? {
          type: "error",
          error,
        }
      : {
          type: "nochange",
        };
    this.#eventTarget.dispatchEvent(new ChangeRejectEvent(this.#graph, reason));
  }

  addEventListener(eventName: string, listener: EventListener): void {
    this.#eventTarget.addEventListener(eventName, listener);
  }

  version() {
    if (this.#parent) {
      throw new Error("Embedded subgraphs can not be versioned.");
    }
    return this.#version;
  }

  parent() {
    return this.#parent;
  }

  async edit(edits: EditSpec[], dryRun = false): Promise<EditResult> {
    if (edits.length > 1) {
      throw new Error("Multi-edit is not yet implemented");
    }
    if (dryRun) {
      return this.#canEdit(edits);
    }
    const edit = edits[0];
    switch (edit.type) {
      case "addnode":
        return this.#addNode(edit);
      case "removenode":
        return this.#removeNode(edit);
      case "addedge":
        return this.#addEdge(edit);
      case "removeedge":
        return this.#removeEdge(edit);
      case "changeedge":
        return this.#changeEdge(edit.from, edit.to);
      case "changeconfiguration": {
        if (!edit.configuration) {
          return {
            success: false,
            error: "Configuration wasn't supplied.",
          };
        }
        return this.#changeConfiguration(edit.id, edit.configuration);
      }
      case "changemetadata": {
        if (!edit.metadata) {
          return {
            success: false,
            error: "Metadata wasn't supplied.",
          };
        }
        return this.#changeMetadata(edit.id, edit.metadata);
      }
      case "changegraphmetadata":
        return this.#changeGraphMetadata(edit.metadata);
      default: {
        return {
          success: false,
          error: "Unsupported edit type",
        };
      }
    }
  }

  async #canEdit(edits: EditSpec[]): Promise<EdgeEditResult> {
    if (edits.length > 1) {
      throw new Error("Multi-edit is not yet implemented");
    }
    const edit = edits[0];
    switch (edit.type) {
      case "addnode": {
        const operation = new AddNode(this.#graph, this.#inspector);
        return operation.can(edit.node);
      }
      case "removenode": {
        const operation = new RemoveNode(this.#graph, this.#inspector);
        return operation.can(edit.id);
      }
      case "addedge": {
        const operation = new AddEdge(this.#graph, this.#inspector);
        return operation.can(edit.edge);
      }
      case "removeedge": {
        const operation = new RemoveEdge(this.#graph, this.#inspector);
        return operation.can(edit.edge);
      }
      case "changeconfiguration":
        return this.#canChangeConfiguration(edit.id);
      case "changemetadata":
        return this.#canChangeMetadata(edit.id);
      case "changeedge":
        return this.#canChangeEdge(edit.from, edit.to);
      case "changegraphmetadata":
        return { success: true };
      default: {
        return {
          success: false,
          error: "Unsupported edit type",
        };
      }
    }
  }

  async #addNode(spec: EditSpec): Promise<SingleEditResult> {
    const operation = new AddNode(this.#graph, this.#inspector);
    const can = await operation.do(spec);
    if (!can.success) {
      this.#dispatchNoChange(can.error);
      return can;
    }
    this.#updateGraph(false);
    return can;
  }

  async #removeNode(spec: EditSpec): Promise<SingleEditResult> {
    const operation = new RemoveNode(this.#graph, this.#inspector);
    const can = await operation.do(spec);
    if (!can.success) {
      this.#dispatchNoChange(can.error);
      return can;
    }

    this.#updateGraph(false);
    return can;
  }

  async #addEdge(spec: EditSpec): Promise<EdgeEditResult> {
    const operation = new AddEdge(this.#graph, this.#inspector);
    const can = await operation.do(spec);
    if (!can.success) {
      this.#dispatchNoChange(can.error);
      return can;
    }
    this.#updateGraph(false);
    return can;
  }
  async #removeEdge(spec: EditSpec): Promise<SingleEditResult> {
    const operation = new RemoveEdge(this.#graph, this.#inspector);
    const can = await operation.do(spec);
    if (!can.success) {
      this.#dispatchNoChange(can.error);
      return can;
    }
    this.#updateGraph(false);
    return can;
  }

  async #canChangeEdge(
    from: EditableEdgeSpec,
    to: EditableEdgeSpec
  ): Promise<EdgeEditResult> {
    if (edgesEqual(from, to)) {
      return { success: true };
    }
    const canRemoveOp = new RemoveEdge(this.#graph, this.#inspector);
    const canRemove = await canRemoveOp.can(from);
    if (!canRemove.success) return canRemove;
    const canAddOp = new AddEdge(this.#graph, this.#inspector);
    const canAdd = await canAddOp.can(to);
    if (!canAdd.success) return canAdd;
    return { success: true };
  }

  async #changeEdge(
    from: EditableEdgeSpec,
    to: EditableEdgeSpec,
    strict: boolean = false
  ): Promise<SingleEditResult> {
    const can = await this.#canChangeEdge(from, to);
    let alternativeChosen = false;
    if (!can.success) {
      if (!can.alternative || strict) {
        this.#dispatchNoChange(can.error);
        return can;
      }
      to = can.alternative;
      alternativeChosen = true;
    }
    if (edgesEqual(from, to)) {
      if (alternativeChosen) {
        const error = `Edge from ${from.from}:${from.out}" to "${to.to}:${to.in}" already exists`;
        this.#dispatchNoChange(error);
        return {
          success: false,
          error,
        };
      }
      this.#dispatchNoChange();
      return { success: true };
    }
    const spec = fixUpStarEdge(from);
    const edges = this.#graph.edges;
    const index = findEdgeIndex(this.#graph, spec);
    const edge = edges[index];
    edge.from = to.from;
    edge.out = to.out;
    edge.to = to.to;
    edge.in = to.in;
    if (to.constant === true) {
      edge.constant = to.constant;
    }
    this.#updateGraph(false);
    return { success: true };
  }

  async #canChangeConfiguration(id: NodeIdentifier): Promise<SingleEditResult> {
    const node = this.#inspector.nodeById(id);
    if (!node) {
      return {
        success: false,
        error: `Unable to update configuration: node with id "${id}" does not exist`,
      };
    }
    return { success: true };
  }

  async #changeConfiguration(
    id: NodeIdentifier,
    configuration: NodeConfiguration
  ): Promise<SingleEditResult> {
    const can = await this.#canChangeConfiguration(id);
    if (!can.success) {
      this.#dispatchNoChange(can.error);
      return can;
    }
    const node = this.#inspector.nodeById(id);
    if (node) {
      node.descriptor.configuration = configuration;
    }
    this.#updateGraph(false);
    return { success: true };
  }

  async #canChangeMetadata(id: NodeIdentifier): Promise<SingleEditResult> {
    const node = this.#inspector.nodeById(id);
    if (!node) {
      return {
        success: false,
        error: `Node with id "${id}" does not exist`,
      };
    }
    return { success: true };
  }

  #isVisualOnly(incoming: NodeMetadata, existing: NodeMetadata): boolean {
    return (
      existing.title === incoming.title &&
      existing.description === incoming.description &&
      existing.logLevel === incoming.logLevel
    );
  }

  async #changeMetadata(
    id: NodeIdentifier,
    metadata: NodeMetadata
  ): Promise<SingleEditResult> {
    const can = await this.#canChangeMetadata(id);
    if (!can.success) return can;
    const node = this.#inspector.nodeById(id);
    if (!node) {
      const error = `Unknown node with id "${id}"`;
      this.#dispatchNoChange(error);
      return { success: false, error };
    }
    const visualOnly = this.#isVisualOnly(
      metadata,
      node.descriptor.metadata || {}
    );
    node.descriptor.metadata = metadata;
    this.#updateGraph(visualOnly);
    return { success: true };
  }

  getGraph(id: GraphIdentifier) {
    if (!this.#graphs) {
      throw new Error("Embedded graphs can't contain subgraphs.");
    }
    return this.#graphs[id] || null;
  }

  addGraph(id: GraphIdentifier, graph: GraphDescriptor): EditableGraph | null {
    if (!this.#graphs) {
      throw new Error("Embedded graphs can't contain subgraphs.");
    }

    if (this.#graphs[id]) {
      return null;
    }

    const editable = new Graph(graph, this.#options, this);
    this.#graphs[id] = editable;
    this.#updateGraph(false);

    return editable;
  }

  removeGraph(id: GraphIdentifier): SingleEditResult {
    if (!this.#graphs) {
      throw new Error("Embedded graphs can't contain subgraphs.");
    }

    if (!this.#graphs[id]) {
      const error = `Subgraph with id "${id}" does not exist`;
      this.#dispatchNoChange(error);
      return {
        success: false,
        error,
      };
    }
    delete this.#graphs[id];
    this.#updateGraph(false);
    return { success: true };
  }

  replaceGraph(
    id: GraphIdentifier,
    graph: GraphDescriptor
  ): EditableGraph | null {
    if (!this.#graphs) {
      throw new Error("Embedded graphs can't contain subgraphs.");
    }

    const old = this.#graphs[id];
    if (!old) {
      return null;
    }
    old.#makeIndependent();

    const editable = new Graph(graph, this.#options, this);
    this.#graphs[id] = editable;
    this.#updateGraph(false);

    return editable;
  }

  async #changeGraphMetadata(
    metadata: GraphMetadata
  ): Promise<SingleEditResult> {
    this.#graph.metadata = metadata;
    this.#updateGraph(false);
    return { success: true };
  }

  raw() {
    return this.#graph;
  }

  inspect() {
    return this.#inspector;
  }
}
