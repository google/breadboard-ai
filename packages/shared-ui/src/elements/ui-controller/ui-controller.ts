/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BoardServer,
  EditHistory,
  EditableGraph,
  GraphDescriptor,
  GraphLoader,
  GraphProviderCapabilities,
  GraphProviderExtendedCapabilities,
  InspectableRun,
  InspectableRunInputs,
  Kit,
  NodeIdentifier,
} from "@google-labs/breadboard";
import {
  HTMLTemplateResult,
  LitElement,
  PropertyValues,
  html,
  nothing,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { guard } from "lit/directives/guard.js";
import {
  RecentBoard,
  SETTINGS_TYPE,
  STATUS,
  SettingsStore,
  TopGraphRunResult,
} from "../../types/types.js";
import { styles as uiControllerStyles } from "./ui-controller.styles.js";
import { ModuleEditor } from "../module-editor/module-editor.js";
import { createRef, ref, Ref } from "lit/directives/ref.js";
import {
  CommandsSetSwitchEvent,
  SubGraphChosenEvent,
  ZoomToGraphEvent,
  ZoomToNodeEvent,
} from "../../events/events.js";
import {
  COMMAND_SET_GRAPH_EDITOR,
  COMMAND_SET_MODULE_EDITOR,
  MAIN_BOARD_ID,
} from "../../constants/constants.js";
import { Editor } from "../elements.js";

const MODE_KEY = "bb-ui-controller-outline-mode";

@customElement("bb-ui-controller")
export class UI extends LitElement {
  @property()
  graph: GraphDescriptor | null = null;

  @property()
  editor: EditableGraph | null = null;

  @property()
  subGraphId: string | null = null;

  @property()
  moduleId: string | null = null;

  @property()
  run: InspectableRun | null = null;

  @property()
  inputsFromLastRun: InspectableRunInputs | null = null;

  @property()
  kits: Kit[] = [];

  @property()
  loader: GraphLoader | null = null;

  @property({ reflect: true })
  status = STATUS.RUNNING;

  @property()
  topGraphResult: TopGraphRunResult | null = null;

  @property({ reflect: true })
  failedToLoad = false;

  @property()
  readOnly = false;

  @property()
  showWelcomePanel = false;

  @property()
  version = "dev";

  @property()
  recentBoards: RecentBoard[] = [];

  @property()
  settings: SettingsStore | null = null;

  @property()
  boardServers: BoardServer[] = [];

  @property()
  isShowingBoardActivityOverlay = false;

  @property()
  tabURLs: string[] = [];

  @state()
  history: EditHistory | null = null;

  @property()
  mode: "list" | "tree" = "list";

  #graphEditorRef: Ref<Editor> = createRef();
  #moduleEditorRef: Ref<ModuleEditor> = createRef();
  #zoomToNodeOnNextUpdate: NodeIdentifier | null = null;

  static styles = uiControllerStyles;

  connectedCallback(): void {
    super.connectedCallback();

    const mode = globalThis.localStorage.getItem(MODE_KEY);
    if (mode === "list" || mode === "tree") {
      this.mode = mode;
    }
  }

  editorRender = 0;
  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has("isShowingBoardActivityOverlay")) {
      this.editorRender++;
    }

    if (changedProperties.has("moduleId")) {
      if (this.moduleId === null && this.#moduleEditorRef.value) {
        this.#moduleEditorRef.value.destroyEditor();
      }
    }
  }

  render() {
    const collapseNodesByDefault = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Collapse Nodes by Default")?.value
      : false;

    const showNodeTypeDescriptions = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show Node Type Descriptions")?.value
      : false;

    const showNodePreviewValues = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show Node Preview Values")?.value
      : false;

    const hideSubboardSelectorWhenEmpty = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Hide Embedded Board Selector When Empty")?.value
      : false;

    const invertZoomScrollDirection = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Invert Zoom Scroll Direction")?.value
      : false;

    const showNodeShortcuts = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show Node Shortcuts")?.value
      : false;

    const showPortTooltips = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show Port Tooltips")?.value
      : false;

    const highlightInvalidWires = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Highlight Invalid Wires")?.value
      : false;

    const showExperimentalComponents = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show Experimental Components")?.value
      : false;

    const showSubgraphsInline = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show subgraphs inline")?.value
      : false;

    const showBoardHierarchy = this.settings
      ? this.settings
          .getSection(SETTINGS_TYPE.GENERAL)
          .items.get("Show board hierarchy")?.value
      : false;

    const graph = this.editor?.inspect("") || null;
    let capabilities: false | GraphProviderCapabilities = false;
    let extendedCapabilities: false | GraphProviderExtendedCapabilities = false;
    for (const boardServer of this.boardServers) {
      if (!this.graph || !this.graph.url) {
        continue;
      }

      const canProvide = boardServer.canProvide(new URL(this.graph.url));
      if (canProvide) {
        capabilities = canProvide;
        extendedCapabilities = boardServer.extendedCapabilities();
        break;
      }
    }

    const canUndo = this.history?.canUndo() ?? false;
    const canRedo = this.history?.canRedo() ?? false;

    /**
     * Create all the elements we need.
     */
    const graphEditor = guard(
      [
        graph,
        this.subGraphId,
        this.run,
        this.kits,
        this.topGraphResult,
        this.history,
        this.editorRender,
        this.mode,
        collapseNodesByDefault,
        hideSubboardSelectorWhenEmpty,
        showNodeShortcuts,
        showNodeTypeDescriptions,
        showNodePreviewValues,
        invertZoomScrollDirection,
        showPortTooltips,
        highlightInvalidWires,
        showExperimentalComponents,
        showSubgraphsInline,
        showBoardHierarchy,
      ],
      () => {
        return html`<bb-editor
          ${ref(this.#graphEditorRef)}
          .canRedo=${canRedo}
          .canUndo=${canUndo}
          .capabilities=${capabilities}
          .collapseNodesByDefault=${collapseNodesByDefault}
          .extendedCapabilities=${extendedCapabilities}
          .graph=${graph}
          .kits=${this.kits}
          .hideSubboardSelectorWhenEmpty=${hideSubboardSelectorWhenEmpty}
          .highlightInvalidWires=${highlightInvalidWires}
          .invertZoomScrollDirection=${invertZoomScrollDirection}
          .isShowingBoardActivityOverlay=${this.isShowingBoardActivityOverlay}
          .readOnly=${this.readOnly}
          .run=${this.run}
          .showExperimentalComponents=${showExperimentalComponents}
          .showNodePreviewValues=${showNodePreviewValues}
          .showNodeShortcuts=${showNodeShortcuts}
          .showNodeTypeDescriptions=${showNodeTypeDescriptions}
          .showPortTooltips=${showPortTooltips}
          .showSubgraphsInline=${this.mode === "tree"}
          .showReadOnlyOverlay=${true}
          .subGraphId=${this.subGraphId}
          .moduleId=${this.moduleId}
          .tabURLs=${this.tabURLs}
          .topGraphResult=${this.topGraphResult}
        ></bb-editor>`;
      }
    );

    let welcomePanel: HTMLTemplateResult | symbol = nothing;
    if (this.showWelcomePanel) {
      welcomePanel = html`<bb-welcome-panel
        .version=${this.version}
        .recentBoards=${this.recentBoards}
      ></bb-welcome-panel>`;
    }

    let moduleEditor: HTMLTemplateResult | symbol = nothing;
    if (graph && this.moduleId) {
      moduleEditor = html`<bb-module-editor
        ${ref(this.#moduleEditorRef)}
        .canRedo=${canRedo}
        .canUndo=${canUndo}
        .capabilities=${capabilities}
        .graph=${graph}
        .isShowingBoardActivityOverlay=${this.isShowingBoardActivityOverlay}
        .kits=${this.kits}
        .moduleId=${this.moduleId}
        .modules=${graph.modules() ?? {}}
        .readOnly=${this.readOnly}
        .renderId=${crypto.randomUUID()}
        .run=${this.run}
        .subGraphId=${this.subGraphId}
        .topGraphResult=${this.topGraphResult}
      ></bb-module-editor>`;
    }

    return graph
      ? html`<section id="diagram">
          <bb-splitter
            id="splitter"
            split="[0.2, 0.8]"
            .name=${"outline-editor"}
            .minSegmentSizeHorizontal=${100}
          >
            <div id="outline-container" slot="slot-0">
              <bb-workspace-outline
                .graph=${graph}
                .kits=${this.kits}
                .subGraphId=${this.subGraphId}
                .moduleId=${this.moduleId}
                .renderId=${globalThis.crypto.randomUUID()}
                .mode=${this.mode}
                @bbsubgraphchosen=${(evt: SubGraphChosenEvent) => {
                  if (evt.zoomToNode) {
                    this.#zoomToNodeOnNextUpdate = evt.zoomToNode;
                  }
                }}
                @bboutlinemodechange=${() => {
                  this.mode = this.mode === "list" ? "tree" : "list";
                  if (this.mode === "tree") {
                    this.subGraphId = null;
                  }

                  globalThis.localStorage.setItem(MODE_KEY, this.mode);
                }}
                @bbzoomtograph=${(evt: ZoomToGraphEvent) => {
                  if (!this.#graphEditorRef.value) {
                    return;
                  }

                  this.#graphEditorRef.value.zoomToHighlightedNode = false;
                  this.#graphEditorRef.value.zoomToFit(
                    false,
                    0,
                    evt.id === MAIN_BOARD_ID ? null : evt.id
                  );
                }}
                @bbzoomtonode=${(evt: ZoomToNodeEvent) => {
                  if (!this.#graphEditorRef.value) {
                    return;
                  }

                  this.#graphEditorRef.value.zoomToHighlightedNode = false;
                  this.#graphEditorRef.value.zoomToNode(
                    evt.id,
                    evt.subGraphId,
                    0
                  );
                }}
              ></bb-workspace-outline>
            </div>
            <div id="graph-container" slot="slot-1">
              ${graphEditor} ${this.moduleId ? moduleEditor : nothing}
              ${welcomePanel}
            </div>
          </bb-splitter>
        </section>`
      : html`${graphEditor} ${welcomePanel}`;
  }

  updated() {
    // Inform bb-main which command set is in use. The individual editors are
    // responsible for
    this.dispatchEvent(
      new CommandsSetSwitchEvent(
        this.moduleId ? COMMAND_SET_MODULE_EDITOR : COMMAND_SET_GRAPH_EDITOR
      )
    );

    if (this.#zoomToNodeOnNextUpdate) {
      const zoomToNode = this.#zoomToNodeOnNextUpdate;
      this.#zoomToNodeOnNextUpdate = null;
      requestAnimationFrame(() => {
        if (!this.#graphEditorRef.value) {
          return;
        }
        this.#graphEditorRef.value.zoomToNode(zoomToNode, this.subGraphId, 0);
      });
    }
  }
}
