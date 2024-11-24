/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GraphIdentifier,
  GraphMetadata,
  InputValues,
  ModuleIdentifier,
} from "@breadboard-ai/types";
import {
  Edge,
  GraphDescriptor,
  NodeDescriberResult,
  NodeIdentifier,
  NodeTypeIdentifier,
} from "../types.js";
import {
  InspectableEdge,
  InspectableGraphWithStore,
  InspectableKit,
  InspectableModules,
  InspectableNode,
  InspectableNodeType,
  InspectableSubgraphs,
  MutableGraph,
  NodeTypeDescriberOptions,
} from "./types.js";
import { AffectedNode } from "../editor/types.js";
import { DescriberManager } from "./describer-manager.js";
import { GraphQueries } from "./graph-queries.js";

export { Graph };

class Graph implements InspectableGraphWithStore {
  #graphId: GraphIdentifier;
  #mutable: MutableGraph;

  constructor(graphId: GraphIdentifier, mutableGraph: MutableGraph) {
    this.#graphId = graphId;
    this.#mutable = mutableGraph;
  }

  #descriptor(): GraphDescriptor {
    const graph = this.#mutable.graph;
    return this.#graphId ? graph.graphs![this.#graphId]! : graph;
  }

  raw() {
    return this.#descriptor();
  }

  imperative(): boolean {
    return !!this.main();
  }

  main(): string | undefined {
    return this.#descriptor().main;
  }

  metadata(): GraphMetadata | undefined {
    return this.#descriptor().metadata;
  }

  nodesByType(type: NodeTypeIdentifier): InspectableNode[] {
    return this.#mutable.nodes.byType(type, this.#graphId);
  }

  async describeNodeType(
    id: NodeIdentifier,
    type: NodeTypeIdentifier,
    options: NodeTypeDescriberOptions = {}
  ): Promise<NodeDescriberResult> {
    const manager = DescriberManager.create(this.#graphId, this.#mutable);
    if (!manager.success) {
      throw new Error(`Inspect API Integrity Error: ${manager.error}`);
    }
    return manager.result.describeNodeType(id, type, options);
  }

  nodeById(id: NodeIdentifier) {
    return new GraphQueries(this.#mutable, this.#graphId).nodeById(id);
  }

  nodes(): InspectableNode[] {
    return this.#mutable.nodes.nodes(this.#graphId);
  }

  moduleById(id: ModuleIdentifier) {
    return this.#mutable.modules.get(id);
  }

  modules(): InspectableModules {
    return this.#mutable.modules.modules();
  }

  edges(): InspectableEdge[] {
    return this.#mutable.edges.edges(this.#graphId);
  }

  hasEdge(edge: Edge): boolean {
    return this.#mutable.edges.hasByValue(edge, this.#graphId);
  }

  kits(): InspectableKit[] {
    return this.#mutable.kits.kits();
  }

  typeForNode(id: NodeIdentifier): InspectableNodeType | undefined {
    return new GraphQueries(this.#mutable, this.#graphId).typeForNode(id);
  }

  typeById(id: NodeTypeIdentifier): InspectableNodeType | undefined {
    return new GraphQueries(this.#mutable, this.#graphId).typeById(id);
  }

  incomingForNode(id: NodeIdentifier): InspectableEdge[] {
    return new GraphQueries(this.#mutable, this.#graphId).incoming(id);
  }

  outgoingForNode(id: NodeIdentifier): InspectableEdge[] {
    return new GraphQueries(this.#mutable, this.#graphId).outgoing(id);
  }

  entries(): InspectableNode[] {
    return new GraphQueries(this.#mutable, this.#graphId).entries();
  }

  async describe(inputs?: InputValues): Promise<NodeDescriberResult> {
    const manager = DescriberManager.create(this.#graphId, this.#mutable);
    if (!manager.success) {
      throw new Error(`Inspect API Integrity Error: ${manager.error}`);
    }
    return manager.result.describe(inputs);
  }

  get nodeStore() {
    return this.#mutable.nodes;
  }

  get edgeStore() {
    return this.#mutable.edges;
  }

  get moduleStore() {
    return this.#mutable.modules;
  }

  updateGraph(
    graph: GraphDescriptor,
    visualOnly: boolean,
    affectedNodes: AffectedNode[],
    affectedModules: ModuleIdentifier[]
  ): void {
    if (this.#graphId) {
      throw new Error(
        "Inspect API integrity error: updateGraph should never be called for subgraphs"
      );
    }
    this.#mutable.update(graph, visualOnly, affectedNodes, affectedModules);
  }

  resetGraph(graph: GraphDescriptor): void {
    if (this.#graphId) {
      throw new Error(
        "Inspect API integrity error: resetSubgraph should never be called for subgraphs"
      );
    }
    this.#mutable.rebuild(graph);
  }

  addSubgraph(subgraph: GraphDescriptor, graphId: GraphIdentifier): void {
    if (this.#graphId) {
      throw new Error(
        `Can't add subgraph "${graphId}" to subgraph "${this.#graphId}": subgraphs can't contain subgraphs`
      );
    }
    this.#mutable.addSubgraph(subgraph, graphId);
  }

  removeSubgraph(graphId: GraphIdentifier): void {
    if (this.#graphId) {
      throw new Error(
        `Can't remove subgraph "${graphId}" from subgraph "${this.#graphId}": subgraphs can't contain subgraphs`
      );
    }
    this.#mutable.removeSubgraph(graphId);
  }

  graphs(): InspectableSubgraphs | undefined {
    if (this.#graphId) return;
    return this.#mutable.graphs.graphs();
  }

  graphId(): GraphIdentifier {
    return this.#graphId;
  }
}
