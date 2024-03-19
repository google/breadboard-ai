/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileStorage } from "./file-storage/file-storage.js";
import { run, RunConfig } from "@google-labs/breadboard/harness";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement, html, css, HTMLTemplateResult, nothing } from "lit";
import * as BreadboardUI from "@google-labs/breadboard-ui";
import { InputResolveRequest } from "@google-labs/breadboard/remote";
import {
  Board,
  BoardRunner,
  edit,
  EditResult,
  GraphDescriptor,
  InspectableRun,
  InspectableRunObserver,
  Kit,
} from "@google-labs/breadboard";
import { cache } from "lit/directives/cache.js";
import { classMap } from "lit/directives/class-map.js";
import { createRunObserver } from "@google-labs/breadboard";
import { loadKits } from "./utils/kit-loader";
import GeminiKit from "@google-labs/gemini-kit";

const getBoardInfo = async (
  url: string
): Promise<BreadboardUI.Types.LoadArgs> => {
  const runner = await Board.load(url, {
    base: new URL(window.location.href),
    graphProviders: [FileStorage.instance()],
  });

  const { title, description, version } = runner;
  const diagram = runner.mermaid("TD", true, true);
  const nodes = runner.nodes;
  const graphDescriptor: GraphDescriptor = runner;

  return { title, description, version, diagram, url, graphDescriptor, nodes };
};

const getBoardFromDescriptor = async (
  url: string,
  descriptor: GraphDescriptor
): Promise<BreadboardUI.Types.LoadArgs> => {
  const runner = await Board.fromGraphDescriptor(descriptor);

  const { title, description, version } = runner;
  const diagram = runner.mermaid("TD", true, true);
  const nodes = runner.nodes;
  const graphDescriptor: GraphDescriptor = runner;
  graphDescriptor.url = url;

  return { title, description, version, diagram, url, graphDescriptor, nodes };
};

const enum MODE {
  BUILD = "build",
  PREVIEW = "preview",
}

// TODO: Remove once all elements are Lit-based.
BreadboardUI.register();

@customElement("bb-main")
export class Main extends LitElement {
  @property({ reflect: false })
  config: { boards: BreadboardUI.Types.Board[] };

  @property({ reflect: true })
  url: string | null = null;

  @property({ reflect: false })
  descriptor: GraphDescriptor | null = null;

  @property({ reflect: false })
  loadInfo: BreadboardUI.Types.LoadArgs | null = null;

  @state()
  kits: Kit[] = [];

  @state()
  runs: InspectableRun[] | null = null;

  @state()
  mode = MODE.BUILD;

  @state()
  embed = false;

  @state()
  showNav = false;

  @state()
  showOverlay = false;

  @state()
  toasts: Array<{ message: string; type: BreadboardUI.Events.ToastType }> = [];

  #uiRef: Ref<BreadboardUI.Elements.UI> = createRef();
  #previewRef: Ref<HTMLIFrameElement> = createRef();
  #boardId = 0;
  #lastBoardId = 0;
  #delay = 0;
  #status = BreadboardUI.Types.STATUS.STOPPED;
  #runObserver: InspectableRunObserver | null = null;
  #boardStorage = FileStorage.instance();
  #onKeyDownBound = this.#onKeyDown.bind(this);

  static styles = css`
    * {
      box-sizing: border-box;
    }

    :host {
      flex: 1 0 auto;
      display: grid;
      grid-template-rows: calc(var(--bb-grid-size) * 12) auto;
    }

    bb-toast {
      z-index: 100;
    }

    :host > header {
      display: grid;
      grid-template-columns: auto min-content;
      padding: calc(var(--bb-grid-size) * 6) calc(var(--bb-grid-size) * 8)
        calc(var(--bb-grid-size) * 0) calc(var(--bb-grid-size) * 8);
      font-size: var(--bb-text-default);
      grid-column: 1 / 3;
    }

    :host > header a {
      text-decoration: none;
      white-space: nowrap;
    }

    #show-nav {
      font-size: 0;
      width: 24px;
      height: 24px;
      background: var(--bb-icon-menu) center center no-repeat;
      border: none;
      margin-right: calc(var(--bb-grid-size) * 2);
      cursor: pointer;
    }

    #edit-board-info {
      font-size: 0;
      width: 20px;
      height: 20px;
      background: var(--bb-icon-edit) center center no-repeat;
      background-size: 20px 20px;
      border: none;
      margin-left: calc(var(--bb-grid-size) * 3);
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.3s cubic-bezier(0, 0, 0.3, 1);
    }

    #edit-board-info:hover {
      transition-duration: 0.1s;
      opacity: 1;
    }

    #new-board {
      font-size: var(--bb-text-nano);
    }

    #header-bar {
      background: var(--bb-output-600);
      display: flex;
      align-items: center;
      color: var(--bb-neutral-50);
      border-bottom: 1px solid var(--bb-neutral-300);
      z-index: 1;
      height: calc(var(--bb-grid-size) * 12);
      padding: calc(var(--bb-grid-size) * 2);
    }

    #save-board,
    #get-log,
    #get-board,
    #toggle-preview {
      color: var(--bb-neutral-50);
      padding: 0 16px 0 42px;
      font-size: var(--bb-text-medium);
      margin: 0 calc(var(--bb-grid-size) * 3) 0 0;
      cursor: pointer;
      background: 12px center var(--bb-icon-download);
      background-repeat: no-repeat;
      height: 100%;
      display: flex;
      align-items: center;
      text-decoration: none;
      border-radius: 20px;
      border: none;
    }

    #save-board:hover,
    #get-log:hover,
    #get-board:hover,
    #toggle-preview:hover {
      background-color: rgba(0, 0, 0, 0.1);
    }

    #save-board {
      background: 12px center var(--bb-icon-save);
      background-repeat: no-repeat;
    }

    #toggle-preview {
      margin-right: 0;
      background: 12px center var(--bb-icon-preview);
      background-repeat: no-repeat;
    }

    #toggle-preview.active {
      background-color: var(--bb-output-800);
    }

    #new-board {
      font-size: var(--bb-text-small);
      text-decoration: underline;
    }

    #new-board:active {
      color: rgb(90, 64, 119);
    }

    bb-board-list {
      grid-column: 1 / 3;
    }

    #header-bar a#back {
      font-size: 0;
      display: block;
      width: 16px;
      height: 16px;
      background: var(--bb-icon-arrow-back) center center no-repeat;
      margin: 0 calc(var(--bb-grid-size) * 3);
    }

    #header-bar h1 {
      font-size: var(--bb-text-default);
      font-weight: normal;
      flex: 1;
      display: flex;
      align-items: center;
    }

    #title {
      font: var(--bb-text-baseline) var(--bb-font-family-header);
      color: rgb(90, 64, 119);
      margin: 0;
      display: inline;
    }

    #content {
      height: calc(100vh - var(--bb-grid-size) * 12);
      display: flex;
      flex-direction: column;
    }

    #reload {
      height: 32px;
      width: 100px;
      margin: calc(var(--bb-grid-size) * 2);
      align-self: flex-end;
      background: #fff var(--bb-icon-frame-reload) 9px 3px no-repeat;
      border-radius: calc(var(--bb-grid-size) * 4);
      border: 1px solid rgb(204, 204, 204);
      padding: 0 8px 0 32px;
    }

    iframe {
      grid-row: 1 / 3;
      grid-column: 1 / 3;
      margin: 0;
      border: none;
      width: 100%;
      height: 100%;
      display: block;
    }

    #embed {
      grid-column: 1/3;
      grid-row: 1/3;
    }

    #embed iframe {
      margin: 0;
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 0;
    }

    #embed header {
      display: flex;
      padding: 0 calc(var(--bb-grid-size) * 9);
      align-items: center;
    }
  `;

  constructor(config: { boards: BreadboardUI.Types.Board[] }) {
    super();

    // Remove boards that are still works-in-progress from production builds.
    // These boards will have no version.
    if (import.meta.env.MODE === "production") {
      config.boards = config.boards.filter((board) => board.version);
    }

    config.boards.sort((a, b) => a.title.localeCompare(b.title));
    this.config = config;

    const currentUrl = new URL(window.location.href);
    const boardFromUrl = currentUrl.searchParams.get("board");
    const modeFromUrl = currentUrl.searchParams.get("mode");
    const embedFromUrl = currentUrl.searchParams.get("embed");
    this.embed = embedFromUrl !== null && embedFromUrl !== "false";

    if (modeFromUrl) {
      switch (modeFromUrl) {
        case "preview":
          this.mode = MODE.PREVIEW;
          break;

        default:
          this.mode = MODE.BUILD;
          break;
      }
    }

    Promise.all([
      loadKits([GeminiKit]),
      this.#boardStorage.restoreAndValidateHandles(),
    ]).then(([kits]) => {
      this.kits = kits;

      if (boardFromUrl) {
        this.#onStartBoard(new BreadboardUI.Events.StartEvent(boardFromUrl));
        return;
      }

      this.#createBlankBoard();
    });
  }

  async #createBlankBoard() {
    const loadInfo = await getBoardInfo("/graphs/blank.json");
    if (loadInfo.graphDescriptor) {
      loadInfo.graphDescriptor.title = "New Board";
    }

    this.#onStartBoard(
      new BreadboardUI.Events.StartEvent(null, loadInfo.graphDescriptor)
    );
  }

  connectedCallback(): void {
    super.connectedCallback();

    this.#checkForPossibleEmbed();
    window.addEventListener("keydown", this.#onKeyDownBound);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener("keydown", this.#onKeyDownBound);
  }

  #checkForPossibleEmbed() {
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    const hasTouch = window.matchMedia("(any-pointer: coarse)").matches;
    const currentUrl = new URL(window.location.href);
    const embedIsNotSet = currentUrl.searchParams.get("embed") === null;

    if (isPortrait && hasTouch && this.url && embedIsNotSet) {
      this.embed = true;
      this.#setUrlParam("embed", "true");

      return true;
    }

    return false;
  }

  #onKeyDown(evt: KeyboardEvent) {
    if (evt.key === "s" && evt.metaKey) {
      evt.preventDefault();
      this.#attemptBoardSave();
    }
  }

  async #attemptBoardSave() {
    if (
      !this.loadInfo ||
      !this.loadInfo.graphDescriptor ||
      !this.loadInfo.url
    ) {
      return;
    }

    const url = new URL(this.loadInfo.url);
    const capabilities = this.#boardStorage.canProvide(url);
    if (!capabilities || !capabilities.save) {
      return;
    }

    const saveResult = await this.#boardStorage.saveBoardFile(
      url,
      this.loadInfo.graphDescriptor
    );
    if (!saveResult) {
      this.toast("Unable to save board", BreadboardUI.Events.ToastType.ERROR);
      return;
    }

    this.toast("Board saved", BreadboardUI.Events.ToastType.INFORMATION);
  }

  get status() {
    return this.#status;
  }

  set status(status: BreadboardUI.Types.STATUS) {
    this.#status = status;
    this.requestUpdate();
  }

  async #onStartBoard(startEvent: BreadboardUI.Events.StartEvent) {
    this.#boardId++;
    this.#setUrlParam("board", startEvent.url);
    this.url = startEvent.url;
    this.descriptor = startEvent.descriptor;
    this.status = BreadboardUI.Types.STATUS.STOPPED;
    this.#runObserver = null;

    this.#checkForPossibleEmbed();
  }

  protected async updated(changedProperties: Map<PropertyKey, unknown>) {
    if (changedProperties.has("mode")) {
      this.#setUrlParam("mode", this.mode);
    }

    if (!this.url && !this.descriptor) {
      return;
    }

    // Board has already started; don't restart.
    if (this.#lastBoardId === this.#boardId) {
      return;
    }

    this.#lastBoardId = this.#boardId;
    if (this.url) {
      this.loadInfo = await getBoardInfo(this.url);
    } else if (this.descriptor) {
      this.loadInfo = await getBoardFromDescriptor(
        this.descriptor.url || window.location.href,
        this.descriptor
      );
    } else {
      return;
    }
  }

  // TODO: Allow this to run boards directly.
  async #runBoard(runner: ReturnType<typeof run>) {
    if (!(this.#uiRef.value && this.loadInfo)) {
      return;
    }

    const ui = this.#uiRef.value;
    ui.load(this.loadInfo);
    ui.clearPosition();

    const currentBoardId = this.#boardId;

    this.status = BreadboardUI.Types.STATUS.RUNNING;
    if (!this.#runObserver)
      this.#runObserver = createRunObserver({
        logLevel: "debug",
      });
    for await (const result of runner) {
      // Update "runs" to ensure the UI is aware when the new run begins.
      this.runs = this.#runObserver.observe(result);
      if (this.#delay !== 0) {
        await new Promise((r) => setTimeout(r, this.#delay));
      }

      if (currentBoardId !== this.#boardId) {
        return;
      }

      const answer = await ui.handleStateChange(result);
      if (answer) {
        await result.reply({ inputs: answer } as InputResolveRequest);
      }
    }
    this.status = BreadboardUI.Types.STATUS.STOPPED;
  }

  #setUrlParam(param: string, value: string | null) {
    const pageUrl = new URL(window.location.href);
    if (value === null) {
      pageUrl.searchParams.delete(param);
    } else {
      pageUrl.searchParams.set(param, value);
    }
    window.history.replaceState(null, "", pageUrl);
  }

  toast(message: string, type: BreadboardUI.Events.ToastType) {
    this.toasts.push({ message, type });
    this.requestUpdate();
  }

  #getBoardJson(evt: Event) {
    if (
      !(evt.target instanceof HTMLAnchorElement) ||
      !this.loadInfo ||
      !this.loadInfo.graphDescriptor
    ) {
      return;
    }

    if (evt.target.href) {
      URL.revokeObjectURL(evt.target.href);
    }

    // Remove the URL from the descriptor as its not part of BGL's schema.
    const board = structuredClone(this.loadInfo.graphDescriptor);
    delete board["url"];

    const data = JSON.stringify(board, null, 2);
    evt.target.download = `board-${new Date().toISOString()}.json`;
    evt.target.href = URL.createObjectURL(
      new Blob([data], { type: "application/json" })
    );
  }

  #updateLoadInfo(graphDescriptor: GraphDescriptor) {
    this.loadInfo = {
      ...this.loadInfo,
      graphDescriptor,
    };
  }

  render() {
    const toasts = html`${this.toasts.map(({ message, type }) => {
      return html`<bb-toast .message=${message} .type=${type}></bb-toast>`;
    })}`;

    let tmpl: HTMLTemplateResult | symbol = nothing;
    let content: HTMLTemplateResult | symbol = nothing;
    const currentRun = this.#runObserver?.runs()[0];
    switch (this.mode) {
      case MODE.BUILD: {
        content = html` <bb-ui-controller
          ${ref(this.#uiRef)}
          .url=${this.url}
          .loadInfo=${this.loadInfo}
          .run=${currentRun}
          .kits=${this.kits}
          .graphProviders=${[this.#boardStorage]}
          .status=${this.status}
          .boardId=${this.#boardId}
          @breadboardfiledrop=${async (
            evt: BreadboardUI.Events.FileDropEvent
          ) => {
            if (this.status === BreadboardUI.Types.STATUS.RUNNING) {
              this.toast(
                "Unable to update; board is already running",
                BreadboardUI.Events.ToastType.ERROR
              );
              return;
            }

            this.#onStartBoard(
              new BreadboardUI.Events.StartEvent(null, evt.descriptor)
            );
          }}
          @breadboardrunboard=${async () => {
            if (
              !this.loadInfo?.graphDescriptor ||
              !this.loadInfo.graphDescriptor.url
            ) {
              console.log(
                "No graph descriptor url or something",
                this.loadInfo
              );
              return;
            }

            const runner = await BoardRunner.fromGraphDescriptor(
              this.loadInfo.graphDescriptor
            );

            const runConfig: RunConfig = {
              url: this.loadInfo.graphDescriptor.url,
              runner,
              diagnostics: true,
              kits: this.kits,
              graphProviders: [this.#boardStorage],
            };
            this.#runBoard(run(runConfig));
          }}
          @breadboardedgechange=${(
            evt: BreadboardUI.Events.EdgeChangeEvent
          ) => {
            if (!this.loadInfo) {
              console.warn("Unable to create node; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn("Unable to create node; no graph descriptor");
              return;
            }

            const editableGraph = edit(loadInfo.graphDescriptor, {
              kits: this.kits,
              graphProviders: [this.#boardStorage],
            });

            let editResult: Promise<EditResult>;
            switch (evt.changeType) {
              case "add": {
                editResult = editableGraph.addEdge(evt.from);
                break;
              }

              case "remove": {
                editResult = editableGraph.removeEdge(evt.from);
                break;
              }

              case "move": {
                if (!evt.to) {
                  throw new Error("Unable to move edge - no `to` provided");
                }

                editResult = editableGraph.changeEdge(evt.from, evt.to);
                break;
              }
            }

            editResult.then((result) => {
              if (!result.success) {
                this.toast(result.error, BreadboardUI.Events.ToastType.ERROR);
              }

              this.#updateLoadInfo(editableGraph.raw());
            });
          }}
          @breadboardnodemove=${(evt: BreadboardUI.Events.NodeMoveEvent) => {
            if (!this.loadInfo) {
              console.warn("Unable to update node metadata; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn(
                "Unable to update node metadata; no graph descriptor"
              );
              return;
            }

            const editableGraph = edit(loadInfo.graphDescriptor, {
              kits: this.kits,
            });

            const { id, x, y } = evt;
            const existingNode = loadInfo.graphDescriptor.nodes.find(
              (node) => node.id === id
            );
            const metadata = existingNode?.metadata || {};
            let visual = metadata?.visual || {};
            if (typeof visual !== "object") {
              visual = {};
            }

            editableGraph
              .changeMetadata(id, {
                ...metadata,
                visual: { ...visual, x, y },
              })
              .then((result) => {
                if (!result.success) {
                  this.toast(result.error, BreadboardUI.Events.ToastType.ERROR);
                }

                this.#updateLoadInfo(editableGraph.raw());
              });
          }}
          @breadboardnodemultilayout=${(
            evt: BreadboardUI.Events.NodeMultiLayoutEvent
          ) => {
            if (!this.loadInfo) {
              console.warn("Unable to update node metadata; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn(
                "Unable to update node metadata; no graph descriptor"
              );
              return;
            }

            const graphDescriptor = loadInfo.graphDescriptor;
            const editableGraph = edit(graphDescriptor, {
              kits: this.kits,
            });

            Promise.all(
              [...evt.layout.entries()].map(([id, { x, y }]) => {
                const existingNode = graphDescriptor.nodes.find(
                  (node) => node.id === id
                );

                const metadata = existingNode?.metadata || {};
                let visual = metadata?.visual || {};
                if (typeof visual !== "object") {
                  visual = {};
                }

                return editableGraph.changeMetadata(id, {
                  ...metadata,
                  visual: { ...visual, x, y },
                });
              })
            ).then(() => {
              this.#updateLoadInfo(editableGraph.raw());
            });
          }}
          @breadboardnodecreate=${(
            evt: BreadboardUI.Events.NodeCreateEvent
          ) => {
            const { id, nodeType } = evt;
            const newNode = {
              id,
              type: nodeType,
            };

            if (!this.loadInfo) {
              console.warn("Unable to create node; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn("Unable to create node; no graph descriptor");
              return;
            }

            const editableGraph = edit(loadInfo.graphDescriptor, {
              kits: this.kits,
            });
            editableGraph.addNode(newNode).then((result) => {
              if (!result.success) {
                this.toast(
                  `Unable to create node: ${result.error}`,
                  BreadboardUI.Events.ToastType.ERROR
                );
              }

              this.#updateLoadInfo(editableGraph.raw());
            });
          }}
          @breadboardnodeupdate=${(
            evt: BreadboardUI.Events.NodeUpdateEvent
          ) => {
            if (!this.loadInfo) {
              console.warn("Unable to create node; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn("Unable to create node; no graph descriptor");
              return;
            }

            const editableGraph = edit(loadInfo.graphDescriptor, {
              kits: this.kits,
            });

            editableGraph
              .changeConfiguration(evt.id, evt.configuration)
              .then((result) => {
                if (!result.success) {
                  this.toast(
                    "Unable to update configuration",
                    BreadboardUI.Events.ToastType.ERROR
                  );
                }

                this.#updateLoadInfo(editableGraph.raw());
              });
          }}
          @breadboardnodedelete=${(
            evt: BreadboardUI.Events.NodeDeleteEvent
          ) => {
            if (!this.loadInfo) {
              console.warn("Unable to create node; no active graph");
              return;
            }

            const loadInfo = this.loadInfo;
            if (!loadInfo.graphDescriptor) {
              console.warn("Unable to create node; no graph descriptor");
              return;
            }

            const editableGraph = edit(loadInfo.graphDescriptor, {
              kits: this.kits,
            });
            editableGraph.removeNode(evt.id).then((result) => {
              if (!result.success) {
                this.toast(
                  `Unable to remove node: ${result.error}`,
                  BreadboardUI.Events.ToastType.ERROR
                );
              }

              this.#updateLoadInfo(editableGraph.raw());
            });
          }}
          @breadboardmessagetraversal=${() => {
            if (this.status !== BreadboardUI.Types.STATUS.RUNNING) {
              return;
            }

            this.status = BreadboardUI.Types.STATUS.PAUSED;
            this.toast(
              "Board paused",
              "information" as BreadboardUI.Events.ToastType
            );
          }}
          @breadboardtoast=${(toastEvent: BreadboardUI.Events.ToastEvent) => {
            if (!this.#uiRef.value) {
              return;
            }

            this.toast(toastEvent.message, toastEvent.toastType);
          }}
          @breadboarddelay=${(delayEvent: BreadboardUI.Events.DelayEvent) => {
            this.#delay = delayEvent.duration;
          }}
          .boards=${this.config.boards}
        ></bb-ui-controller>`;
        break;
      }

      case MODE.PREVIEW: {
        // TODO: Do this with Service Workers.
        content = html`<button
            id="reload"
            @click=${() => {
              if (!this.#previewRef.value) {
                return;
              }

              this.#previewRef.value.src = `/preview.html?board=${this.url}`;
            }}
          >
            Reload
          </button>
          <iframe
            ${ref(this.#previewRef)}
            src="/preview.html?board=${this.url}"
          ></iframe>`;
        break;
      }

      default: {
        return html`Unknown mode`;
      }
    }

    let saveButton: HTMLTemplateResult | symbol = nothing;
    if (this.loadInfo && this.loadInfo.url) {
      try {
        const url = new URL(this.loadInfo.url);
        const capabilities = this.#boardStorage.canProvide(url);
        if (capabilities && capabilities.save) {
          saveButton = html`<button
            id="save-board"
            title="Save Board BGL"
            @click=${this.#attemptBoardSave}
          >
            Save
          </button>`;
        }
      } catch (err) {
        // If there are any problems with the URL, etc, don't offer the save button.
      }
    }

    tmpl = html`<div id="header-bar" ?inert=${this.showOverlay}>
        <button
          id="show-nav"
          @click=${() => {
            this.showNav = !this.showNav;
            document.body.addEventListener(
              "pointerdown",
              () => {
                this.showNav = false;
              },
              { once: true }
            );
          }}
        ></button>
        <h1>
          ${this.loadInfo?.title || "..."}
          <button
            @click=${() => {
              this.showOverlay = true;
            }}
            id="edit-board-info"
            title="Edit Board Information"
          >
            Edit
          </button>
        </h1>
        ${saveButton}
        <a id="get-board" title="Export Board BGL" @click=${this.#getBoardJson}
          >Export</a
        >
        <button
          class=${classMap({ active: this.mode === MODE.PREVIEW })}
          id="toggle-preview"
          title="Toggle Board Preview"
          @click=${() => {
            this.mode = this.mode === MODE.BUILD ? MODE.PREVIEW : MODE.BUILD;
          }}
        >
          Preview
        </button>
      </div>
      <div id="content" ?inert=${this.showOverlay} class="${this.mode}">
        ${cache(content)}
      </div>
      <bb-nav
        .storageSupported=${this.#boardStorage.getSupported()}
        .storageItems=${this.#boardStorage.items()}
        .exampleBoards=${this.config.boards}
        .visible=${this.showNav}
        .url=${this.url}
        ?inert=${this.showOverlay}
        @pointerdown=${(evt: Event) => {
          evt.stopImmediatePropagation();
        }}
        @breadboardblankboardrequest=${async () => {
          if (
            !confirm(
              "Are you sure you want to create a blank board? You will lose any unsaved work"
            )
          ) {
            return;
          }

          await this.#createBlankBoard();
        }}
        @breadboardstart=${(evt: BreadboardUI.Events.StartEvent) => {
          if (this.status !== BreadboardUI.Types.STATUS.STOPPED) {
            if (
              !confirm(
                "A board is currently running. Do you want to load this file?"
              )
            ) {
              return;
            }
          }

          this.#onStartBoard(evt);
        }}
        @breadboardfilestoragerefresh=${async (
          evt: BreadboardUI.Events.FileStorageRefreshEvent
        ) => {
          await this.#boardStorage.refresh(evt.location);
          this.toast(
            "Source files refreshed",
            BreadboardUI.Events.ToastType.INFORMATION
          );
          this.requestUpdate();
        }}
        @breadboardfilestoragedisconnect=${async (
          evt: BreadboardUI.Events.FileStorageDisconnectEvent
        ) => {
          await this.#boardStorage.disconnect(evt.location);
          this.requestUpdate();
        }}
        @breadboardfilestoragerenewaccesssrequest=${async (
          evt: BreadboardUI.Events.FileStorageRenewAccessRequestEvent
        ) => {
          await this.#boardStorage.renewAccessRequest(evt.location);
          this.requestUpdate();
        }}
        @breadboardfilestorageloadrequest=${async (
          evt: BreadboardUI.Events.FileStorageLoadRequestEvent
        ) => {
          if (this.status !== BreadboardUI.Types.STATUS.STOPPED) {
            if (
              !confirm(
                "A board is currently running. Do you want to load this file?"
              )
            ) {
              return;
            }
          }

          try {
            const url = this.#boardStorage.createGraphURL(
              evt.location,
              evt.fileName
            );

            this.#onStartBoard(new BreadboardUI.Events.StartEvent(url));
          } catch (err) {
            this.toast(
              `Unable to load file: ${evt.fileName}`,
              BreadboardUI.Events.ToastType.ERROR
            );
          }
        }}
        @breadboardfilestoragerequest=${async () => {
          const success = await this.#boardStorage.request("fileSystem");
          if (!success) {
            return;
          }

          this.requestUpdate();
        }}
      ></bb-nav> `;

    if (this.embed) {
      tmpl = html`<iframe
        src="/preview.html?board=${this.url}&embed=true"
      ></iframe>`;
    }

    let overlay: HTMLTemplateResult | symbol = nothing;
    if (this.showOverlay && this.loadInfo) {
      overlay = html`<bb-board-edit-overlay
        .boardTitle=${this.loadInfo.title}
        .boardVersion=${this.loadInfo.version}
        .boardDescription=${this.loadInfo.description}
        @breadboardboardoverlaydismissed=${() => {
          this.showOverlay = false;
        }}
        @breadboardboardinfoupdate=${(
          evt: BreadboardUI.Events.BoardInfoUpdateEvent
        ) => {
          if (!this.loadInfo) {
            return;
          }

          this.loadInfo.title = evt.title;
          this.loadInfo.version = evt.version;
          this.loadInfo.description = evt.description;

          if (this.loadInfo.graphDescriptor) {
            this.loadInfo.graphDescriptor.title = evt.title;
            this.loadInfo.graphDescriptor.version = evt.version;
            this.loadInfo.graphDescriptor.description = evt.description;
          }

          this.toast(
            "Board information updated",
            BreadboardUI.Events.ToastType.INFORMATION
          );

          this.showOverlay = false;
          this.requestUpdate();
        }}
      ></bb-board-edit-overlay>`;
    }

    return html`${tmpl} ${overlay} ${toasts} `;
  }
}
