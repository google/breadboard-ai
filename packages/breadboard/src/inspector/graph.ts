/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { handlersFromKits } from "../handler.js";
import { combineSchemas } from "../schema.js";
import {
  Edge,
  GraphDescriptor,
  NodeDescriberContext,
  NodeDescriberResult,
  NodeIdentifier,
  NodeTypeIdentifier,
} from "../types.js";
import { collectKits } from "./kits.js";
import { inspectableNode } from "./node.js";
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

class Graph implements InspectableGraph {
  #url?: URL;
  #kits?: InspectableKit[];
  #options: InspectableGraphOptions;

  // addNode: change the value
  // removeNode: change the value
  // addEdge: change the value
  // removeEdge: change the value
  // changeConfiguration: change the value
  // changeMetadata: change the value
  #graph: GraphDescriptor;

  // addNode: adds a new item to the list
  // removeNode: removes an item from the list
  // addEdge: no change
  // removeEdge: no change
  // changeConfiguration: no change
  // changeMetadata: no change
  #nodes: InspectableNode[];

  // addNode: no change
  // removeNode: remove edges that are connected to the node
  // addEdge: add the edge to the list
  // removeEdge: remove the edge from the list
  // changeConfiguration: no change
  // changeMetadata: no change
  #edges?: InspectableEdge[];

  // addNode: reset to undefined
  // removeNode: reset to undefined
  // addEdge: no change
  // removeEdge: no change
  // changeConfiguration: no change
  // changeMetadata: no change
  #nodeMap?: Map<NodeIdentifier, InspectableNode>;

  // addNode: reset to undefined
  // removeNode: reset to undefined
  // addEdge: no change
  // removeEdge: no change
  // changeConfiguration: no change
  // changeMetadata: no change
  #typeMap?: Map<NodeTypeIdentifier, InspectableNode[]>;

  // addNode: reset to undefined
  // removeNode: reset to undefined
  // addEdge: no change
  // removeEdge: reset to undefined
  // changeConfiguration: no change
  // changeMetadata: no change
  #entries?: InspectableNode[];

  constructor(graph: GraphDescriptor, options?: InspectableGraphOptions) {
    this.#graph = graph;
    this.#url = maybeURL(graph.url);
    this.#options = options || {};
    this.#nodes = this.#graph.nodes.map((node) => inspectableNode(node, this));
  }

  raw() {
    return this.#graph;
  }

  nodesByType(type: NodeTypeIdentifier): InspectableNode[] {
    if (!this.#typeMap) {
      this.#typeMap = new Map();
      this.#nodes.forEach((node) => {
        const type = node.descriptor.type;
        let list = this.#typeMap?.get(type);
        if (!list) {
          list = [];
          this.#typeMap?.set(type, list);
        }
        list.push(node);
      });
    }
    return this.#typeMap.get(type) || [];
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
    return (this.#nodeMap ??= new Map(
      this.#nodes.map((node) => [node.descriptor.id, node])
    )).get(id);
  }

  nodes(): InspectableNode[] {
    return this.#nodes;
  }

  #edgeToInspectableEdge = (edge: Edge): InspectableEdge => {
    const from = this.nodeById(edge.from);
    const to = this.nodeById(edge.to);
    const edgein = edge.out === "*" ? "*" : edge.in;
    return {
      from,
      out: edge.out,
      to,
      in: edgein,
    } as InspectableEdge;
  };

  edges(): InspectableEdge[] {
    return (this.#edges ??= this.#graph.edges.map((edge) =>
      this.#edgeToInspectableEdge(edge)
    ));
  }

  hasEdge(edge: Edge): boolean {
    edge = fixUpStarEdge(edge);
    return !!this.#graph.edges.find((e) => {
      return (
        e.from === edge.from &&
        e.to === edge.to &&
        e.out === edge.out &&
        e.in === edge.in
      );
    });
  }

  kits(): InspectableKit[] {
    return (this.#kits ??= collectKits(this.#options.kits || []));
  }

  incomingForNode(id: NodeIdentifier): InspectableEdge[] {
    return this.#graph.edges
      .filter((edge) => edge.to === id)
      .map((edge) => this.#edgeToInspectableEdge(edge))
      .filter(
        (edge) => edge.from !== undefined && edge.to !== undefined
      ) as InspectableEdge[];
  }

  outgoingForNode(id: NodeIdentifier): InspectableEdge[] {
    return this.#graph.edges
      .filter((edge) => edge.from === id)
      .map((edge) => {
        return {
          from: this.nodeById(edge.from),
          out: edge.out,
          to: this.nodeById(edge.to),
          in: edge.in,
        };
      })
      .filter(
        (edge) => edge.from !== undefined && edge.to !== undefined
      ) as InspectableEdge[];
  }

  entries(): InspectableNode[] {
    return (this.#entries ??= this.#nodes.filter((node) => node.isEntry()));
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
}

/**
 * This helper is necessary because both "*" and "" are valid representations
 * of a wildcard edge tail. This function ensures that the edge is always
 * consistent.
 * @param edge -- the edge to fix up
 * @returns
 */
export const fixUpStarEdge = (edge: Edge): Edge => {
  if (edge.out === "*") {
    return { ...edge, in: "" };
  }
  return edge;
};
