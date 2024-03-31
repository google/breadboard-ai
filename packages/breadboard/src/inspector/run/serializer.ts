/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GraphDescriptor,
  NodeDescriptor,
  NodeValue,
} from "@google-labs/breadboard-schema/graph.js";
import {
  GraphUUID,
  TimelineEntry,
  RunSerializationOptions,
  SerializedRun,
  SerializedRunSecretReplacer,
  PathRegistryEntry,
  InspectableRunNodeEvent,
  InspectableRunSecretEvent,
  InspectableRunErrorEvent,
} from "../types.js";
import {
  ErrorResponse,
  GraphEndProbeData,
  InputResponse,
  NodeEndResponse,
  OutputResponse,
} from "../../types.js";
import { pathFromId } from "./path-registry.js";
import { SecretResult } from "../../harness/types.js";

export type SequenceEntry = [
  type: TimelineEntry["type"],
  entry: PathRegistryEntry,
];

export class RunSerializer {
  #seenGraphs = new Map<GraphUUID, number>();
  #graphIndex = 0;

  #graphIndexFromEntry(entry: PathRegistryEntry) {
    const graphEntry = entry.parent;
    if (!graphEntry) {
      throw new Error(
        `Unknown graph entry for "${entry.id}" when serializing.`
      );
    }
    const graphId = graphEntry.graphId;
    if (!graphId) {
      throw new Error(`Unknown graphId for "${entry.id}" when serializing.`);
    }
    const graph = this.#seenGraphs.get(graphId);
    if (graph === undefined) {
      throw new Error(`Unknown graph for "${entry.id}" when serializing.`);
    }
    return graph;
  }

  #simpleDescriptor(event: InspectableRunNodeEvent) {
    return { id: event.node.descriptor.id } as NodeDescriptor;
  }

  serializeGraphstart(entry: PathRegistryEntry): TimelineEntry {
    const { graphId } = entry;
    if (graphId === null) {
      throw new Error("Encountered an empty graphId during graphstart.");
    }
    let graph: GraphDescriptor | null = null;
    let index: number;
    if (!this.#seenGraphs.has(graphId)) {
      graph = entry.graph?.raw() || null;
      index = this.#graphIndex++;
      this.#seenGraphs.set(graphId, index);
    } else {
      index = this.#seenGraphs.get(graphId) || 0;
    }
    return {
      type: "graphstart",
      data: {
        timestamp: entry.graphStart,
        path: pathFromId(entry.id),
        index,
        graph,
      },
    };
  }

  serializeGraphend(entry: PathRegistryEntry): TimelineEntry {
    return {
      type: "graphend",
      data: {
        path: pathFromId(entry.id),
        timestamp: entry.graphEnd as number,
      } satisfies GraphEndProbeData,
    };
  }

  serializeNodestart(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunNodeEvent;
    const { inputs, start: timestamp } = event;
    const node = event.node.descriptor.id;
    const graph = this.#graphIndexFromEntry(entry);
    return {
      type: "nodestart",
      data: { id: node, graph, inputs, path: pathFromId(entry.id), timestamp },
    };
  }

  serializeInput(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunNodeEvent;
    if (!event) {
      throw new Error("Unexpected empty input event while serializing run");
    }
    return {
      type: "input",
      data: {
        path: pathFromId(entry.id),
        timestamp: event.start, // TODO: make sure these match in the runner.
        node: this.#simpleDescriptor(event),
        inputArguments: event.inputs,
        bubbled: event.bubbled,
      } satisfies InputResponse,
    };
  }

  serializeOutput(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunNodeEvent;
    if (!event) {
      throw new Error("Unexpected empty output event while serializing run");
    }
    return {
      type: "output",
      data: {
        path: pathFromId(entry.id),
        timestamp: event.start,
        node: this.#simpleDescriptor(event),
        outputs: event.inputs,
        bubbled: event.bubbled,
      } satisfies OutputResponse,
    };
  }

  serializeSecret(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunSecretEvent;
    if (!event) {
      throw new Error("Unexpected empty secret event while serializing run");
    }
    return {
      type: "secret",
      data: {
        keys: event.keys,
        timestamp: event.start,
      } satisfies SecretResult["data"],
    };
  }

  serializeNodeend(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunNodeEvent;
    if (!event) {
      throw new Error("Unexpected empty nodeend event while serializing run");
    }
    return {
      type: "nodeend",
      data: {
        path: pathFromId(entry.id),
        timestamp: event.end as number,
        outputs: event.outputs,
        node: { type: event.node.descriptor.type },
      },
    };
  }

  serializeError(entry: PathRegistryEntry): TimelineEntry {
    const event = entry.event as InspectableRunErrorEvent;
    if (!event) {
      throw new Error("Unexpected empty error event while serializing run");
    }
    return {
      type: "error",
      data: {
        error: event.error,
        timestamp: event.start,
      } satisfies ErrorResponse,
    };
  }

  serialize(
    sequence: Iterable<SequenceEntry>,
    options: RunSerializationOptions
  ) {
    const timeline: TimelineEntry[] = [];
    for (const [type, entry] of sequence) {
      switch (type) {
        case "graphstart": {
          timeline.push(this.serializeGraphstart(entry));
          break;
        }
        case "graphend": {
          timeline.push(this.serializeGraphend(entry));
          break;
        }
        case "nodestart": {
          timeline.push(this.serializeNodestart(entry));
          break;
        }
        case "input": {
          timeline.push(this.serializeInput(entry));
          break;
        }
        case "output": {
          timeline.push(this.serializeOutput(entry));
          break;
        }
        case "secret": {
          timeline.push(this.serializeSecret(entry));
          break;
        }
        case "nodeend": {
          timeline.push(this.serializeNodeend(entry));
          break;
        }
        case "error": {
          timeline.push(this.serializeError(entry));
          break;
        }
      }
    }
    const serialized: SerializedRun = {
      $schema: "tbd",
      version: "0",
      timeline,
    };
    if (options.keepSecrets) return serialized;
    return replaceSecrets(serialized, () => {
      return crypto.randomUUID();
    });
  }
}

export const replaceSecrets = (
  data: SerializedRun,
  replacer: SerializedRunSecretReplacer
): SerializedRun => {
  const secretStore: Record<string, { to: string; from: string }> = {};

  const serializeSecrets = () => {
    return Object.fromEntries(
      Object.entries(secretStore).map(([key, value]) => {
        return [key, value.to];
      })
    );
  };

  const processPorts = (
    ports: Record<string, NodeValue>
  ): Record<string, NodeValue> => {
    if (!ports) return ports;
    return Object.fromEntries(
      Object.entries(ports).map(([key, value]) => {
        let stringified = JSON.stringify(value);
        for (const secret of Object.values(secretStore)) {
          stringified = stringified.replace(secret.from, secret.to);
        }
        return [key, JSON.parse(stringified)];
      })
    );
  };

  const timeline = data.timeline.map((entry) => {
    if (entry.type === "nodeend") {
      const data = entry.data as NodeEndResponse;
      // "node" has a "?"  only because when reading back loaded run,
      // "node" doesn't exist here (addNodeend doesn't use it).
      // TODO: make more elegant.
      if (data.node?.type === "secrets") {
        Object.entries(data.outputs).forEach(([key, value]) => {
          if (secretStore[key]) return;
          const from = value as string;
          const to = replacer(key, from);
          secretStore[key] = { from, to };
        });
      }

      return {
        type: "nodeend",
        data: {
          ...(entry.data as object),
          outputs: processPorts((entry.data as NodeEndResponse).outputs),
        },
      } as TimelineEntry;
    } else if (entry.type === "nodestart") {
      return {
        type: "nodestart",
        data: {
          ...(entry.data as object),
          inputs: processPorts(entry.data.inputs),
        },
      } as TimelineEntry;
    }
    return entry;
  });

  const secrets = serializeSecrets();

  return { $schema: data.$schema, version: data.version, secrets, timeline };
};
