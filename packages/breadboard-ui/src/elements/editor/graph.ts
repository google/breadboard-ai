/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  InspectableEdge,
  InspectableEdgeType,
  InspectableNode,
  InspectableNodePorts,
  PortStatus,
} from "@google-labs/breadboard";
import * as PIXI from "pixi.js";
import * as Dagre from "@dagrejs/dagre";
import { GraphEdge } from "./graph-edge.js";
import { GraphNode } from "./graph-node.js";
import { GraphNodePort } from "./graph-node-port.js";
import { GRAPH_OPERATIONS, GraphNodePortType } from "./types.js";
import { GraphAssets } from "./graph-assets.js";

const documentStyles = getComputedStyle(document.documentElement);

function getGlobalColor(name: string, defaultValue = "#333333") {
  const value = documentStyles.getPropertyValue(name)?.replace(/^#/, "");
  return parseInt(value || defaultValue, 16);
}

function edgeToString(edge: InspectableEdge): string {
  return `${edge.from.descriptor.id}:${edge.out}->${edge.to.descriptor.id}:${edge.in}`;
}

type LayoutInfo = { x: number; y: number; justAdded?: boolean };

const highlightedNodeColor = getGlobalColor("--bb-output-600");

export class Graph extends PIXI.Container {
  #isDirty = true;
  #edgeContainer = new PIXI.Container();
  #edgeGraphics = new Map<string, GraphEdge>();
  #edges: InspectableEdge[] | null = null;
  #nodes: InspectableNode[] | null = null;
  #ports: Map<string, InspectableNodePorts> | null = null;
  #nodeById = new Map<string, GraphNode>();
  #layout = new Map<string, LayoutInfo>();
  #highlightedNodeId: string | null = null;
  #highlightedNode = new PIXI.Graphics();
  #highlightedNodeColor = highlightedNodeColor;
  #highlightPadding = 8;
  #editable = false;

  collapseNodesByDefault = false;
  layoutRect: DOMRectReadOnly | null = null;

  constructor() {
    super();

    this.eventMode = "static";
    this.sortableChildren = true;

    let lastHoverPort: GraphNodePort | null = null;
    let nodePortBeingEdited: GraphNodePort | null = null;
    let nodePortType: GraphNodePortType | null = null;
    let nodeBeingEdited: GraphNode | null = null;
    let edgeBeingEdited: GraphEdge | null = null;
    let originalEdgeDescriptor: InspectableEdge | null = null;
    let visibleOnNextMove = false;

    this.onRender = () => {
      if (this.#isDirty) {
        this.#isDirty = false;
        this.#drawEdges();
        this.#drawNodes();
        this.#drawNodeHighlight();
      }
    };

    this.addListener("pointerdown", (evt: PIXI.FederatedPointerEvent) => {
      evt.stopPropagation();

      if (evt.target instanceof GraphNode) {
        this.deselectAllChildren();
        this.emit(GRAPH_OPERATIONS.GRAPH_NODE_DETAILS_REQUESTED, evt.target.id);

        evt.target.selected = true;
        return;
      }

      if (evt.target instanceof GraphEdge) {
        this.deselectAllChildren();

        if (evt.target.toNode.collapsed || evt.target.fromNode.collapsed) {
          return;
        }

        evt.target.selected = true;
        return;
      }

      if (!this.editable) {
        return;
      }

      if (evt.target instanceof GraphNodePort) {
        if (!evt.target.editable) {
          return;
        }

        nodePortBeingEdited = evt.target;
        nodeBeingEdited = evt.target.parent as GraphNode;
        nodePortBeingEdited.overrideStatus = PortStatus.Connected;

        switch (nodePortBeingEdited.type) {
          case GraphNodePortType.OUT: {
            originalEdgeDescriptor = {
              from: { descriptor: { id: nodeBeingEdited.label } },
              to: { descriptor: { id: nodeBeingEdited.label } },
              out: nodePortBeingEdited.label,
              in: "*",
            } as InspectableEdge;

            edgeBeingEdited = this.#createTemporaryEdge(originalEdgeDescriptor);
            if (!edgeBeingEdited) {
              return;
            }
            nodePortType = GraphNodePortType.IN;
            break;
          }

          case GraphNodePortType.IN: {
            // Both nodes need to be open before a change can be made. Otherwise
            // we don't know exactly which edge is being edited.
            if (
              edgeBeingEdited &&
              (edgeBeingEdited.toNode.collapsed ||
                edgeBeingEdited.fromNode.collapsed)
            ) {
              edgeBeingEdited = null;
              return;
            }

            nodePortType = GraphNodePortType.IN;
            if (!edgeBeingEdited) {
              originalEdgeDescriptor = {
                from: { descriptor: { id: nodeBeingEdited.label } },
                to: { descriptor: { id: nodeBeingEdited.label } },
                out: "*",
                in: nodePortBeingEdited.label,
              } as InspectableEdge;

              edgeBeingEdited = this.#createTemporaryEdge(
                originalEdgeDescriptor
              );
              if (!edgeBeingEdited) {
                nodePortType = null;
                nodePortBeingEdited = null;
                nodeBeingEdited = null;
                break;
              }
              nodePortType = GraphNodePortType.OUT;
            }

            originalEdgeDescriptor = structuredClone(edgeBeingEdited.edge);
            break;
          }
        }

        if (!edgeBeingEdited || !edgeBeingEdited.temporary) {
          return;
        }

        // Hide the edge initially.
        visibleOnNextMove = false;
        edgeBeingEdited.visible = false;
      }
    });

    this.addListener("globalpointermove", (evt: PIXI.FederatedPointerEvent) => {
      if (!edgeBeingEdited || !nodeBeingEdited || !originalEdgeDescriptor) {
        return;
      }

      if (!edgeBeingEdited.edge) {
        console.warn("Unable to update temporary edge value");
        return;
      }

      if (visibleOnNextMove) {
        edgeBeingEdited.forceRedraw();
        edgeBeingEdited.visible = true;
      }

      const path = evt.composedPath();
      const topTarget = path[path.length - 1];

      if (
        topTarget instanceof GraphNodePort &&
        topTarget.type === nodePortType &&
        visibleOnNextMove
      ) {
        // Snap to nearest port.
        topTarget.overrideStatus = PortStatus.Connected;
        lastHoverPort = topTarget;

        const nodeBeingTargeted = topTarget.parent as GraphNode;

        if (nodePortType === GraphNodePortType.IN) {
          edgeBeingEdited.toNode = nodeBeingTargeted;
          edgeBeingEdited.edge.in = topTarget.label || "";
          edgeBeingEdited.edge.to = {
            descriptor: { id: nodeBeingTargeted.label },
          } as InspectableNode;
        } else {
          edgeBeingEdited.fromNode = nodeBeingTargeted;
          edgeBeingEdited.edge.out = topTarget.label || "";
          edgeBeingEdited.edge.from = {
            descriptor: { id: nodeBeingTargeted.label },
          } as InspectableNode;
        }

        edgeBeingEdited.overrideColor = 0xffa500;
        edgeBeingEdited.overrideInLocation = null;
        edgeBeingEdited.overrideOutLocation = null;
      } else {
        // Track mouse.
        if (nodePortType === GraphNodePortType.IN) {
          edgeBeingEdited.toNode = nodeBeingEdited;
          edgeBeingEdited.edge.in = originalEdgeDescriptor.in;
          edgeBeingEdited.edge.to = originalEdgeDescriptor.to;

          if (!edgeBeingEdited.overrideInLocation) {
            edgeBeingEdited.overrideInLocation =
              nodeBeingEdited.position.clone();
          }

          nodeBeingEdited.toLocal(
            evt.global,
            undefined,
            edgeBeingEdited.overrideInLocation
          );
        } else {
          edgeBeingEdited.fromNode = nodeBeingEdited;
          edgeBeingEdited.edge.out = originalEdgeDescriptor.out;
          edgeBeingEdited.edge.from = originalEdgeDescriptor.from;

          if (!edgeBeingEdited.overrideOutLocation) {
            edgeBeingEdited.overrideOutLocation =
              nodeBeingEdited.position.clone();
          }

          nodeBeingEdited.toLocal(
            evt.global,
            undefined,
            edgeBeingEdited.overrideOutLocation
          );
        }

        edgeBeingEdited.overrideColor = 0xffcc00;

        if (lastHoverPort) {
          lastHoverPort.overrideStatus = null;
          lastHoverPort = null;
        }

        if (!visibleOnNextMove) {
          visibleOnNextMove = true;
        }
      }

      edgeBeingEdited.forceRedraw();
    });

    const onPointerUp = (evt: PIXI.FederatedPointerEvent) => {
      if (!edgeBeingEdited || !edgeBeingEdited.edge) {
        return;
      }

      const path = evt.composedPath();
      const topTarget = path[path.length - 1];

      // Take a copy of the info we need.
      const targetNodePort = nodePortBeingEdited;
      const targetEdge = edgeBeingEdited;
      const targetEdgeDescriptor = structuredClone(
        targetEdge.edge
      ) as InspectableEdge;

      // Clean all the variables.
      nodePortBeingEdited = null;
      nodeBeingEdited = null;
      edgeBeingEdited = null;
      visibleOnNextMove = false;

      let action: GRAPH_OPERATIONS | null = null;
      if (
        !(topTarget instanceof GraphNodePort) ||
        topTarget.type !== nodePortType
      ) {
        action = GRAPH_OPERATIONS.GRAPH_EDGE_DETACH;
      } else if (targetEdge.temporary) {
        action = GRAPH_OPERATIONS.GRAPH_EDGE_ATTACH;
      } else if (originalEdgeDescriptor) {
        action = GRAPH_OPERATIONS.GRAPH_EDGE_CHANGE;
      }

      // Update the edge if either of the nodes is collapsed.
      const disambiguateFrom: string[] = [];
      if (targetEdge.fromNode.collapsed) {
        const commonPorts = (targetEdge.fromNode.outPorts || []).filter(
          (port) => !port.star && port.name !== ""
        );
        if (commonPorts.length === 1) {
          targetEdgeDescriptor.out = commonPorts[0].name;
        } else {
          disambiguateFrom.push(...commonPorts.map((port) => port.name));
        }
      }

      const disambiguateTo: string[] = [];
      if (targetEdge.toNode.collapsed) {
        const commonPorts = (targetEdge.toNode.inPorts || []).filter(
          (port) => !port.star && port.name !== ""
        );
        if (commonPorts.length === 1) {
          targetEdgeDescriptor.in = commonPorts[0].name;
        } else {
          disambiguateTo.push(...commonPorts.map((port) => port.name));
        }
      }

      if (disambiguateFrom.length || disambiguateTo.length) {
        if (targetEdge.temporary) {
          if (targetNodePort) {
            targetNodePort.overrideStatus = null;
          }

          this.#cleanEdges();
        }

        return;
      }

      const edgeKey = edgeToString(targetEdgeDescriptor);
      switch (action) {
        case GRAPH_OPERATIONS.GRAPH_EDGE_DETACH: {
          // Temporary edges don't need to be sent out to the Editor API.
          if (targetEdge.temporary) {
            break;
          }

          this.emit(GRAPH_OPERATIONS.GRAPH_EDGE_DETACH, targetEdgeDescriptor);
          break;
        }

        case GRAPH_OPERATIONS.GRAPH_EDGE_ATTACH: {
          const existingEdge = this.#edgeGraphics.get(edgeKey);
          if (existingEdge) {
            break;
          }

          if (evt.metaKey) {
            targetEdgeDescriptor.type =
              "constant" as InspectableEdgeType.Constant;
          }
          this.emit(GRAPH_OPERATIONS.GRAPH_EDGE_ATTACH, targetEdgeDescriptor);
          break;
        }

        case GRAPH_OPERATIONS.GRAPH_EDGE_CHANGE: {
          targetEdge.overrideColor = null;

          const existingEdge = this.#edgeGraphics.get(edgeKey);
          if (existingEdge) {
            break;
          }

          if (evt.metaKey) {
            targetEdgeDescriptor.type =
              "constant" as InspectableEdgeType.Constant;
          }
          this.emit(
            GRAPH_OPERATIONS.GRAPH_EDGE_CHANGE,
            originalEdgeDescriptor,
            targetEdgeDescriptor
          );
          break;
        }

        default: {
          console.warn("Unable to update edge");
          break;
        }
      }

      targetEdge.overrideColor = null;
      if (targetNodePort) {
        targetNodePort.overrideStatus = null;
      }

      this.#cleanEdges();
    };

    this.addListener("pointerup", onPointerUp);
    this.addListener("pointerupoutside", onPointerUp);
  }

  deselectAllChildren() {
    for (const child of this.children) {
      if (!(child instanceof GraphNode) || !child.selected) {
        continue;
      }

      child.selected = false;
    }

    for (const edge of this.#edgeContainer.children) {
      if (!(edge instanceof GraphEdge) || !edge.selected) {
        continue;
      }

      edge.selected = false;
    }

    this.emit(GRAPH_OPERATIONS.GRAPH_NODE_DETAILS_REQUESTED, null);
  }

  getSelectedChild() {
    for (const child of this.children) {
      if (!(child instanceof GraphNode)) {
        continue;
      }

      if (child.selected) {
        return child;
      }
    }

    for (const edge of this.#edgeContainer.children) {
      if (!(edge instanceof GraphEdge)) {
        continue;
      }

      if (edge.selected) {
        return edge;
      }
    }

    return null;
  }

  getNodeLayoutPositions() {
    return new Map(this.#layout);
  }

  clearNodeLayoutPositions() {
    this.#layout.clear();
  }

  setNodeLayoutPosition(
    node: string,
    position: PIXI.PointData,
    justAdded = false
  ) {
    this.#layout.set(node, { ...this.toLocal(position), justAdded });
  }

  layout() {
    if (!this.#edges) {
      return;
    }

    const g = new Dagre.graphlib.Graph();
    const opts: Partial<Dagre.GraphLabel> = {
      ranksep: 60,
      rankdir: "LR",
      align: "DR",
    };
    if (this.layoutRect) {
      opts.width = Math.floor(this.layoutRect.width);
      opts.height = Math.floor(this.layoutRect.height);
    }

    g.setGraph(opts);
    g.setDefaultEdgeLabel(() => ({}));

    let nodesAdded = 0;
    for (const node of this.children) {
      if (!(node instanceof GraphNode)) {
        continue;
      }

      // Skip any nodes where the layout has already been set by the user.
      if (this.#layout.has(node.id)) {
        continue;
      }
      nodesAdded++;
      g.setNode(node.id, node.dimensions);
    }

    let edgesAdded = 0;
    for (const edge of this.#edges) {
      edgesAdded++;
      g.setEdge(edge.from.descriptor.id, edge.to.descriptor.id);
    }

    // Only run Dagre if there are edges & children to account for. Otherwise
    // it will throw an error.
    if (nodesAdded > 0 && edgesAdded > 0) {
      Dagre.layout(g);

      for (const id of g.nodes()) {
        const data = g.node(id);
        if (!data) {
          continue;
        }

        const { x, y, width, height } = g.node(id);
        this.#layout.set(id, { x: x - width / 2, y: y - height / 2 });
      }
    }

    // Step through any Dagre-set and custom set locations.
    for (const [id, position] of this.#layout) {
      const graphNode = this.#nodeById.get(id);
      if (!graphNode) {
        continue;
      }

      graphNode.position.set(position.x, position.y);
    }

    this.#drawEdges();
  }

  set editable(editable: boolean) {
    const nodes = this.children;
    for (const node of nodes) {
      if (!(node instanceof GraphNode)) {
        continue;
      }

      node.editable = editable;
    }
    this.#editable = editable;
  }

  get editable() {
    return this.#editable;
  }

  set edges(edges: InspectableEdge[] | null) {
    // Validate the edges.
    this.#edges = edges?.filter((edge) => edge.to && edge.from) || null;
    this.#isDirty = true;
  }

  get edges() {
    return this.#edges;
  }

  set nodes(nodes: InspectableNode[] | null) {
    this.#nodes = nodes;
    this.#isDirty = true;
  }

  get nodes() {
    return this.#nodes;
  }

  set ports(ports: Map<string, InspectableNodePorts> | null) {
    this.#ports = ports;
    this.#isDirty = true;
  }

  get ports() {
    return this.#ports;
  }

  set highlightedNodeId(highlightedNodeId: string | null) {
    this.#highlightedNodeId = highlightedNodeId;
    this.#drawNodeHighlight();
  }

  get highlightedNodeId() {
    return this.#highlightedNodeId;
  }

  #onChildMoved(
    this: { graph: Graph; id: string },
    x: number,
    y: number,
    hasSettled: boolean
  ) {
    this.graph.setNodeLayoutPosition(this.id, this.graph.toGlobal({ x, y }));

    this.graph.#drawEdges();
    this.graph.#drawNodeHighlight();

    if (!hasSettled) {
      return;
    }

    // Propagate the move event out to the graph renderer when the cursor is released.
    this.graph.emit(GRAPH_OPERATIONS.GRAPH_NODE_MOVED, this.id, x, y);
  }

  #drawNodeHighlight() {
    if (!this.#nodeById) {
      return;
    }

    if (!this.#highlightedNodeId) {
      this.#highlightedNode.clear();
      return;
    }

    const graphNode = this.#nodeById.get(this.#highlightedNodeId);
    if (!graphNode) {
      this.#highlightedNode.clear();
      return;
    }

    const renderNodeHighlight = () => {
      if (graphNode.width === 0 || graphNode.height === 0) {
        return;
      }

      const { width, height } = graphNode.dimensions;
      this.#highlightedNode.clear();
      this.#highlightedNode.setFillStyle({
        color: this.#highlightedNodeColor,
        alpha: 0.25,
      });
      this.#highlightedNode.beginPath();
      this.#highlightedNode.roundRect(
        graphNode.x - this.#highlightPadding,
        graphNode.y - this.#highlightPadding,
        width + this.#highlightPadding * 2,
        height + this.#highlightPadding * 2,
        graphNode.borderRadius + this.#highlightPadding
      );
      this.#highlightedNode.closePath();
      this.#highlightedNode.fill();

      this.addChildAt(this.#highlightedNode, 0);
    };

    // It's possible this will be called before the graph node has rendered, so
    // if that happens wait for the draw event to fire then try again.
    if (graphNode.width === 0 && graphNode.height === 0) {
      graphNode.once(GRAPH_OPERATIONS.GRAPH_NODE_DRAWN, renderNodeHighlight);
    } else {
      renderNodeHighlight();
    }
  }

  #drawNodes() {
    if (!this.#nodes || !this.#ports) {
      return;
    }

    /**
     * We only position the graph on the initial draw, and we need the graph to
     * be drawn before we can query its dimensions. So we check the layout map,
     * which should only be empty on the first render. We then track each node
     * render, and when all have drawn we notify the graph itself that it can
     * centralize the graph.
     */
    const isInitialDraw = this.#layout.size === 0;
    let nodesLeftToDraw = this.#nodes.length;
    const onDraw = function (this: {
      graphNode: GraphNode;
      layout: LayoutInfo | null;
    }) {
      nodesLeftToDraw--;

      // Freshly added nodes are auto-selected and repositioned to the middle
      // of the drop location.
      if (this.layout && this.layout.justAdded) {
        this.layout.x -= this.graphNode.width / 2;
        this.layout.y -= this.graphNode.height / 2;
        this.layout.justAdded = false;

        this.graphNode.selected = true;
        this.graphNode.position.set(this.layout.x, this.layout.y);
        this.graphNode.parent.emit(
          GRAPH_OPERATIONS.GRAPH_NODE_DETAILS_REQUESTED,
          this.graphNode.label
        );
      }

      if (nodesLeftToDraw === 0) {
        this.graphNode.parent.emit(GRAPH_OPERATIONS.GRAPH_DRAW);

        if (isInitialDraw) {
          this.graphNode.parent.emit(GRAPH_OPERATIONS.GRAPH_INITIAL_DRAW);
        }
      }
    };

    for (const node of this.#nodes) {
      const { id } = node.descriptor;
      let graphNode = this.#nodeById.get(id);
      if (!graphNode) {
        graphNode = new GraphNode(id, node.descriptor.type, node.title());
        graphNode.editable = this.editable;
        graphNode.collapsed = this.collapseNodesByDefault;

        this.#nodeById.set(id, graphNode);
      }

      if (graphNode.title !== node.title()) {
        graphNode.title = node.title();
      }

      const icon = node.type().metadata().icon;
      if (icon && GraphAssets.instance().has(icon)) {
        graphNode.icon = icon;
      }

      if (node.descriptor.metadata?.visual) {
        const { x, y } = node.descriptor.metadata.visual as {
          x: number;
          y: number;
        };

        const pos = this.toGlobal({ x, y });
        this.setNodeLayoutPosition(id, pos);
      }

      const portInfo = this.#ports.get(id);
      if (!portInfo) {
        console.warn(`Unable to locate port info for ${id}`);
        continue;
      }

      graphNode.label = id;
      graphNode.inPorts = portInfo.inputs.ports;
      graphNode.outPorts = portInfo.outputs.ports;

      graphNode.forceUpdateDimensions();
      graphNode.removeAllListeners();
      graphNode.addPointerEventListeners();
      graphNode.on(GRAPH_OPERATIONS.GRAPH_NODE_MOVED, this.#onChildMoved, {
        graph: this,
        id,
      });

      // PIXI doesn't bubble events automatically, so we re-issue the event for
      // requesting the menu to the graph renderer.
      graphNode.on(
        GRAPH_OPERATIONS.GRAPH_NODE_MENU_REQUESTED,
        (graphNode: GraphNode, location: PIXI.ObservablePoint) => {
          this.emit(
            GRAPH_OPERATIONS.GRAPH_NODE_MENU_REQUESTED,
            graphNode,
            location
          );
        }
      );

      graphNode.once(GRAPH_OPERATIONS.GRAPH_NODE_DRAWN, onDraw, {
        graphNode,
        layout: this.#layout.get(id) || null,
      });

      graphNode.on(GRAPH_OPERATIONS.GRAPH_NODE_EXPAND_COLLAPSE, () => {
        this.#redrawAllEdges();
        this.#drawNodeHighlight();
      });
      this.addChild(graphNode);
    }

    // Node has been removed - clean it up.
    if (this.#nodes.length < this.#nodeById.size) {
      for (const [id, graphNode] of this.#nodeById) {
        if (this.#nodes.find((node) => node.descriptor.id === id)) {
          continue;
        }

        graphNode.removeFromParent();
        graphNode.destroy();
        this.#nodeById.delete(id);
        this.#layout.delete(id);
      }
    }
  }

  // TODO: Merge this with below.
  #createTemporaryEdge(edge: InspectableEdge): GraphEdge | null {
    const fromNode = this.#nodeById.get(edge.from.descriptor.id);
    const toNode = this.#nodeById.get(edge.to.descriptor.id);

    if (!(fromNode && toNode)) {
      return null;
    }

    const edgeGraphic = new GraphEdge(fromNode, toNode, true);
    edgeGraphic.edge = edge;
    this.#edgeGraphics.set("__Temporary_Edge", edgeGraphic);
    this.#edgeContainer.addChild(edgeGraphic);

    return edgeGraphic;
  }

  #redrawAllEdges() {
    if (!this.#edges) {
      return;
    }

    for (const edge of this.#edges) {
      const edgeGraphic = this.#edgeGraphics.get(edgeToString(edge));
      if (!edgeGraphic) {
        continue;
      }

      edgeGraphic.forceRedraw();
    }
  }

  #drawEdges() {
    if (!this.#edges) {
      return;
    }

    for (const edge of this.#edges) {
      let edgeGraphic = this.#edgeGraphics.get(edgeToString(edge));
      if (!edgeGraphic) {
        const fromNode = this.#nodeById.get(edge.from.descriptor.id);
        const toNode = this.#nodeById.get(edge.to.descriptor.id);

        // Only create the edge when the nodes are present.
        if (!(fromNode && toNode)) {
          continue;
        }
        edgeGraphic = new GraphEdge(fromNode, toNode);
        edgeGraphic.type = edge.type;

        this.#edgeGraphics.set(edgeToString(edge), edgeGraphic);
        this.#edgeContainer.addChild(edgeGraphic);
      }

      edgeGraphic.edge = edge;
    }

    this.#cleanEdges();

    this.addChildAt(this.#edgeContainer, 0);
  }

  #cleanEdges() {
    if (!this.#edges) {
      return;
    }

    // If there's a mismatch of sizes it likely means an edge has been removed
    // so find that edge and dispose of it.
    if (this.#edgeGraphics.size === this.#edges.length) {
      return;
    }

    for (const [edgeDescription, edgeGraphic] of this.#edgeGraphics) {
      if (this.#edges.find((edge) => edgeToString(edge) === edgeDescription)) {
        continue;
      }

      edgeGraphic.clear();
      edgeGraphic.removeFromParent();
      edgeGraphic.destroy();
      this.#edgeGraphics.delete(edgeDescription);
    }
  }
}
