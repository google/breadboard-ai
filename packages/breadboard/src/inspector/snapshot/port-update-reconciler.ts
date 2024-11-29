/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphIdentifier, NodeIdentifier } from "@breadboard-ai/types";
import { NodePortChanges } from "./types.js";
import { InspectableNodePorts, InspectablePortList } from "../types.js";

export { PortUpdateReconciler };

type NodePortMap = Map<NodeIdentifier, InspectableNodePorts>;

type PortsUpdate = {
  updated: InspectableNodePorts;
  changes: NodePortChanges;
};

class PortUpdateReconciler {
  #map: Map<GraphIdentifier, NodePortMap> = new Map();

  reconcilePorts(
    incoming: InspectableNodePorts,
    existing?: InspectableNodePorts
  ): PortsUpdate {
    if (!existing) {
      return this.createNewSnapshot(incoming);
    }
    throw new Error("Not implemented");
  }

  createNewSnapshot(incoming: InspectableNodePorts): PortsUpdate {
    return {
      updated: incoming,
      changes: {
        input: toUpdates(incoming.inputs),
        output: toUpdates(incoming.outputs),
        side: toUpdates(incoming.side),
      },
    };

    function toUpdates(ports: InspectablePortList) {
      return {
        fixedChanged: ports.fixed,
        deleted: [],
        added: ports.ports,
        updated: [],
      };
    }
  }

  getChanges(
    graphId: GraphIdentifier,
    nodeId: NodeIdentifier,
    ports: InspectableNodePorts
  ): NodePortChanges {
    let graphPorts = this.#map.get(graphId);
    if (!graphPorts) {
      graphPorts = new Map();
      this.#map.set(graphId, graphPorts);
    }
    const nodePorts = graphPorts.get(nodeId);
    const { updated, changes } = this.reconcilePorts(ports, nodePorts);
    graphPorts.set(nodeId, updated);
    return changes;
  }
}
