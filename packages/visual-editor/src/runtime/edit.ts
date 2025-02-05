/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  blankLLMContent,
  defaultModuleContent,
  EditableGraph,
  EditSpec,
  GraphDescriptor,
  GraphLoader,
  GraphProvider,
  InspectableNode,
  Kit,
  MoveToGraphTransform,
  MutableGraphStore,
  NodeConfiguration,
  NodeDescriptor,
  NodeIdentifier,
  PortIdentifier,
  PortStatus,
} from "@google-labs/breadboard";
import {
  EnhanceSideboard,
  Tab,
  TabId,
  WorkspaceSelectionState,
  WorkspaceVisualChangeId,
  WorkspaceVisualState,
} from "./types";
import {
  RuntimeBoardEditEvent,
  RuntimeBoardEnhanceEvent,
  RuntimeErrorEvent,
  RuntimeVisualChangeEvent,
} from "./events";
import {
  CommentNode,
  Edge,
  GraphIdentifier,
  GraphMetadata,
  GraphTag,
  Module,
  ModuleCode,
  ModuleIdentifier,
  ModuleLanguage,
  ModuleMetadata,
  NodeMetadata,
  NodeValue,
} from "@breadboard-ai/types";
import { Sandbox } from "@breadboard-ai/jsandbox";
import { createGraphId, MAIN_BOARD_ID } from "./util";
import * as BreadboardUI from "@breadboard-ai/shared-ui";

// function isGraphDescriptor(source: unknown): source is GraphDescriptor {
//   return (
//     typeof source === "object" &&
//     source !== null &&
//     "edges" in source &&
//     "nodes" in source
//   );
// }

function isModule(source: unknown): source is Module {
  return typeof source === "object" && source !== null && "code" in source;
}

export class Edit extends EventTarget {
  #editors = new Map<TabId, EditableGraph>();

  constructor(
    public readonly providers: GraphProvider[],
    public readonly loader: GraphLoader,
    public readonly kits: Kit[],
    public readonly sandbox: Sandbox,
    public readonly graphStore: MutableGraphStore
  ) {
    super();
  }

  getEditor(tab: Tab | null): EditableGraph | null {
    if (!tab) return null;
    if (!tab.graph) return null;
    if (this.#editors.get(tab.id)) {
      return this.#editors.get(tab.id)!;
    }

    const editor = this.graphStore.editByDescriptor(tab.graph);
    if (!editor) {
      return null;
    }
    editor.addEventListener("graphchange", (evt) => {
      tab.graph = evt.graph;
      this.dispatchEvent(
        new RuntimeBoardEditEvent(
          tab.id,
          // This is wrong, since we lose the graphId here.
          // TODO: Propagate graphId out to listeners of
          // RuntimeBoardEditEvent.
          evt.visualOnly ? [] : evt.affectedNodes.map((node) => node.id),
          evt.visualOnly
        )
      );
    });

    editor.addEventListener("graphchangereject", (evt) => {
      tab.graph = evt.graph;

      const { reason } = evt;
      if (reason.type === "error") {
        this.dispatchEvent(new RuntimeErrorEvent(reason.error));
      }
    });

    this.#editors.set(tab.id, editor);
    return editor;
  }

  getHistory(tab: Tab | null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return editableGraph.history();
  }

  getGraphComment(
    tab: Tab | null,
    id: string,
    subGraphId: string | null = null
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return (
      editableGraph
        .inspect(subGraphId)
        .metadata()
        ?.comments?.find((comment) => comment.id === id) ?? null
    );
  }

  getNodeTitle(tab: Tab | null, id: string, subGraphId: string | null = null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return editableGraph.inspect(subGraphId).nodeById(id)?.title() ?? null;
  }

  getNodeCurrentMetadata(
    tab: Tab | null,
    id: string,
    subGraphId: string | null = null
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return (
      editableGraph
        .inspect(subGraphId)
        .nodeById(id)
        ?.type()
        .currentMetadata() ?? null
    );
  }

  getNodeType(tab: Tab | null, id: string, subGraphId: string | null = null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return (
      editableGraph.inspect(subGraphId).nodeById(id)?.type().type() ?? null
    );
  }

  getNodeMetadata(
    tab: Tab | null,
    id: string,
    subGraphId: string | null = null
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return editableGraph.inspect(subGraphId).nodeById(id)?.metadata() ?? null;
  }

  getNodeConfiguration(
    tab: Tab | null,
    id: string,
    subGraphId: string | null = null
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return (
      editableGraph.inspect(subGraphId).nodeById(id)?.configuration() ?? null
    );
  }

  getNodePorts(tab: Tab | null, id: string, subGraphId: string | null = null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return editableGraph.inspect(subGraphId).nodeById(id)?.ports() ?? null;
  }

  canUndo(tab: Tab | null): boolean {
    if (!tab) {
      return false;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return false;
    }

    const history = editableGraph.history();
    return history.canUndo();
  }

  undo(tab: Tab | null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    const history = editableGraph.history();
    return history.undo();
  }

  canRedo(tab: Tab | null) {
    if (!tab) {
      return false;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return false;
    }

    const history = editableGraph.history();
    return history.canRedo();
  }

  redo(tab: Tab | null) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    const history = editableGraph.history();
    return history.redo();
  }

  async updateSubBoardInfo(
    tab: Tab | null,
    subGraphId: string,
    title: string,
    version: string,
    description: string,
    status: "published" | "draft" | null,
    isTool: boolean | null,
    isComponent: boolean | null
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(
        new RuntimeErrorEvent("Unable to edit subboard; no active board")
      );
      return;
    }

    const subGraph = editableGraph.raw().graphs?.[subGraphId];
    if (!subGraph) {
      this.dispatchEvent(
        new RuntimeErrorEvent(`Unable to find subboard with id ${subGraphId}`)
      );
      return;
    }

    const subGraphDescriptor = subGraph;
    this.#updateGraphValues(
      subGraphDescriptor,
      title,
      version,
      description,
      status,
      isTool,
      isComponent
    );

    await editableGraph.edit(
      [
        { type: "removegraph", id: subGraphId },
        { type: "addgraph", id: subGraphId, graph: subGraphDescriptor },
      ],
      `Replacing graph "${title}"`
    );

    // editableGraph.replaceGraph(subGraphId, subGraphDescriptor);
  }

  async updateModuleInfo(
    tab: Tab | null,
    moduleId: string,
    title: string,
    description: string
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(
        new RuntimeErrorEvent("Unable to edit module; no active board")
      );
      return;
    }

    const module = editableGraph.inspect("").moduleById(moduleId);
    if (!module) {
      return null;
    }

    const code = module.code();
    const metadata = { ...module.metadata() };

    metadata.title = title;
    metadata.description = description;

    this.editModule(tab, moduleId, code, metadata);
  }

  deleteComment(tab: Tab | null, id: string) {
    if (!tab) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find tab"));
      return null;
    }

    const graph = tab.graph;
    graph.metadata ??= {};
    graph.metadata.comments ??= [];

    graph.metadata.comments = graph.metadata.comments.filter(
      (comment) => comment.id !== id
    );
    this.dispatchEvent(new RuntimeBoardEditEvent(tab.id, [], false));
  }

  async copyBoardItem(
    tab: Tab | null,
    type: "graph" | "module",
    id: GraphIdentifier | ModuleIdentifier,
    title: string
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    const edits: EditSpec[] = [];
    switch (type) {
      case "graph": {
        const graph = editableGraph.raw().graphs?.[id];
        if (!graph) {
          console.warn(
            `Issued copy request for "${id}", but no such graph was found`
          );
          break;
        }

        const newGraph = structuredClone(graph);
        newGraph.title = title;

        const newId = crypto.randomUUID();
        edits.push({ type: "addgraph", graph: newGraph, id: newId });
        break;
      }

      case "module": {
        const module = editableGraph.raw().modules?.[id];
        if (!module) {
          console.warn(
            `Issued copy request for "${id}", but no such module was found`
          );
          break;
        }

        const newModule = structuredClone(module);
        newModule.metadata ??= {};
        newModule.metadata.title = title;

        const newId = crypto.randomUUID();
        edits.push({ type: "addmodule", module: newModule, id: newId });
        break;
      }

      default:
        throw new Error(`Unexpected copy type ${type}`);
    }

    if (!edits.length) {
      return;
    }

    return editableGraph.edit(edits, `Copying to ${title} (${type})`);
  }

  async createWorkspaceItem(
    tab: Tab | null,
    type: "declarative" | "imperative",
    title: string | null,
    settings: BreadboardUI.Types.SettingsStore | null
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    title ??= "Untitled item";

    const edits: EditSpec[] = [];
    switch (type) {
      case "declarative": {
        const id: string = crypto.randomUUID();
        const board: GraphDescriptor | undefined = undefined;
        // TODO: Figure out what this code was supposed to do.
        // if (source) {
        //   if (typeof source === "string" || source instanceof URL) {
        //     try {
        //       const sourceResponse = await fetch(source);
        //       board = await sourceResponse.json();
        //     } catch (err) {
        //       console.warn(err);
        //       return;
        //     }
        //   } else if (isGraphDescriptor(source)) {
        //     board = source;
        //   }
        // }
        await this.createSubGraph(tab, title, id, board);
        break;
      }

      case "imperative": {
        const id = title.replace(/[^a-zA-Z0-9]/g, "-");
        let source: Module | undefined = undefined;
        const createAsTypeScript =
          settings
            ?.getSection(BreadboardUI.Types.SETTINGS_TYPE.GENERAL)
            .items.get("Use TypeScript as Module default language")?.value ??
          false;

        if (createAsTypeScript) {
          source = {
            code: "",
            metadata: {
              title,
              source: {
                code: defaultModuleContent("typescript"),
                language: "typescript",
              },
            },
          };
        } else {
          source = {
            code: defaultModuleContent(),
            metadata: {
              title,
            },
          };
        }

        let module: Module | undefined = undefined;
        if (source) {
          if (typeof source === "string" || source instanceof URL) {
            try {
              const sourceResponse = await fetch(source);
              module = await sourceResponse.json();
            } catch (err) {
              console.warn(err);
              return;
            }
          } else if (isModule(source)) {
            module = source;
          }
        }

        if (!module) {
          module = { code: defaultModuleContent(), metadata: { title } };
        }

        this.createModule(tab, id, module);
        break;
      }

      default:
        throw new Error(`Unexpected copy type ${type}`);
    }

    if (!edits.length) {
      return;
    }

    return editableGraph.edit(edits, `Copying to ${title} (${type})`);
  }

  async createModule(
    tab: Tab | null,
    moduleId: ModuleIdentifier,
    module: Module = { code: defaultModuleContent("javascript") },
    switchToCreatedModule = true
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    return editableGraph
      .edit(
        [
          {
            type: "addmodule",
            id: moduleId,
            module,
          },
        ],
        `Add module ${moduleId}`
      )
      .then(() => {
        if (!switchToCreatedModule) {
          return;
        }

        tab.moduleId = moduleId;
      });
  }

  async deleteModule(tab: Tab | null, moduleId: ModuleIdentifier) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    const result = await editableGraph.edit(
      [
        {
          type: "removemodule",
          id: moduleId,
        },
      ],
      `Delete module ${moduleId}`
    );

    if (!result.success) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to delete module"));
      return;
    }

    if (tab.moduleId === moduleId) {
      tab.moduleId = null;
    }
  }

  changeModuleLanguage(
    tab: Tab | null,
    moduleId: ModuleIdentifier,
    language: ModuleLanguage
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    const module = editableGraph.inspect("").moduleById(moduleId);
    if (!module) {
      return null;
    }

    const newModule: Module = {
      code: module.code(),
      metadata: module.metadata(),
    };

    if (!newModule.metadata) {
      return null;
    }

    switch (language) {
      case "typescript": {
        if (newModule.metadata.source?.language === "typescript") {
          console.warn("Attempt to convert TypeScript module to TypeScript");
          return null;
        }

        newModule.metadata.source = {
          code: module.code(),
          language: "typescript",
        };
        break;
      }

      case "javascript": {
        if (newModule.metadata.source?.language === "javascript") {
          console.warn("Attempt to convert JavaScript module to JavaScript");
          return null;
        }

        // Apply the existing code to the root value and remove the metadata
        // source.
        if (newModule.metadata.source?.code) {
          newModule.code = newModule.metadata.source?.code;
        }

        delete newModule.metadata.source;
        break;
      }
    }

    this.editModule(tab, moduleId, newModule.code, newModule.metadata);
  }

  editModule(
    tab: Tab | null,
    moduleId: ModuleIdentifier,
    moduleCode: ModuleCode,
    moduleMetadata: ModuleMetadata
  ) {
    if (!tab) {
      return null;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    editableGraph.edit(
      [
        {
          type: "changemodule",
          id: moduleId,
          module: {
            code: moduleCode,
            metadata: moduleMetadata,
          },
        },
      ],
      `Update module ${moduleId}`
    );
  }

  toggleExport(
    tab: Tab,
    id: ModuleIdentifier | GraphIdentifier,
    exportType: "imperative" | "declarative"
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit graph"));
      return null;
    }

    editableGraph.edit(
      [{ type: "toggleexport", exportType, id }],
      `Toggle export for ${exportType} graph "${id}"`
    );
  }

  updateBoardInfo(
    tab: Tab | null,
    title: string,
    version: string,
    description: string,
    status: "published" | "draft" | null,
    isTool: boolean | null,
    isComponent: boolean | null
  ) {
    if (!tab) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find tab"));
      return null;
    }

    this.#updateGraphValues(
      tab.graph,
      title,
      version,
      description,
      status,
      isTool,
      isComponent
    );
  }

  #updateGraphValues(
    graph: GraphDescriptor,
    title: string,
    version: string,
    description: string,
    status: "published" | "draft" | null,
    isTool: boolean | null,
    isComponent: boolean | null
  ) {
    graph.title = title;
    graph.version = version;
    graph.description = description;

    if (status) {
      graph.metadata ??= {};
      graph.metadata.tags ??= [];

      switch (status) {
        case "published": {
          if (!graph.metadata.tags.includes("published")) {
            graph.metadata.tags.push("published");
          }
          break;
        }

        case "draft": {
          graph.metadata.tags = graph.metadata.tags.filter(
            (tag) => tag !== "published"
          );
          break;
        }
      }
    }

    updateTag("tool", isTool);
    updateTag("component", isComponent);

    // TODO: Plumb Tab ID here.
    this.dispatchEvent(new RuntimeBoardEditEvent(null, [], false));

    function updateTag(tagName: GraphTag, value: boolean | null) {
      if (value !== null) {
        graph.metadata ??= {};
        graph.metadata.tags ??= [];

        if (value) {
          if (!graph.metadata.tags.includes(tagName)) {
            graph.metadata.tags.push(tagName);
          }
        } else {
          graph.metadata.tags = graph.metadata.tags.filter(
            (tag) => tag !== tagName
          );
        }
      }
    }
  }

  async createSubGraph(
    tab: Tab | null,
    subGraphTitle: string,
    id: GraphIdentifier = globalThis.crypto.randomUUID(),
    board = blankLLMContent()
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to create sub board"));
      return;
    }

    board.title = subGraphTitle;

    const editResult = await editableGraph.edit(
      [{ type: "addgraph", graph: board, id }],
      `Adding subgraph ${subGraphTitle}`
    );
    if (!editResult.success) {
      return null;
    }

    return id;
  }

  async deleteSubGraph(tab: Tab | null, subGraphId: string) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to delete sub board"));
      return;
    }

    const editResult = await editableGraph.edit(
      [{ type: "removegraph", id: subGraphId }],
      `Removing subgraph $"{subGraphId}"`
    );
    if (!editResult.success) {
      return null;
    }

    if (subGraphId === tab?.subGraphId) {
      tab.subGraphId = null;
    }
  }

  async createReference(
    tab: Tab | null,
    graphId: GraphIdentifier,
    nodeId: NodeIdentifier,
    portId: PortIdentifier,
    value: NodeValue
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to edit"));
      return;
    }

    if (graphId === MAIN_BOARD_ID) {
      graphId = "";
    }

    if (typeof value === "string") {
      // Convert to `UnresolvedPathBoardCapability`, so that it is resolved
      // at runtime.
      // This is important for ensuring that relative URLs are resolved
      // relative to where they are invoked from, rather than to where they
      // are used.
      value = { kind: "board", path: value };
    }

    const node = editableGraph.inspect(graphId).nodeById(nodeId);
    const port = node
      ?.currentPorts()
      .inputs.ports.find((port) => port.name === portId);
    const config = node?.configuration();
    if (!config || !port) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to create reference"));
      return;
    }

    const newConfigurationPart: NodeValue = structuredClone({
      [portId]: config[portId],
    });

    if (!newConfigurationPart[portId]) {
      if (port.type.schema.type === "array") {
        newConfigurationPart[portId] = [value];
      } else {
        newConfigurationPart[portId] = value;
      }
    } else {
      if (Array.isArray(newConfigurationPart[portId])) {
        if (newConfigurationPart[portId].includes(value)) {
          this.dispatchEvent(new RuntimeErrorEvent("Reference already exists"));
          return;
        }

        newConfigurationPart[portId].push(value);
      } else {
        if (port.type.schema.type === "array") {
          newConfigurationPart[portId] = [value];
        } else {
          newConfigurationPart[portId] = value;
        }
      }
    }

    return this.changeNodeConfigurationPart(
      tab,
      nodeId,
      newConfigurationPart,
      graphId === "" ? null : graphId
    );
  }

  async processVisualChange(
    tab: Tab | null,
    visualChangeId: WorkspaceVisualChangeId,
    graphId: GraphIdentifier,
    visual: GraphMetadata["visual"]
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to delete sub board"));
      return;
    }

    const edits: EditSpec[] = [];
    if (graphId === MAIN_BOARD_ID) {
      graphId = "";
    }

    const metadata = editableGraph.inspect(graphId).metadata() ?? {};
    const currentVisual = { ...metadata.visual, ...visual };
    metadata.visual = currentVisual;

    // Only subgraphs can be minimized.
    if (graphId === "") {
      delete currentVisual.minimized;
    }

    edits.push({
      type: "changegraphmetadata",
      graphId,
      metadata,
    });

    await editableGraph.edit(edits, visualChangeId);

    this.dispatchEvent(new RuntimeVisualChangeEvent(visualChangeId));
  }

  async processVisualChanges(
    tab: Tab | null,
    visualChangeId: WorkspaceVisualChangeId,
    visualState: WorkspaceVisualState
  ) {
    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to delete sub board"));
      return;
    }

    const edits: EditSpec[] = [];
    for (const [subGraphId, graphVisualState] of visualState) {
      let graphId = "";
      if (subGraphId !== MAIN_BOARD_ID) {
        graphId = subGraphId;
      }

      if (graphVisualState.graph) {
        const metadata = editableGraph.inspect(graphId).metadata() ?? {};
        const visual = { ...metadata.visual, ...graphVisualState.graph.visual };
        metadata.visual = visual;

        // Only subgraphs can be minimized.
        if (graphId === "") {
          delete metadata.visual.minimized;
        }

        edits.push({
          type: "changegraphmetadata",
          graphId,
          metadata,
        });
      }

      for (const [id, entityVisualState] of graphVisualState.nodes) {
        switch (entityVisualState.type) {
          case "comment": {
            const graphMetadata =
              editableGraph.inspect(graphId).metadata() ?? {};
            const commentNode = graphMetadata.comments?.find(
              (commentNode) => commentNode.id === id
            );

            if (commentNode && commentNode.metadata) {
              commentNode.metadata.visual = {
                x: entityVisualState.x,
                y: entityVisualState.y,
                collapsed: entityVisualState.expansionState,
                outputHeight: entityVisualState.outputHeight ?? 0,
              };
            }
            break;
          }

          case "node": {
            const existingMetadata =
              editableGraph.inspect(graphId).nodeById(id)?.metadata() ?? {};

            edits.push({
              type: "changemetadata",
              graphId,
              id: id,
              metadata: {
                ...existingMetadata,
                visual: {
                  x: entityVisualState.x,
                  y: entityVisualState.y,
                  collapsed: entityVisualState.expansionState,
                  outputHeight: entityVisualState.outputHeight ?? 0,
                },
              },
            });
          }
        }
      }
    }

    await editableGraph.edit(edits, visualChangeId);

    this.dispatchEvent(new RuntimeVisualChangeEvent(visualChangeId));
  }

  changeEdge(
    tab: Tab | null,
    changeType: "add" | "remove" | "move",
    from: {
      from: string;
      to: string;
      in: string;
      out: string;
      constant?: boolean;
    },
    to?: {
      from: string;
      to: string;
      in: string;
      out: string;
      constant?: boolean;
    },
    subGraphId: string | null = null
  ) {
    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    switch (changeType) {
      case "add": {
        editableGraph.edit(
          [{ type: "addedge", edge: from, graphId }],
          `Add edge between ${from.from} and ${from.to}`
        );
        break;
      }

      case "remove": {
        editableGraph.edit(
          [{ type: "removeedge", edge: from, graphId }],
          `Remove edge between ${from.from} and ${from.to}`
        );
        break;
      }

      case "move": {
        if (!to) {
          this.dispatchEvent(
            new RuntimeErrorEvent("Unable to move edge - no `to` provided")
          );
          return;
        }

        editableGraph.edit(
          [
            {
              type: "changeedge",
              from: from,
              to: to,
              graphId,
            },
          ],
          `Change edge from between ${from.from} and ${from.to} to ${to.from} and ${to.to}`
        );
        break;
      }
    }
  }

  async createNode(
    tab: Tab | null,
    id: string,
    nodeType: string,
    configuration: NodeConfiguration | null = null,
    metadata: NodeMetadata | null = null,
    subGraphId: string | null = null
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    const inspectableGraph = editableGraph.inspect(subGraphId);
    const title = (await inspectableGraph.typeById(nodeType)?.metadata())
      ?.title;

    if (title) {
      metadata ??= {};
      metadata.title = title;
    }

    const newNode = {
      id,
      type: nodeType,
      metadata: metadata || undefined,
      configuration: configuration || undefined,
    };

    // Comment nodes are stored in the metadata for the graph
    if (nodeType === "comment") {
      if (!metadata) {
        return;
      }

      const graphMetadata = inspectableGraph.metadata() || {};
      graphMetadata.comments = graphMetadata.comments || [];
      graphMetadata.comments.push({
        id,
        text: "",
        metadata,
      });

      editableGraph.edit(
        [{ type: "changegraphmetadata", metadata: graphMetadata, graphId }],
        `Change metadata for graph - add comment "${id}"`
      );
      return;
    }

    editableGraph.edit(
      [{ type: "addnode", node: newNode, graphId }],
      `Add node ${id}`
    );
  }

  updateNodeMetadata(
    tab: Tab | null,
    id: NodeIdentifier,
    metadata: NodeDescriptor["metadata"],
    subGraphId: string | null = null
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    const inspectableGraph = editableGraph.inspect(subGraphId);
    const existingNode = inspectableGraph.nodeById(id);
    const existingMetadata = existingNode?.metadata() || {};
    const newMetadata = {
      ...existingMetadata,
      ...metadata,
    };

    editableGraph.edit(
      [{ type: "changemetadata", id, metadata: newMetadata, graphId }],
      `Change metadata for "${id}"`
    );
  }

  async multiEdit(tab: Tab | null, edits: EditSpec[], description: string) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);

    if (!editableGraph) {
      console.warn("Unable to multi-edit; no active graph");
      return;
    }

    return editableGraph.edit(edits, description);
  }

  changeComment(
    tab: Tab | null,
    id: string,
    text: string,
    subGraphId: string | null = null
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    const inspectableGraph = editableGraph.inspect(subGraphId);
    const graphMetadata = inspectableGraph.metadata() || {};
    graphMetadata.comments ??= [];

    const comment = graphMetadata.comments.find((comment) => comment.id === id);
    if (!comment) {
      console.warn("Unable to update comment; not found");
      return;
    }

    comment.text = text;
    editableGraph.edit(
      [{ type: "changegraphmetadata", metadata: graphMetadata, graphId }],
      `Change metadata for graph - add comment "${id}"`
    );
  }

  changeNodeConfiguration(
    tab: Tab | null,
    id: string,
    configuration: NodeConfiguration,
    subGraphId: string | null = null
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    editableGraph.edit(
      [
        {
          type: "changeconfiguration",
          id,
          configuration,
          reset: true,
          graphId,
        },
      ],
      `Change configuration for "${id}"`
    );
  }

  async enhanceNodeConfiguration(
    tab: Tab | null,
    subGraphId: string | null,
    id: string,
    sideboard: EnhanceSideboard,
    property?: string,
    value?: NodeValue
  ) {
    if (!tab) {
      return;
    }

    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    const inspectableNode = editableGraph.inspect(graphId).nodeById(id);
    const configuration = structuredClone(
      inspectableNode?.descriptor.configuration ?? {}
    );

    // If there is a value to use over and above the current configuration
    // value we apply it here.
    if (property && value) {
      configuration[property] = value;
    }

    const result = await sideboard.enhance(configuration);

    if (!result.success) {
      this.dispatchEvent(
        new RuntimeErrorEvent(`Enhancing failed with error: ${result.error}`)
      );
      return;
    }

    this.dispatchEvent(
      new RuntimeBoardEnhanceEvent(tab.id, [id], result.result)
    );
  }

  async changeNodeConfigurationPart(
    tab: Tab | null,
    id: string,
    configurationPart: NodeConfiguration,
    subGraphId: string | null = null,
    metadata: NodeMetadata | null = null,
    ins: { path: string; title: string }[] | null = null
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    const inspectableNode = editableGraph.inspect(graphId).nodeById(id);
    const configuration = inspectableNode?.descriptor.configuration ?? {};
    const updatedConfiguration = structuredClone(configuration);
    for (const [key, value] of Object.entries(configurationPart)) {
      if (value === null || value === undefined) {
        delete updatedConfiguration[key];
        continue;
      }

      updatedConfiguration[key] = value;
    }

    const edits: EditSpec[] = [
      {
        type: "changeconfiguration",
        id: id,
        configuration: updatedConfiguration,
        reset: true,
        graphId,
      },
    ];

    if (metadata) {
      const existingMetadata = inspectableNode?.metadata() || {};
      const newMetadata = {
        ...existingMetadata,
        ...metadata,
      };

      edits.push({
        type: "changemetadata",
        id,
        metadata: newMetadata,
        graphId,
      }),
        `Change metadata for "${id}"`;
    }

    if (inspectableNode && ins && ins.length > 0) {
      // TODO: Don't forget about proper title->id conversion.
      const incoming = dedupeEdges(
        ins
          .map((v) => {
            const out = getDefaultOutputPort(
              editableGraph.inspect(graphId).nodeById(v.path)
            );
            if (!out) return null;
            return {
              from: v.path,
              to: inspectableNode.descriptor.id,
              out,
              in: `p-z-${v.title}`,
            };
          })
          .filter(Boolean) as Edge[]
      );
      console.group("UPDATE AUTOWIRES");
      console.log("Icoming:");
      console.table(incoming);

      const current = inspectableNode
        .currentPorts()
        .inputs.ports.filter(
          (port) =>
            !port.star &&
            !port.configured &&
            port.status == PortStatus.Connected &&
            port.name.startsWith("p-z-")
        )
        .flatMap((port) => port.edges?.map((edge) => edge.raw()) || []);
      console.log("Current:");
      console.table(current);

      const diff = computeEdgeDiff(current, incoming);
      console.log("Insert:");
      console.table(diff.toInsert);
      console.log("Delete:");
      console.table(diff.toDelete);
      console.groupEnd();

      diff.toInsert.forEach((edge) => {
        edits.push({
          type: "addedge",
          edge,
          graphId,
        });
      });

      diff.toDelete.forEach((edge) => {
        edits.push({
          type: "removeedge",
          edge,
          graphId,
        });
      });
    }

    return editableGraph.edit(
      edits,
      `Change partial configuration for "${id}"`
    );

    function dedupeEdges(edges: Edge[]) {
      const seen = new Set<string>();
      return edges.filter((edge) => {
        const key = edgeKey(edge);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function computeEdgeDiff(current: Edge[], incoming: Edge[]) {
      const currentMap = new Map<string, Edge>();
      const incomingMap = new Map<string, Edge>();

      current.forEach((edge) => {
        currentMap.set(edgeKey(edge), edge);
      });
      incoming.forEach((edge) => {
        incomingMap.set(edgeKey(edge), edge);
      });

      const toDelete: Edge[] = [];
      const toInsert: Edge[] = [];

      current.forEach((edge) => {
        const key = edgeKey(edge);
        if (!incomingMap.has(key)) {
          toDelete.push(edge);
        }
      });

      incoming.forEach((edge) => {
        const key = edgeKey(edge);
        if (!currentMap.has(key)) {
          toInsert.push(edge);
        }
      });

      return { toInsert, toDelete };
    }

    function edgeKey(edge: Edge) {
      return JSON.stringify(edge);
    }

    function getDefaultOutputPort(from: InspectableNode | undefined) {
      if (!from) return;
      const ports = from.currentPorts().outputs.ports;
      const mainPort = ports.find((port) =>
        port.schema.behavior?.includes("main-port")
      );
      if (mainPort) return mainPort.name;
      return ports.find((port) => !port.star && !port.name.startsWith("$"))
        ?.name;
    }
  }

  async moveToNewGraph(
    tab: Tab | null,
    selectionState: WorkspaceSelectionState,
    targetGraphId: GraphIdentifier | null,
    delta: { x: number; y: number }
  ) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    targetGraphId = targetGraphId ?? createGraphId();
    const inspectableTargetGraphId =
      targetGraphId === MAIN_BOARD_ID ? "" : targetGraphId;

    const edits: EditSpec[] = [];
    const commentsForTargetGraph: CommentNode[] = [];
    const nodeIds: NodeIdentifier[] = [];

    let hasEdited = false;
    for (const [sourceGraphId, sourceGraph] of selectionState.graphs) {
      const inspectableSourceGraphId =
        sourceGraphId === MAIN_BOARD_ID ? "" : sourceGraphId;
      // Make the new graph if needed.
      if (
        targetGraphId !== MAIN_BOARD_ID &&
        (!editableGraph.raw().graphs ||
          !editableGraph.raw().graphs?.[targetGraphId])
      ) {
        await editableGraph.edit(
          [
            {
              type: "addgraph",
              id: targetGraphId,
              graph: { nodes: [], edges: [], title: "New Board" },
            },
          ],
          "Create new graph"
        );
      }

      // Skip transforms where the target is the same as the source.
      if (inspectableTargetGraphId === inspectableSourceGraphId) {
        continue;
      }

      hasEdited = true;

      if (sourceGraph.comments.size > 0) {
        const metadata =
          editableGraph.inspect(inspectableSourceGraphId).metadata() ?? {};
        const comments = metadata.comments ?? [];
        const graphCommentsAfterEdit: CommentNode[] = [];
        for (const comment of comments) {
          if (sourceGraph.comments.has(comment.id)) {
            const newComment = structuredClone(comment);
            commentsForTargetGraph.push(newComment);
            newComment.metadata ??= {};
            newComment.metadata.visual ??= { x: 0, y: 0 };

            const visual = newComment.metadata.visual as Record<string, number>;
            visual.x += delta.x;
            visual.y += delta.y;
          } else {
            graphCommentsAfterEdit.push(comment);
          }
        }

        // Update the graph's comments.
        metadata.comments = graphCommentsAfterEdit;
        edits.push({
          type: "changegraphmetadata",
          graphId: inspectableSourceGraphId,
          metadata,
        });
      }

      // Track the nodes seen so that we can update their location values.
      nodeIds.push(...sourceGraph.nodes);

      // Transform all the selected nodes into it.
      const transform = new MoveToGraphTransform(
        [...sourceGraph.nodes],
        inspectableSourceGraphId,
        inspectableTargetGraphId
      );

      const result = await editableGraph.apply(transform);
      if (!result.success) {
        this.dispatchEvent(new RuntimeErrorEvent("Unable to transform board"));
        return;
      }
    }

    if (!hasEdited) {
      return;
    }

    // Now go through each one and adjust it by the left-most position and
    // the cursor position.
    for (const nodeId of nodeIds) {
      const node = editableGraph
        .inspect(inspectableTargetGraphId)
        .nodeById(nodeId);
      if (!node) {
        continue;
      }

      const metadata = node.metadata();
      const visual = (metadata.visual ?? {}) as Record<string, number>;

      visual.x += delta.x;
      visual.y += delta.y;

      edits.push({
        type: "changemetadata",
        id: nodeId,
        graphId: inspectableTargetGraphId,
        metadata,
      });
    }

    // Carry any existing comments.
    const inspectableTargetGraph = editableGraph.inspect(
      inspectableTargetGraphId
    );
    commentsForTargetGraph.push(
      ...(inspectableTargetGraph.metadata()?.comments ?? [])
    );

    // Finally set comments.
    edits.push({
      type: "changegraphmetadata",
      graphId: inspectableTargetGraphId,
      metadata: {
        comments: commentsForTargetGraph,
      },
    });

    await editableGraph.edit(edits, "Location updates");
  }

  deleteNode(tab: Tab | null, id: string, subGraphId: string | null = null) {
    if (tab?.readOnly) {
      return;
    }

    const editableGraph = this.getEditor(tab);
    const graphId = subGraphId || "";

    if (!editableGraph) {
      this.dispatchEvent(new RuntimeErrorEvent("Unable to find board to edit"));
      return;
    }

    editableGraph.edit(
      [{ type: "removenode", id, graphId }],
      `Remove node ${id}`
    );
  }
}
