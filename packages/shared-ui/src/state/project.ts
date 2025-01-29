/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AssetPath,
  GraphIdentifier,
  NodeIdentifier,
} from "@breadboard-ai/types";
import {
  EditableGraph,
  EditSpec,
  GraphStoreEntry,
  MainGraphIdentifier,
  MutableGraphStore,
  Outcome,
  PortIdentifier,
} from "@google-labs/breadboard";
import { SignalMap } from "signal-utils/map";
import { ReactiveOrganizer } from "./organizer";
import {
  Component,
  FastAccess,
  GeneratedAsset,
  GeneratedAssetIdentifier,
  GraphAsset,
  Organizer,
  Project,
  ProjectInternal,
  Tool,
} from "./types";
import { ReactiveFastAccess } from "./fast-access";

export { createProjectState, ReactiveProject };

/**
 * Controls the filter for tools. Use it to tweak what shows up in the "Tools"
 * section of the "@" menu.
 */
function isTool(entry: GraphStoreEntry) {
  return entry.tags?.includes("tool") && !!entry.url;
}

function createProjectState(
  mainGraphId: MainGraphIdentifier,
  store: MutableGraphStore,
  editable?: EditableGraph
): Project {
  return new ReactiveProject(mainGraphId, store, editable);
}

type ReactiveComponents = SignalMap<NodeIdentifier, Component>;

class ReactiveProject implements ProjectInternal {
  #mainGraphId: MainGraphIdentifier;
  #store: MutableGraphStore;
  #editable?: EditableGraph;
  readonly graphAssets: SignalMap<AssetPath, GraphAsset>;
  readonly generatedAssets: SignalMap<GeneratedAssetIdentifier, GeneratedAsset>;
  readonly tools: SignalMap<string, Tool>;
  readonly organizer: Organizer;
  readonly fastAccess: FastAccess;
  readonly components: SignalMap<GraphIdentifier, ReactiveComponents>;

  constructor(
    mainGraphId: MainGraphIdentifier,
    store: MutableGraphStore,
    editable?: EditableGraph
  ) {
    this.#mainGraphId = mainGraphId;
    this.#store = store;
    this.#editable = editable;
    store.addEventListener("update", (event) => {
      if (event.mainGraphId === mainGraphId) {
        this.#updateComponents();
        this.#updateGraphAssets();
      }
      this.#updateTools();
    });
    this.graphAssets = new SignalMap();
    this.tools = new SignalMap();
    this.components = new SignalMap();
    this.generatedAssets = new SignalMap();
    this.organizer = new ReactiveOrganizer(this);
    this.fastAccess = new ReactiveFastAccess(
      this,
      this.graphAssets,
      this.generatedAssets,
      this.tools,
      this.components
    );
    this.#updateGraphAssets();
    this.#updateComponents();
    this.#updateTools();
  }

  async edit(spec: EditSpec[], label: string): Promise<Outcome<void>> {
    const editable = this.#editable;
    if (!editable) {
      return err(
        `Unable to get an editable graph with id "${this.#mainGraphId}"`
      );
    }

    const editing = await editable.edit(spec, label);
    if (!editing.success) {
      return err(editing.error);
    }
  }

  findOutputPortId(
    graphId: GraphIdentifier,
    nodeId: NodeIdentifier
  ): Outcome<{ id: PortIdentifier; title: string }> {
    const inspectable = this.#store.inspect(this.#mainGraphId, graphId);
    if (!inspectable) {
      return err(`Unable to inspect graph with "${this.#mainGraphId}"`);
    }
    const node = inspectable.nodeById(nodeId);
    if (!node) {
      return err(`Unable to find node with id "${nodeId}`);
    }
    const { ports } = node.currentPorts().outputs;
    const mainPort = ports.find((port) =>
      port.schema.behavior?.includes("main-port")
    );
    const result = { id: "", title: node.descriptor.id };
    if (mainPort) {
      result.id = mainPort.name;
      return result;
    }
    const firstPort = ports.at(0);
    if (!firstPort) {
      return err(`Unable to find a port on node with id "${nodeId}`);
    }
    result.id = firstPort.name;
    return result;
  }

  #updateTools() {
    const graphs = this.#store.graphs();
    const tools = graphs.filter(isTool).map<[string, Tool]>((entry) => [
      entry.url!,
      {
        url: entry.url!,
        title: entry.title,
        description: entry.description,
      },
    ]);
    updateMap(this.tools, tools);
  }

  #updateComponents() {
    const mutable = this.#store.get(this.#mainGraphId);
    if (!mutable) return;

    const map = this.components;
    const toDelete = new Set(map.keys());
    const updated = Object.entries(mutable.graphs.graphs());
    updated.push(["", this.#store.inspect(this.#mainGraphId, "")!]);
    updated.forEach(([key, value]) => {
      let currentValue = map.get(key);
      if (!currentValue) {
        currentValue = new SignalMap<NodeIdentifier, Component>();
        map.set(key, currentValue);
      } else {
        toDelete.delete(key);
      }
      updateMap(
        currentValue,
        value.nodes().map((node) => [
          node.descriptor.id,
          {
            id: node.descriptor.id,
            title: node.title(),
            description: node.description(),
          },
        ])
      );
    });

    [...toDelete.values()].forEach((key) => {
      map.delete(key);
    });
  }

  #updateGraphAssets() {
    const mutable = this.#store.get(this.#mainGraphId);
    if (!mutable) return;

    const { assets = {} } = mutable.graph;

    updateMap(
      this.graphAssets,
      Object.entries(assets).map(([path, asset]) => [path, { ...asset, path }])
    );
  }
}

function err($error: string) {
  return { $error };
}

/**
 * Incrementally updates a map, given updated values.
 * Updates the values in `updated`, deletes the ones that aren't in it.
 */
function updateMap<T extends SignalMap>(
  map: T,
  updated: [string, unknown][]
): void {
  const toDelete = new Set(map.keys());

  updated.forEach(([key, value]) => {
    map.set(key, value);
    toDelete.delete(key);
  });

  [...toDelete.values()].forEach((key) => {
    map.delete(key);
  });
}
