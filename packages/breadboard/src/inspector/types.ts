/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HarnessRunResult, SecretResult } from "../harness/types.js";
import { GraphLoader } from "../loader/types.js";
import {
  Edge,
  ErrorResponse,
  GraphDescriptor,
  InputValues,
  Kit,
  KitDescriptor,
  NodeConfiguration,
  NodeDescriberResult,
  NodeDescriptor,
  NodeIdentifier,
  NodeTypeIdentifier,
  NodeValue,
  OutputValues,
  Schema,
} from "../types.js";

export type GraphVersion = number;

export type GraphURL = string;

/**
 * Represents an UUID that is used to identify a graph.
 */
export type GraphUUID = `${GraphVersion}|${GraphURL}`;

export type InspectableNode = {
  /**
   * The `NodeDescriptor` for the node.
   */
  descriptor: NodeDescriptor;
  /**
   * The title of the node. Use this to get a consistent name for the node.
   * When the node has a title in the `NodeMetadata`, will be used.
   * Otherwise, the id of the node will be used.
   */
  title(): string;
  /**
   * Returns the nodes that have an edge to this node.
   */
  incoming(): InspectableEdge[];
  /**
   * Returns the nodes that have an edge from this node.
   */
  outgoing(): InspectableEdge[];
  /**
   * Return true if the node is an entry node (no incoming edges)
   */
  isEntry(): boolean;
  /**
   * Return true if the node is an exit node (no outgoing edges)
   */
  isExit(): boolean;

  /**
   * Returns the API of the node.
   *
   * A note about the relationship between `describe`, `subgraph.describe`,
   * and `incoming`/`outgoing`:
   * - the `describe` returns the API as the node itself expects it
   * - the `incoming` and `outgoing` return the actual wires going in/out
   * - the `subgraph.describe` returns the API of the subgraph that the node
   *   contains (or represents). For instance, the `invoke` node has a `path`
   *   required property. This property will show up in `describe` (since it
   *   specifies the path of the graph), but not in `subgraph.describe` (since
   *   the subgraph itself doesn't actually use it).
   *
   * This function is designed to match the output of the
   * `NodeDescriberFunction`.
   */
  describe(inputs?: InputValues): Promise<NodeDescriberResult>;
  /**
   * Returns configuration of the node.
   * TODO: Use a friendlier to inspection return type.
   */
  configuration(): NodeConfiguration;
  /**
   * Returns the current state of node's ports
   */
  ports(
    inputs?: InputValues,
    outputs?: OutputValues
  ): Promise<InspectableNodePorts>;
};

export type InspectableEdge = {
  /**
   * The outgoing node of the edge.
   */
  from: InspectableNode;
  /**
   * The name of the port of the outgoing edge.
   */
  out: string;
  /**
   * The incoming node of the edge.
   */
  to: InspectableNode;
  /**
   * The name of the port of the incoming edge.
   */
  in: string;
};

export type InspectableGraph = {
  /**
   * Returns the underlying `GraphDescriptor` object.
   * TODO: Replace all uses of it with a proper inspector API.
   */
  raw(): GraphDescriptor;
  /**
   * Returns the node with the given id, or undefined if no such node exists.
   * @param id id of the node to find
   */
  nodeById(id: NodeIdentifier): InspectableNode | undefined;
  /**
   * Returns all nodes in the graph.
   */
  nodes(): InspectableNode[];
  /**
   * Returns all edges of the graph.
   */
  edges(): InspectableEdge[];
  /**
   * Returns true if the edge exists in the graph.
   */
  hasEdge(edge: Edge): boolean;
  /**
   * Returns all kits in the graph.
   */
  kits(): InspectableKit[];
  /**
   * Returns all nodes of the given type.
   * @param type type of the nodes to find
   */
  nodesByType(type: NodeTypeIdentifier): InspectableNode[];
  /**
   * Describe a given type of the node
   */
  describeType(
    type: NodeTypeIdentifier,
    options?: NodeTypeDescriberOptions
  ): Promise<NodeDescriberResult>;
  /**
   * Returns the nodes that have an edge to the node with the given id.
   * @param id id of the node to find incoming nodes for
   */
  incomingForNode(id: NodeIdentifier): InspectableEdge[];
  /**
   * Returns the nodes that have an edge from the node with the given id.
   * @param id id of the node to find outgoing nodes for
   */
  outgoingForNode(id: NodeIdentifier): InspectableEdge[];
  /**
   * Returns a list of entry nodes for the graph.
   */
  entries(): InspectableNode[];
  /**
   * Returns the API of the graph. This function is designed to match the
   * output of the `NodeDescriberFunction`.
   */
  describe(): Promise<NodeDescriberResult>;
};

/**
 * Options to supply to the `inspectableGraph` function.
 */
export type InspectableGraphOptions = {
  /**
   * Optional, a list of kits to use when inspecting the graph. If not
   * supplied, the graph will be inspected without any kits.
   */
  kits?: Kit[];
  /**
   * The loader to use when loading boards.
   */
  loader?: GraphLoader;
};

/**
 * Options to supply to the `describeType` function.
 */
export type NodeTypeDescriberOptions = {
  /**
   * Optional, the inputs to the node.
   */
  inputs?: InputValues;
  /**
   * Optional, the incoming edges to the node.
   */
  incoming?: InspectableEdge[];
  /**
   * Optional, the outgoing edges from the node.
   */
  outgoing?: InspectableEdge[];
};

/**
 * Describes the current status of a node port.
 */
export enum PortStatus {
  /**
   * The port status impossible to determine. This only happens when the node
   * has a star wire ("*") and the port is not connected.
   */
  Indeterminate = "indeterminate",
  /**
   * The port is correctly connected to another node or specified using node's
   * configuration, according to this node's schema.
   */
  Connected = "connected",
  /**
   * The port is not connected to another node, and it is expected, but not
   * required by the node's schema.
   */
  Ready = "ready",
  /**
   * The port is not connected to another node, but it is required by the node's
   * schema. It is similar to "Ready", except that not having this port
   * connected is an error.
   */
  Missing = "missing",
  /**
   * The port is connected to this node, but it is not expected by the node's
   * schema. This is an error state.
   */
  Dangling = "dangling",
}

/**
 * Describes a node port (input or output).
 */
export type InspectablePort = {
  /**
   * The name of the port.
   */
  name: string;
  /**
   * The title of the port, if specified by schema. Otherwise, same as the
   * name of the port
   */
  title: string;
  /**
   * Returns current status of this port.
   */
  status: PortStatus;
  /**
   * Returns true if the port was specified in the node's configuration.
   */
  configured: boolean;
  /**
   * Returns current value for the port. This value is computed as follows:
   * - if there is a value coming from one of the incoming edges, then
   *   return that value;
   * - otherwise, if there is a value specified in node's configuration,
   *   then return that value;
   * - otherwise, return null;
   */
  value: NodeValue;
  /**
   * Returns true if this is the star port ("*").
   */
  star: boolean;
  /**
   * Port schema as defined by the node's configuration.
   */
  schema: Schema;
  /**
   * Returns the edges connected to this port.
   */
  edges: InspectableEdge[];
};

/**
 * Represents one side (input or output) of ports of a node.
 */
export type InspectablePortList = {
  /**
   * Input ports of the node.
   */
  ports: InspectablePort[];
  /**
   * Returns true if the list of ports is fixed. Returns false if the node
   * expects a dynamic number of ports.
   *
   * Fixed example: the `validateJson` node, which has two fixed input ports:
   * `json` and `schema`.
   *
   * Conversely, the `core.invoke` node is an example of the dynamic number of
   * ports, which can take any number of inputs and they are passed to the
   * invoked graph as arguments.
   */
  fixed: boolean;
};

/**
 * Represents the input and output ports of a node.
 */
export type InspectableNodePorts = {
  /**
   * Returns the input ports of the node.
   */
  inputs: InspectablePortList;
  /**
   * Returns the output ports of the node.
   */
  outputs: InspectablePortList;
};

/**
 * Represents a Breadboard Kit associated with the board.
 */
export type InspectableKit = {
  /**
   * Returns the descriptor of the kit.
   */
  descriptor: KitDescriptor;
  /**
   * Returns the node types of the kit.
   */
  nodeTypes: InspectableNodeType[];
};

export type InspectableNodeType = {
  /**
   * Returns the type of the node.
   */
  type(): NodeTypeIdentifier;
  /**
   * Returns the ports of the node.
   */
  ports(): Promise<InspectableNodePorts>;
};

/**
 * Represents a simple listener for edits to the graph.
 * An instance of this type is returned by the `editReceiver` method of
 * `InspectableGraph`.
 */
export type GraphStoreMutator = {
  nodeStore: NodeStoreMutator;
  edgeStore: EdgeStoreMutator;
};

export type NodeStoreMutator = {
  add(node: NodeDescriptor): void;
  remove(id: NodeIdentifier): void;
};

export type EdgeStoreMutator = {
  add(edge: Edge): void;
  remove(edge: Edge): void;
};

export type InspectableGraphWithStore = InspectableGraph & GraphStoreMutator;

/**
 * Represents a store of graph versions.
 */
export type InspectableGraphVersionsStore = {
  /**
   * Retrieves a graph with the given id, and optionally, version and run.
   * @param id -- the id of the graph to retrieve
   * @param version -- the version of the graph to retrieve (optional,
   * defaults to 0)
   * @param run -- the run of the graph to retrieve (optional, defaults to 0)
   */
  get(
    id: GraphUUID,
    version?: number,
    run?: number
  ): Promise<InspectableGraphVersions>;
};

/**
 * Represents a sequence of versions of a graph.
 * This sequence of versions grows as the graph is edited.
 */
export type InspectableGraphVersions = {
  /**
   * The unique identifier of the sequence of graph versions.
   */
  id: GraphUUID;
  /**
   * A list of versions for the given graph. Every edit to the graph
   * results in a new version. The first item in the list is the initial
   * version of the graph. The last item is the latest version.
   */
  versions: InspectableVersionedGraph[];
  /**
   * Returns only major versions of the graph.
   * A "major" version of the graph is a version that has one or more runs
   * associated with it. A "minor" version is a version that has no runs.
   */
  major(): InspectableVersionedGraph[];
};

/**
 * Represents a versioned graph.
 * A versioned graph has zero or more runs associated with it.
 */
export type InspectableVersionedGraph = {
  /**
   * The unique identifier of the versioned graph. This is a monotonically
   * increasing number, starting from 0. Same as the index of the `versions`
   * array in the `InspectableGraphWithVersions` object.
   */
  id: number;
  graph: InspectableGraph;
  runs: InspectableRun[];
};

/**
 * Represents an observer of the graph runs.
 */
export type InspectableRunObserver = {
  /**
   * Returns the list of runs that were observed. The current run is always
   * at the top of the list.
   */
  runs(): InspectableRun[];
  /**
   * Observes the given result and collects it into the list of runs.
   * @param result -- the result to observe
   * @returns -- the list of runs that were observed
   */
  observe(result: HarnessRunResult): InspectableRun[];
};

/**
 * Represents a store of all graphs that the system has seen so far.
 */
export type InspectableGraphStore = {
  /**
   * Retrieves a graph with the given id.
   * @param id -- the id of the graph to retrieve
   */
  get(id: GraphUUID): GraphDescriptor | undefined;
  /**
   * Checks if the store has a graph with the given id.
   * @param id -- the id of the graph
   */
  has(id: GraphUUID): boolean;
  /**
   * Adds a graph to the store and returns the UUID. If the graph is already
   * in the store, returns the UUID of the existing graph.
   */
  add(graph: GraphDescriptor, version: number): GraphUUID;
};

/**
 * Represents a pair of the nodestart and nodeend results that were generated
 * during the run.
 */
export type InspectableRunNodeEvent = {
  type: "node";
  /**
   * Unique identifier of the event.
   */
  id: EventIdentifier;
  /**
   * The `InspectableNode` instance associated with this node.
   */
  node: InspectableNode;
  /**
   * The timestamp of the `nodestart` event.
   */
  start: number;
  /**
   * The timestamp of the `nodeend` event. Can be null when the `nodeend` has
   * not been received yet.
   */
  end: number | null;
  /**
   * The inputs that were provided to the node
   */
  inputs: InputValues;
  /**
   * The outputs that were produced by the node. Can be null when the `nodeend`
   * has not been received yet.
   */
  outputs: OutputValues | null;
  /**
   * Returns true when the input or output node was bubbled up from a nested
   * graph. This is only populated for the top-level graph.
   */
  bubbled: boolean;
  /**
   * Returns true if the event should be hidden in the UI.
   */
  hidden: boolean;
  /**
   * Returns the list of nested runs that were (or are being) create when
   * this node was (is being) invoked.
   */
  runs: InspectableRun[];
};

/**
 * Represents an error event that was generated during the run.
 */
export type InspectableRunErrorEvent = {
  type: "error";
  id: EventIdentifier;
  error: ErrorResponse["error"];
  /**
   * When the error was first observed.
   */
  start: number;
};

export type InspectableRunSecretEvent = {
  type: "secret";
  id: EventIdentifier;
  keys: SecretResult["data"]["keys"];
  /**
   * When the `secrets` node was first observed.
   */
  start: number;
  /**
   * When the `secrets` node was handled.
   */
  end: number | null;
};

export type EventIdentifier = string;

/**
 * Represent all events that can be inspected during a run.
 */
export type InspectableRunEvent =
  | InspectableRunNodeEvent
  | InspectableRunSecretEvent
  | InspectableRunErrorEvent;

/**
 * Represents a single run of a graph.
 */
export type InspectableRun = {
  /**
   * The id graph that was run.
   */
  graphId: GraphUUID;
  /**
   * The version graph that was run.
   */
  graphVersion: number;
  /**
   * Start time of the run.
   */
  start: number;
  /**
   * End time of the run. Can be null if the run has not finished yet.
   */
  end: number | null;
  /**
   * All events within this graph that have occurred during the run.
   * The nested graph events aren't included.
   */
  events: InspectableRunEvent[];
  /**
   * @deprecated Use `events` instead.
   */
  messages: HarnessRunResult[];
  /**
   * @deprecated Use `events` instead.
   */
  currentNode(position: number): string;
};

export type PathRegistryEntry = {
  id: string;
  parent: PathRegistryEntry | null;
  children: PathRegistryEntry[];
  graphId: GraphUUID | null;
  graphStart: number;
  graphEnd: number | null;
  event: InspectableRunEvent | null;
  /**
   * Sidecars are events that are displayed at a top-level, but aren't
   * part of the main event list. Currently, sidecar events are:
   * - Input events that have bubbled up.
   * - Output events that have bubbled up.
   * - Secret events.
   * - Error events.
   */
  sidecars: InspectableRunEvent[];
  /**
   * Returns true if the entry has no children.
   */
  empty(): boolean;
  /**
   * Returns nested events for this entry.
   */
  events: InspectableRunEvent[];
  /**
   * Returns an inspectable graph for the graph, associated with this entry/
   */
  graph: InspectableGraph | null;
};

export type RunObserverLogLevel =
  /**
   * Show only events that are marked as info.
   * Typically, these are useful for communicating the
   * broad picture of what the graph is doing.
   */
  | "info"
  /**
   * Show info events and debug events. This includes all
   * events that are emitted by the graph.
   */
  | "debug";

export type RunObserverOptions = {
  /**
   * Logging level.
   */
  logLevel?: RunObserverLogLevel;
  /**
   * The kits that are being used during this run. Used to provide
   * the ability to inspect graphs and nodes during the run.
   */
  kits?: Kit[];
};
