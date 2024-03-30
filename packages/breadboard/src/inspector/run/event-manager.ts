/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HarnessRunResult, SecretResult } from "../../harness/types.js";
import {
  ErrorResponse,
  GraphEndProbeData,
  GraphStartProbeData,
  InputResponse,
  NodeDescriptor,
  NodeEndResponse,
  NodeStartResponse,
  OutputResponse,
} from "../../types.js";
import { inspectableGraph } from "../graph.js";
import {
  ERROR_PATH,
  PathRegistry,
  SECRET_PATH,
  createSimpleEntry,
  idFromPath,
  pathFromId,
} from "./path-registry.js";
import {
  RunNodeEvent,
  entryIdFromEventId,
  eventIdFromEntryId,
} from "./run-node-event.js";
import { RunSerializer } from "./serializer.js";
import {
  EventIdentifier,
  InspectableGraphStore,
  InspectableRunErrorEvent,
  InspectableRunEvent,
  InspectableRunSecretEvent,
  PathRegistryEntry,
  RunObserverLogLevel,
  RunObserverOptions,
  TimelineEntry,
} from "../types.js";

const shouldSkipEvent = (
  options: RunObserverOptions,
  node: NodeDescriptor,
  isTopLevel: boolean
): boolean => {
  // Never skip input or output events.
  if (isTopLevel && (node.type === "input" || node.type === "output"))
    return false;

  const isAskingForDebug = !!options.logLevel && options.logLevel == "debug";
  // If asking for debug, show all events, regardless of the node's log level.
  if (isAskingForDebug) return false;

  const nodelogLevel =
    (node.metadata?.logLevel as RunObserverLogLevel) || "debug";
  return nodelogLevel !== "info";
};

type SequenceEntry = [type: TimelineEntry["type"], entry: PathRegistryEntry];

export class EventManager {
  #graphStore;
  #options;
  #pathRegistry = new PathRegistry();
  #serializer = new RunSerializer();
  #sequence: SequenceEntry[] = [];

  constructor(store: InspectableGraphStore, options: RunObserverOptions) {
    this.#graphStore = store;
    this.#options = options;
  }

  #addToSequence(type: TimelineEntry["type"], entry: PathRegistryEntry) {
    this.#sequence.push([type, entry]);
  }

  #addGraphstart(data: GraphStartProbeData) {
    const { path, graph, timestamp } = data;
    const { id: graphId, added } = this.#graphStore.add(graph, 0);
    const entry = this.#pathRegistry.create(path);
    entry.graphId = graphId;
    entry.graphStart = timestamp;
    // TODO: Instead of creating a new instance, cache and store them
    // in the GraphStore.
    entry.graph = inspectableGraph(graph, { kits: this.#options.kits });
    // Always count the starting graph (the path.length === 0) as new,
    // because the Run adds it.
    const newGraph = added || path.length === 0;
    this.#serializer.addGraphstart(data, graphId, newGraph);
    this.#addToSequence("graphstart", entry);
  }

  #addGraphend(data: GraphEndProbeData) {
    const { path, timestamp } = data;
    const entry = this.#pathRegistry.find(path);
    this.#serializer.addGraphend({
      timestamp: data.timestamp,
      path: data.path,
    });
    if (!entry) {
      if (path.length > 0) {
        throw new Error(
          `Expected an existing entry for ${JSON.stringify(path)}`
        );
      }
      return;
    }
    entry.graphEnd = timestamp;
    this.#addToSequence("graphend", entry);
  }

  #addNodestart(data: NodeStartResponse) {
    const { node, timestamp, inputs, path } = data;
    const entry = this.#pathRegistry.create(path);

    if (!entry) {
      throw new Error(`Expected an existing entry for ${JSON.stringify(path)}`);
    }

    const event = new RunNodeEvent(entry, node, timestamp, inputs);
    event.hidden = shouldSkipEvent(
      this.#options,
      node,
      entry.path.length === 1
    );
    entry.event = event;
    this.#serializer.addNodestart(data);
    this.#addToSequence("nodestart", entry);
  }

  #addInput(data: InputResponse) {
    const { path, bubbled, inputArguments, node, timestamp } = data;
    const entry = this.#pathRegistry.find(path);
    if (!entry) {
      throw new Error(`Expected an existing entry for ${JSON.stringify(path)}`);
    }
    this.#serializer.addInput(data);

    if (bubbled) {
      const event = new RunNodeEvent(entry, node, timestamp, inputArguments);
      event.bubbled = true;
      this.#pathRegistry.addSidecar(path, event);
    } else {
      const existing = entry.event;
      if (!existing) {
        console.error("Expected an existing event for", path);
        return;
      }
    }
    this.#addToSequence("input", entry);
  }

  #addOutput(data: OutputResponse) {
    const { path, bubbled, node, timestamp, outputs } = data;
    const entry = this.#pathRegistry.find(path);
    if (!entry) {
      throw new Error(`Expected an existing entry for ${JSON.stringify(path)}`);
    }
    this.#serializer.addOutput(data);
    if (bubbled) {
      const event = new RunNodeEvent(entry, node, timestamp, outputs);
      event.bubbled = true;
      this.#pathRegistry.addSidecar(path, event);
    } else {
      const existing = entry.event;
      if (!existing) {
        console.error("Expected an existing event for", path);
        return;
      }
      if (existing.type !== "node") {
        throw new Error(
          `Expected an existing event to be of type "node", but got ${existing.type}`
        );
      }
      existing.inputs = data.outputs;
    }
    this.#addToSequence("output", entry);
  }

  #addNodeend(data: NodeEndResponse) {
    const { path } = data;
    const entry = this.#pathRegistry.find(path);
    if (!entry) {
      throw new Error(`Expected an existing entry for ${JSON.stringify(path)}`);
    }
    this.#serializer.addNodeend(data);
    const existing = entry.event;
    if (!existing) {
      // This is an event that was skipped because the log levels didn't
      // match.
      this.#pathRegistry.finalizeSidecar(path, data);
      return;
    }
    if (existing.type !== "node") {
      throw new Error(
        `Expected an existing event to be of type "node", but got ${existing.type}`
      );
    }
    existing.end = data.timestamp;
    existing.outputs = data.outputs;
    this.#pathRegistry.finalizeSidecar(path, data);
    this.#addToSequence("nodeend", entry);
  }

  #addSecret(data: SecretResult["data"]) {
    const { timestamp: start, keys } = data;
    const id = idFromPath(SECRET_PATH);
    const event: InspectableRunSecretEvent = {
      id: eventIdFromEntryId(id),
      type: "secret",
      keys,
      start,
      end: null,
    };
    this.#pathRegistry.addSidecar(SECRET_PATH, event);
    this.#serializer.addSecret(data);
    this.#addToSequence("secret", createSimpleEntry(SECRET_PATH, event));
  }

  #addError(data: ErrorResponse) {
    const { timestamp: start, error } = data;
    const id = idFromPath(ERROR_PATH);
    const event: InspectableRunErrorEvent = {
      id: eventIdFromEntryId(id),
      type: "error",
      start,
      error,
    };
    this.#pathRegistry.addError(event);
    this.#serializer.addError(data);
    this.#addToSequence("error", createSimpleEntry(ERROR_PATH, event));
  }

  add(result: HarnessRunResult) {
    this.#pathRegistry.finalizeSidecar(SECRET_PATH, result.data);

    switch (result.type) {
      case "graphstart":
        return this.#addGraphstart(result.data);
      case "graphend":
        return this.#addGraphend(result.data);
      case "nodestart":
        return this.#addNodestart(result.data);
      case "input":
        return this.#addInput(result.data);
      case "output":
        return this.#addOutput(result.data);
      case "secret":
        return this.#addSecret(result.data);
      case "nodeend":
        return this.#addNodeend(result.data);
      case "error":
        return this.#addError(result.data);
    }
  }

  get events(): InspectableRunEvent[] {
    return this.#pathRegistry.events;
  }

  serializer() {
    return this.#serializer;
  }

  getEventById(id: EventIdentifier): InspectableRunEvent | null {
    const entryId = entryIdFromEventId(id);
    if (!entryId) return null;
    const path = pathFromId(entryId);
    const entry = this.#pathRegistry.find(path);
    return entry?.event || null;
  }
}
