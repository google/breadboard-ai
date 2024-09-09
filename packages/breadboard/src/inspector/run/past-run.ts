/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HarnessRunResult } from "../../harness/types.js";
import { asyncGen } from "../../utils/async-gen.js";
import { GraphStore } from "../graph-store.js";
import { inspectableGraph } from "../graph.js";
import {
  EventIdentifier,
  GraphUUID,
  GraphstartTimelineEntry,
  InspectableGraph,
  InspectableRun,
  InspectableRunEvent,
  InspectableRunInputs,
  InspectableRunNodeEvent,
  NodestartTimelineEntry,
  SerializedRunLoadingOptions,
  TimelineEntry,
} from "../types.js";
import { RunObserver } from "./run.js";

export const errorResult = (error: string): HarnessRunResult => {
  return {
    type: "error",
    data: {
      error,
      timestamp: Date.now(),
    },
    reply: async () => {
      // Do nothing
    },
  };
};

export class PastRun implements InspectableRun {
  #timeline: TimelineEntry[];
  #graphs = new Map<number, InspectableGraph>();
  #options: SerializedRunLoadingOptions;
  #backingRun: InspectableRun | null = null;

  edges = [];

  constructor(
    public readonly dataStoreKey = crypto.randomUUID(),
    timeline: TimelineEntry[],
    options: SerializedRunLoadingOptions
  ) {
    this.#timeline = timeline;
    this.#options = options;
  }

  async initializeBackingRun() {
    const observer = new RunObserver(new GraphStore(), { logLevel: "debug" });
    for await (const result of this.replay()) {
      observer.observe(result);
    }
    this.#backingRun = (await observer.runs())[0];
  }

  get graphId(): GraphUUID {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide graph IDs");
    }
    return this.#backingRun.graphId;
  }

  get graphVersion(): number {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide graph versions");
    }
    return this.#backingRun.graphVersion;
  }

  get start(): number {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide start times");
    }
    return this.#backingRun.start;
  }
  get end(): number | null {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide end times");
    }
    return this.#backingRun.end;
  }

  get events(): InspectableRunEvent[] {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide events");
    }
    return this.#backingRun.events;
  }

  currentNodeEvent(): InspectableRunNodeEvent | null {
    if (!this.#backingRun) {
      throw new Error(
        "Uninitialized run: can't yet provide current node events"
      );
    }
    return this.#backingRun.currentNodeEvent();
  }

  stack(): InspectableRunNodeEvent[] {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide stack traces");
    }
    return this.#backingRun.stack();
  }

  getEventById(id: EventIdentifier): InspectableRunEvent | null {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide event IDs");
    }
    return this.#backingRun.getEventById(id);
  }

  inputs(): InspectableRunInputs | null {
    if (!this.#backingRun) {
      throw new Error("Uninitialized run: can't yet provide inputs");
    }
    return this.#backingRun.inputs();
  }

  #loadGraphStart(result: GraphstartTimelineEntry): HarnessRunResult {
    const [, data] = result;
    const { index, timestamp, path, edges } = data;
    let { graph } = data;
    if (graph !== null) {
      this.#graphs.set(index, inspectableGraph(graph, this.#options));
    } else {
      graph = this.#graphs.get(index)?.raw() || null;
    }
    return {
      type: "graphstart",
      data: { timestamp, path, graph, edges },
    } as HarnessRunResult;
  }

  #loadNodestart(result: NodestartTimelineEntry): HarnessRunResult {
    const [, data] = result;
    const { graph: graphIndex, id: node, timestamp, inputs, path } = data;
    const graph = this.#graphs.get(graphIndex);
    if (!graph) {
      throw new Error(
        `Unknown graph index ${graphIndex} while loading nodestart`
      );
    }
    const descriptor = graph.nodeById(node);
    if (!descriptor) {
      throw new Error(`Unknown node id ${node} while loading nodestart`);
    }
    return {
      type: "nodestart",
      data: { timestamp, path, inputs, node: descriptor.descriptor },
    } as HarnessRunResult;
  }

  #asHarnessRunResult(entry: TimelineEntry): HarnessRunResult {
    const [type, data] = entry;
    return { type, data } as HarnessRunResult;
  }

  async *replay(): AsyncGenerator<HarnessRunResult> {
    yield* asyncGen<HarnessRunResult>(async (next) => {
      try {
        for (const result of this.#timeline) {
          const [type] = result;
          switch (type) {
            case "graphstart":
              await next(this.#loadGraphStart(result));
              continue;
            case "nodestart":
              await next(this.#loadNodestart(result));
              continue;
            default:
              await next(this.#asHarnessRunResult(result));
          }
        }
      } catch (e) {
        const error = e as Error;
        next(errorResult(`Loading run failed with the error ${error.message}`));
      }
    });
  }
}
