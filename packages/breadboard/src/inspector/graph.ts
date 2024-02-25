/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { handlersFromKits } from "../handler.js";
import { AnyEdit, GraphEditReceiver } from "../index.js";
import { combineSchemas } from "../schema.js";
import {
  Edge,
  GraphDescriptor,
  NodeDescriberContext,
  NodeDescriberResult,
  NodeIdentifier,
  NodeTypeIdentifier,
} from "../types.js";
import { InspectableEdgeCache } from "./edge.js";
import { collectKits } from "./kits.js";
import { InspectableNodeCache } from "./node.js";
import {
  EdgeType,
  describeInput,
  describeOutput,
  edgesToSchema,
} from "./schemas.js";
import {
  InspectableEdge,
  InspectableGraph,
  InspectableGraphOptions,
  InspectableKit,
  InspectableNode,
  NodeTypeDescriberOptions,
} from "./types.js";

export const inspectableGraph = (
  graph: GraphDescriptor,
  options?: InspectableGraphOptions
): InspectableGraph => {
  return new Graph(graph, options);
};

const maybeURL = (url?: string): URL | undefined => {
  url = url || "";
  return URL.canParse(url) ? new URL(url) : undefined;
};

class Graph implements InspectableGraph, GraphEditReceiver {
  #url?: URL;
  #kits?: InspectableKit[];
  #options: InspectableGraphOptions;

  #graph: GraphDescriptor;

  // addNode: adds a new item to the list
  // removeNode: removes an item from the list
  // addEdge: no change
  // removeEdge: no change
  // changeConfiguration: no change
  // changeMetadata: no change
  #nodes: InspectableNodeCache;

  // addNode: no change
  // removeNode: remove edges that are connected to the node
  // addEdge: add the edge to the list
  // removeEdge: remove the edge from the list
  // changeConfiguration: no change
  // changeMetadata: no change
  #edges: InspectableEdgeCache;

  constructor(graph: GraphDescriptor, options?: InspectableGraphOptions) {
    this.#graph = graph;
    this.#url = maybeURL(graph.url);
    this.#options = options || {};
    this.#edges = new InspectableEdgeCache(this);
    this.#nodes = new InspectableNodeCache(this);
  }

  raw() {
    return this.#graph;
  }

  nodesByType(type: NodeTypeIdentifier): InspectableNode[] {
    return this.#nodes.byType(type);
  }

  async describeType(
    type: NodeTypeIdentifier,
    options: NodeTypeDescriberOptions = {}
  ): Promise<NodeDescriberResult> {
    // The schema of an input or an output is defined by their
    // configuration schema or their incoming/outgoing edges.
    if (type === "input") {
      return describeInput(options);
    }
    if (type === "output") {
      return describeOutput(options);
    }

    const { kits } = this.#options;
    const handler = handlersFromKits(kits || [])[type];
    const asWired = {
      inputSchema: edgesToSchema(EdgeType.In, options?.incoming),
      outputSchema: edgesToSchema(EdgeType.Out, options?.outgoing),
    } satisfies NodeDescriberResult;
    if (!handler || typeof handler === "function" || !handler.describe) {
      return asWired;
    }
    const context: NodeDescriberContext = {
      outerGraph: this.#graph,
    };
    if (this.#url) {
      context.base = this.#url;
    }
    try {
      return handler.describe(
        options?.inputs || undefined,
        asWired.inputSchema,
        asWired.outputSchema,
        context
      );
    } catch (e) {
      console.warn(`Error describing node type ${type}`, e);
      return asWired;
    }
  }

  nodeById(id: NodeIdentifier) {
    return this.#nodes.get(id);
  }

  nodes(): InspectableNode[] {
    return this.#nodes.nodes();
  }

  edges(): InspectableEdge[] {
    return this.#edges.edges();
  }

  hasEdge(edge: Edge): boolean {
    return this.#edges.hasByValue(edge);
  }

  kits(): InspectableKit[] {
    return (this.#kits ??= collectKits(this.#options.kits || []));
  }

  incomingForNode(id: NodeIdentifier): InspectableEdge[] {
    return this.#graph.edges
      .filter((edge) => edge.to === id)
      .map((edge) => this.#edges.get(edge) as InspectableEdge);
  }

  outgoingForNode(id: NodeIdentifier): InspectableEdge[] {
    return this.#graph.edges
      .filter((edge) => edge.from === id)
      .map((edge) => this.#edges.get(edge) as InspectableEdge);
  }

  entries(): InspectableNode[] {
    return this.#nodes.nodes().filter((node) => node.isEntry());
  }

  async describe(): Promise<NodeDescriberResult> {
    const inputSchemas = (
      await Promise.all(
        this.nodesByType("input")
          .filter((n) => n.isEntry())
          .map((input) => input.describe())
      )
    ).map((result) => result.outputSchema);

    const outputSchemas = (
      await Promise.all(
        this.nodesByType("output")
          .filter((n) => n.isExit())
          .map((output) => output.describe())
      )
    ).map((result) => result.inputSchema);

    return {
      inputSchema: combineSchemas(inputSchemas),
      outputSchema: combineSchemas(outputSchemas),
    };
  }

  editReceiver() {
    return this;
  }

  onEdit(edits: AnyEdit[]): void {
    edits.forEach((edit) => {
      switch (edit.type) {
        case "addNode":
          this.#nodes.add(edit.node);
          break;
        case "removeNode":
          this.#nodes.remove(edit.id);
          break;
        case "addEdge":
          this.#edges.add(edit.edge);
          break;
        case "removeEdge":
          this.#edges.remove(edit.edge);
          break;
      }
    });
  }
}
