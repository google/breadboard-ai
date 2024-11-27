/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HarnessProxyConfig,
  RunConfig,
  RunErrorEvent,
  RunSecretEvent,
} from "@google-labs/breadboard/harness";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { until } from "lit/directives/until.js";
import { map } from "lit/directives/map.js";
import { guard } from "lit/directives/guard.js";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement, html, HTMLTemplateResult, nothing } from "lit";
import * as BreadboardUI from "@breadboard-ai/shared-ui";
import {
  blankLLMContent,
  createRunObserver,
  GraphDescriptor,
  BoardServer,
  InputValues,
  InspectableEdge,
  InspectableRun,
  InspectableRunSequenceEntry,
  NodeConfiguration,
  SerializedRun,
  MutableGraphStore,
} from "@google-labs/breadboard";
import { getDataStore, getRunStore } from "@breadboard-ai/data-store";
import { classMap } from "lit/directives/class-map.js";
import { SettingsStore } from "./data/settings-store";
import { addNodeProxyServerConfig } from "./data/node-proxy-servers";
import { provide } from "@lit/context";
import { RecentBoardStore } from "./data/recent-boards";
import { SecretsHelper } from "./utils/secrets-helper";
import { SettingsHelperImpl } from "./utils/settings-helper";
import { styles as mainStyles } from "./index.styles.js";
import * as Runtime from "./runtime/runtime.js";
import { EnhanceSideboard, TabId } from "./runtime/types";
import { createPastRunObserver } from "./utils/past-run-observer";
import { getRunNodeConfig } from "./utils/run-node";
import { TopGraphObserver } from "../../shared-ui/dist/utils/top-graph-observer";
import {
  createTokenVendor,
  TokenVendor,
} from "@breadboard-ai/connection-client";

import { sandbox } from "./sandbox";
import { Module, ModuleIdentifier } from "@breadboard-ai/types";
import { defaultModuleContent } from "./utils/default-module-content";

const STORAGE_PREFIX = "bb-main";
const LOADING_TIMEOUT = 250;

type MainArguments = {
  boards: BreadboardUI.Types.Board[];
  providers?: BoardServer[]; // Deprecated.
  settings?: SettingsStore;
  proxy?: HarnessProxyConfig[];
  version?: string;
};

type SaveAsConfiguration = {
  title: string;
  graph: GraphDescriptor;
  isNewBoard: boolean;
};

const generatedUrls = new Set<string>();

const ENVIRONMENT: BreadboardUI.Contexts.Environment = {
  connectionServerUrl: import.meta.env.VITE_CONNECTION_SERVER_URL,
  connectionRedirectUrl: "/oauth/",
  plugins: {
    input: [
      BreadboardUI.Elements.googleDriveFileIdInputPlugin,
      BreadboardUI.Elements.googleDriveQueryInputPlugin,
    ],
  },
};

const BOARD_AUTO_SAVE_TIMEOUT = 1_500;

@customElement("bb-main")
export class Main extends LitElement {
  @state()
  graph: GraphDescriptor | null = null;

  @property()
  subGraphId: string | null = null;

  @state()
  showNav = false;

  @state()
  showBoardServerAddOverlay = false;

  @property({ reflect: true })
  showBoardActivityOverlay = false;
  #boardActivityLocation: BreadboardUI.Types.BoardActivityLocation | null =
    null;

  @state()
  showHistory = false;

  @state()
  showFirstRun = false;

  @state()
  showWelcomePanel = false;

  @state()
  showOpenBoardOverlay = false;

  @state()
  showCommandPalette = false;

  @state()
  showModulePalette = false;

  @state()
  showNewWorkspaceItemOverlay = false;

  @state()
  showSaveAsDialog = false;
  #saveAsState: SaveAsConfiguration | null = null;

  @state()
  showNodeConfigurator = false;
  #nodeConfiguratorData: BreadboardUI.Types.NodePortConfiguration | null = null;
  #nodeConfiguratorRef: Ref<BreadboardUI.Elements.NodeConfigurationOverlay> =
    createRef();

  @state()
  showCommentEditor = false;
  #commentValueData: BreadboardUI.Types.CommentConfiguration | null = null;

  @state()
  showEdgeValue = false;
  #edgeValueData: BreadboardUI.Types.EdgeValueConfiguration | null = null;

  @state()
  boardEditOverlayInfo: {
    title: string;
    version: string;
    description: string;
    published: boolean | null;
    isTool: boolean | null;
    isComponent: boolean | null;
    subGraphId: string | null;
    x: number | null;
    y: number | null;
  } | null = null;

  @state()
  showSettingsOverlay = false;

  @state()
  toasts = new Map<
    string,
    {
      message: string;
      type: BreadboardUI.Events.ToastType;
      persistent: boolean;
    }
  >();

  @provide({ context: BreadboardUI.Contexts.environmentContext })
  environment = ENVIRONMENT;

  @provide({ context: BreadboardUI.Elements.tokenVendorContext })
  tokenVendor!: TokenVendor;

  @provide({ context: BreadboardUI.Contexts.settingsHelperContext })
  settingsHelper!: SettingsHelperImpl;

  @state()
  selectedBoardServer = "Example Boards";

  @state()
  selectedLocation = "example://example-boards";

  @state()
  previewOverlayURL: URL | null = null;

  @state()
  boardServerNavState: string | null = null;

  @property()
  tab: Runtime.Types.Tab | null = null;

  #uiRef: Ref<BreadboardUI.Elements.UI> = createRef();
  #tooltipRef: Ref<BreadboardUI.Elements.Tooltip> = createRef();
  #tabContainerRef: Ref<HTMLDivElement> = createRef();
  #boardActivityRef: Ref<BreadboardUI.Elements.BoardActivityOverlay> =
    createRef();
  #boardId = 0;
  #boardPendingSave = false;
  #tabSaveId = new Map<
    TabId,
    ReturnType<typeof globalThis.crypto.randomUUID>
  >();
  #tabSaveStatus = new Map<TabId, BreadboardUI.Types.BOARD_SAVE_STATUS>();
  #tabBoardStatus = new Map<TabId, BreadboardUI.Types.STATUS>();
  #tabLoadStatus = new Map<TabId, BreadboardUI.Types.BOARD_LOAD_STATUS>();
  #boardServers: BoardServer[];
  #settings: SettingsStore | null;
  #secretsHelper: SecretsHelper | null = null;
  /**
   * Optional proxy configuration for the board.
   * This is used to provide additional proxied nodes.
   */
  #proxy: HarnessProxyConfig[];
  #onShowTooltipBound = this.#onShowTooltip.bind(this);
  #hideTooltipBound = this.#hideTooltip.bind(this);
  #hidePalettesAndTooltipBound = this.#hidePalettesAndTooltip.bind(this);
  #onKeyDownBound = this.#onKeyDown.bind(this);
  #downloadRunBound = this.#downloadRun.bind(this);
  #confirmUnloadWithUserFirstIfNeededBound =
    this.#confirmUnloadWithUserFirstIfNeeded.bind(this);
  #version = "dev";
  #recentBoardStore = RecentBoardStore.instance();
  #recentBoards: BreadboardUI.Types.RecentBoard[] = [];
  #isSaving = false;
  #graphStore!: MutableGraphStore;
  #dataStore = getDataStore();
  #runStore = getRunStore();

  #globalCommands: BreadboardUI.Types.Command[] = [
    {
      title: "Open board...",
      name: "open-board",
      icon: "open",
      callback: () => {
        this.showOpenBoardOverlay = true;
      },
    },
    {
      title: "Save board",
      name: "save-board",
      icon: "save",
      callback: () => {
        this.#attemptBoardSave();
      },
    },
    {
      title: "Save board As...",
      name: "save-board-as",
      icon: "save",
      callback: () => {
        this.showSaveAsDialog = true;
      },
    },
    {
      title: "Edit board information...",
      name: "edit-board-information",
      icon: "edit",
      callback: () => {
        if (!this.#tabContainerRef.value) {
          return;
        }

        const activeTab = this.#tabContainerRef.value.querySelector(".active");
        if (!activeTab) {
          return;
        }

        const { left, bottom } = activeTab.getBoundingClientRect();
        const maxLeft = window.innerWidth - 500;
        this.#showBoardEditOverlay(
          Math.min(maxLeft, left),
          bottom,
          this.tab?.subGraphId ?? null
        );
      },
    },
    {
      title: "Open module...",
      name: "open-module",
      icon: "open",
      callback: () => {
        this.showModulePalette = true;
      },
    },
    {
      title: "Create module...",
      icon: "add-circle",
      name: "create-module",
      callback: () => {
        const moduleId = BreadboardUI.Utils.getModuleId();
        if (!moduleId) {
          return;
        }

        this.#attemptModuleCreate(moduleId);
      },
    },
  ];
  #viewCommandNamespace = "default";
  #viewCommands = new Map<string, BreadboardUI.Types.Command[]>();

  #runtime!: Runtime.RuntimeInstance;

  static styles = mainStyles;
  proxyFromUrl: string | undefined;

  #initialize: Promise<void>;
  constructor(config: MainArguments) {
    super();

    const boardServerLocation = globalThis.sessionStorage.getItem(
      `${STORAGE_PREFIX}-board-server`
    );
    if (boardServerLocation) {
      const [boardServer, location] = boardServerLocation.split("::");

      if (boardServer && location) {
        this.selectedBoardServer = boardServer;
        this.selectedLocation = location;
      }
    }

    this.#version = config.version || "dev";
    this.#boardServers = [];
    this.#settings = config.settings || null;
    this.#proxy = config.proxy || [];
    if (this.#settings) {
      this.settingsHelper = new SettingsHelperImpl(this.#settings);
      this.tokenVendor = createTokenVendor(
        {
          get: (conectionId: string) => {
            return this.settingsHelper.get(
              BreadboardUI.Types.SETTINGS_TYPE.CONNECTIONS,
              conectionId
            )?.value as string;
          },
          set: async (connectionId: string, grant: string) => {
            await this.settingsHelper.set(
              BreadboardUI.Types.SETTINGS_TYPE.CONNECTIONS,
              connectionId,
              {
                name: connectionId,
                value: grant,
              }
            );
          },
        },
        ENVIRONMENT
      );
    }

    const currentUrl = new URL(window.location.href);
    const firstRunFromUrl = currentUrl.searchParams.get("firstrun");

    if (firstRunFromUrl && firstRunFromUrl === "true") {
      this.showFirstRun = true;
    }

    const proxyFromUrl = currentUrl.searchParams.get("python_proxy");
    if (proxyFromUrl) {
      console.log("Setting python_proxy: %s", proxyFromUrl);
      this.proxyFromUrl = proxyFromUrl;
    }

    const stopCurrentRunIfActive = (tabId: TabId | null) => {
      if (!tabId) {
        return;
      }

      if (this.tab?.id !== tabId) {
        return;
      }

      if (
        this.#tabBoardStatus.get(tabId) === BreadboardUI.Types.STATUS.STOPPED
      ) {
        return;
      }

      this.#tabBoardStatus.set(tabId, BreadboardUI.Types.STATUS.STOPPED);
      this.#runtime.run.getAbortSignal(tabId)?.abort();
    };

    // Initialization order:
    //  1. Recent boards.
    //  2. Settings.
    //  3. Runtime.
    //
    // Note: the runtime loads the kits and the initializes the board servers.
    this.#initialize = this.#recentBoardStore
      .restore()
      .then((boards) => {
        this.#recentBoards = boards;
        return this.#settings?.restore();
      })
      .then(() => {
        return Runtime.create({
          graphStore: this.#graphStore,
          runStore: this.#runStore,
          dataStore: this.#dataStore,
          experiments: {},
          environment: this.environment,
          tokenVendor: this.tokenVendor,
          sandbox,
        });
      })
      .then((runtime) => {
        this.#runtime = runtime;
        this.#graphStore = runtime.board.getGraphStore();
        this.#boardServers = runtime.board.getBoardServers() || [];

        this.#runtime.edit.addEventListener(
          Runtime.Events.RuntimeBoardEnhanceEvent.eventName,
          async (evt: Runtime.Events.RuntimeBoardEnhanceEvent) => {
            if (!this.#nodeConfiguratorData) {
              return;
            }

            await this.#setNodeDataForConfiguration(
              this.#nodeConfiguratorData,
              evt.configuration
            );

            this.requestUpdate();
          }
        );

        this.#runtime.edit.addEventListener(
          Runtime.Events.RuntimeBoardEditEvent.eventName,
          (evt: Runtime.Events.RuntimeBoardEditEvent) => {
            this.requestUpdate();

            const observers = this.#runtime.run.getObservers(evt.tabId);
            if (observers) {
              if (!evt.visualOnly) {
                observers.topGraphObserver?.updateAffected(evt.affectedNodes);
                observers.runObserver?.replay(evt.affectedNodes);
              }
            }

            const shouldAutoSave = this.#settings?.getItem(
              BreadboardUI.Types.SETTINGS_TYPE.GENERAL,
              "Auto Save Boards"
            ) ?? { value: false };

            if (!shouldAutoSave.value) {
              if (this.tab) {
                this.#tabSaveStatus.set(
                  this.tab.id,
                  BreadboardUI.Types.BOARD_SAVE_STATUS.UNSAVED
                );
              }
              return;
            }

            this.#attemptBoardSave(
              "Saving board",
              false,
              false,
              BOARD_AUTO_SAVE_TIMEOUT
            );
          }
        );

        this.#runtime.edit.addEventListener(
          Runtime.Events.RuntimeErrorEvent.eventName,
          (evt: Runtime.Events.RuntimeErrorEvent) => {
            // Wait a frame so we don't end up accidentally spamming the render.
            requestAnimationFrame(() => {
              this.toast(evt.message, BreadboardUI.Events.ToastType.ERROR);
            });
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeBoardLoadErrorEvent.eventName,
          () => {
            if (this.tab) {
              this.#tabLoadStatus.set(
                this.tab.id,
                BreadboardUI.Types.BOARD_LOAD_STATUS.ERROR
              );
            }

            this.toast(
              "Unable to load board",
              BreadboardUI.Events.ToastType.ERROR
            );
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeErrorEvent.eventName,
          (evt: Runtime.Events.RuntimeErrorEvent) => {
            this.toast(evt.message, BreadboardUI.Events.ToastType.ERROR);
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeBoardServerChangeEvent.eventName,
          (evt: Runtime.Events.RuntimeBoardServerChangeEvent) => {
            this.showBoardServerAddOverlay = false;
            this.#boardServers = runtime.board.getBoardServers() || [];

            if (evt.connectedBoardServerName && evt.connectedBoardServerURL) {
              this.selectedBoardServer = evt.connectedBoardServerName;
              this.selectedLocation = evt.connectedBoardServerURL;
            }

            this.requestUpdate();
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeTabChangeEvent.eventName,
          async (evt: Runtime.Events.RuntimeTabChangeEvent) => {
            this.tab = this.#runtime.board.currentTab;
            this.#maybeShowWelcomePanel();

            if (this.tab) {
              // If there is a TGO in the tab change event, honor it and populate a
              // run with it before switching to the tab proper.
              if (evt.topGraphObserver) {
                this.#runtime.run.create(
                  this.tab,
                  evt.topGraphObserver,
                  evt.runObserver
                );
              }

              if (
                this.tab.graph.url &&
                this.tab.type === Runtime.Types.TabType.URL
              ) {
                this.#updatePageURL();
                await this.#trackRecentBoard(this.tab.graph.url);
              }

              if (this.tab.graph.title) {
                this.#setPageTitle(this.tab.graph.title);
              }
            } else {
              this.#clearTabParams();
              this.#setPageTitle(null);
            }
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeModuleChangeEvent.eventName,
          () => {
            this.#updatePageURL();
            this.requestUpdate();
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeWorkspaceItemChangeEvent.eventName,
          () => {
            this.#updatePageURL();
            this.requestUpdate();
          }
        );

        this.#runtime.board.addEventListener(
          Runtime.Events.RuntimeTabCloseEvent.eventName,
          async (evt: Runtime.Events.RuntimeTabCloseEvent) => {
            stopCurrentRunIfActive(evt.tabId);

            await this.#confirmSaveWithUserFirstIfNeeded();
            this.#updatePageURL();
            this.requestUpdate();
          }
        );

        this.#runtime.run.addEventListener(
          Runtime.Events.RuntimeBoardRunEvent.eventName,
          (evt: Runtime.Events.RuntimeBoardRunEvent) => {
            if (this.tab && evt.tabId === this.tab.id) {
              this.requestUpdate();
            }

            switch (evt.runEvt.type) {
              case "next": {
                // Noop.
                break;
              }

              case "skip": {
                // Noop.
                break;
              }

              case "graphstart": {
                // Noop.
                break;
              }

              case "start": {
                this.#tabBoardStatus.set(
                  evt.tabId,
                  BreadboardUI.Types.STATUS.RUNNING
                );
                break;
              }

              case "end": {
                this.#tabBoardStatus.set(
                  evt.tabId,
                  BreadboardUI.Types.STATUS.STOPPED
                );
                break;
              }

              case "error": {
                const runEvt = evt.runEvt as RunErrorEvent;
                this.toast(
                  BreadboardUI.Utils.formatError(runEvt.data.error),
                  BreadboardUI.Events.ToastType.ERROR
                );
                this.#tabBoardStatus.set(
                  evt.tabId,
                  BreadboardUI.Types.STATUS.STOPPED
                );
                break;
              }

              case "resume": {
                this.#tabBoardStatus.set(
                  evt.tabId,
                  BreadboardUI.Types.STATUS.RUNNING
                );
                break;
              }

              case "pause": {
                this.#tabBoardStatus.set(
                  evt.tabId,
                  BreadboardUI.Types.STATUS.PAUSED
                );
                break;
              }

              case "secret": {
                const runEvt = evt.runEvt as RunSecretEvent;
                const { keys } = runEvt.data;
                if (this.#secretsHelper) {
                  this.#secretsHelper.setKeys(keys);
                  if (this.#secretsHelper.hasAllSecrets()) {
                    evt.harnessRunner?.run(this.#secretsHelper.getSecrets());
                  } else {
                    const result = SecretsHelper.allKeysAreKnown(
                      this.#settings!,
                      keys
                    );
                    if (result) {
                      evt.harnessRunner?.run(result);
                    }
                  }
                } else {
                  const result = SecretsHelper.allKeysAreKnown(
                    this.#settings!,
                    keys
                  );
                  if (result) {
                    evt.harnessRunner?.run(result);
                  } else {
                    this.#secretsHelper = new SecretsHelper(this.#settings!);
                    this.#secretsHelper.setKeys(keys);
                  }
                }
              }
            }
          }
        );

        return this.#runtime.board.createTabsFromURL(currentUrl);
      });
  }

  connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener("bbshowtooltip", this.#onShowTooltipBound);
    window.addEventListener("bbhidetooltip", this.#hideTooltipBound);
    window.addEventListener("pointerdown", this.#hidePalettesAndTooltipBound);
    window.addEventListener("keydown", this.#onKeyDownBound);
    window.addEventListener("bbrundownload", this.#downloadRunBound);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener("bbshowtooltip", this.#onShowTooltipBound);
    window.removeEventListener("bbhidetooltip", this.#hideTooltipBound);
    window.removeEventListener(
      "pointerdown",
      this.#hidePalettesAndTooltipBound
    );
    window.removeEventListener("keydown", this.#onKeyDownBound);
    window.removeEventListener("bbrundownload", this.#downloadRunBound);
  }

  #maybeShowWelcomePanel() {
    this.showWelcomePanel = this.tab === null;

    if (!this.showWelcomePanel) {
      return;
    }
    this.#hideAllOverlays();
  }

  #hideAllOverlays() {
    this.showBoardActivityOverlay = false;
    this.boardEditOverlayInfo = null;
    this.showSettingsOverlay = false;
    this.showBoardServerAddOverlay = false;
    this.showSaveAsDialog = false;
    this.showNodeConfigurator = false;
    this.showEdgeValue = false;
    this.showCommentEditor = false;
  }

  #onShowTooltip(evt: Event) {
    const tooltipEvent = evt as BreadboardUI.Events.ShowTooltipEvent;
    if (!this.#tooltipRef.value) {
      return;
    }

    const tooltips = this.#settings?.getItem(
      BreadboardUI.Types.SETTINGS_TYPE.GENERAL,
      "Show Tooltips"
    );
    if (!tooltips?.value) {
      return;
    }

    // Add a little clearance onto the value.
    this.#tooltipRef.value.x = Math.max(tooltipEvent.x, 80);
    this.#tooltipRef.value.y = Math.max(tooltipEvent.y, 30);
    this.#tooltipRef.value.message = tooltipEvent.message;
    this.#tooltipRef.value.visible = true;
  }

  #hidePalettesAndTooltip() {
    this.#hideCommandPalette();
    this.#hideModulePalette();
    this.#hideTooltip();
  }

  #hideCommandPalette() {
    this.showCommandPalette = false;
  }

  #hideModulePalette() {
    this.showModulePalette = false;
  }

  #hideTooltip() {
    if (!this.#tooltipRef.value) {
      return;
    }

    this.#tooltipRef.value.visible = false;
  }

  #updatePageURL() {
    const url = this.#runtime.board.createURLFromTabs();
    const decodedUrl = decodeURIComponent(url.href);
    window.history.replaceState(null, "", decodedUrl);
  }

  #setBoardPendingSaveState(boardPendingSave: boolean) {
    if (boardPendingSave === this.#boardPendingSave) {
      return;
    }

    this.#boardPendingSave = boardPendingSave;
    if (this.#boardPendingSave) {
      window.addEventListener(
        "beforeunload",
        this.#confirmUnloadWithUserFirstIfNeededBound
      );
    } else {
      window.removeEventListener(
        "beforeunload",
        this.#confirmUnloadWithUserFirstIfNeededBound
      );
    }
  }

  #receivesInputPreference(target: EventTarget) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLCanvasElement
    );
  }

  #onKeyDown(evt: KeyboardEvent) {
    const isMac = navigator.platform.indexOf("Mac") === 0;
    const isCtrlCommand = isMac ? evt.metaKey : evt.ctrlKey;

    if (evt.key === "p" && isCtrlCommand) {
      evt.preventDefault();
      evt.stopImmediatePropagation();

      if (evt.shiftKey) {
        this.showCommandPalette = true;
      } else {
        this.showModulePalette = true;
      }
    }

    if (evt.key === "o" && isCtrlCommand) {
      evt.preventDefault();
      evt.stopImmediatePropagation();

      this.showOpenBoardOverlay = true;
    }

    if (evt.key === "v" && isCtrlCommand && !this.tab?.graph) {
      // Only allow a paste when there's nothing else in the composed path that
      // would accept the paste first.
      if (
        evt
          .composedPath()
          .some((target) => this.#receivesInputPreference(target))
      ) {
        return;
      }

      evt.preventDefault();

      navigator.clipboard.readText().then((content) => {
        try {
          const descriptor = JSON.parse(content) as GraphDescriptor;
          if (!("edges" in descriptor && "nodes" in descriptor)) {
            return;
          }

          this.#runtime.board.createTabFromDescriptor(descriptor);
        } catch (err) {
          this.toast(
            "Unable to paste board",
            BreadboardUI.Events.ToastType.ERROR
          );
        }
      });
      return;
    }

    if (evt.key === "s" && isCtrlCommand) {
      evt.preventDefault();

      if (evt.shiftKey) {
        this.showSaveAsDialog = true;
        return;
      }

      let saveMessage = "Board saved";
      if (this.#nodeConfiguratorRef.value) {
        this.#nodeConfiguratorRef.value.processData();
        saveMessage = "Board and configuration saved";
      }

      this.#attemptBoardSave(saveMessage);
      return;
    }

    if (evt.key === "h" && !isCtrlCommand && !evt.shiftKey) {
      const isFocusedOnRenderer = evt
        .composedPath()
        .find(
          (target) => target instanceof BreadboardUI.Elements.GraphRenderer
        );
      if (!isFocusedOnRenderer) {
        return;
      }

      this.showHistory = !this.showHistory;
    }

    if (evt.key === "z" && isCtrlCommand) {
      const isFocusedOnRenderer = evt
        .composedPath()
        .find(
          (target) => target instanceof BreadboardUI.Elements.GraphRenderer
        );

      if (!isFocusedOnRenderer) {
        return;
      }

      if (!this.tab) {
        this.toast(
          "Unable to edit; no active graph",
          BreadboardUI.Events.ToastType.ERROR
        );
        return;
      }

      if (evt.shiftKey) {
        this.#runtime.edit.redo(this.tab);
        return;
      }

      this.#runtime.edit.undo(this.tab);
      return;
    }
  }

  async #downloadRun() {
    if (!this.tab) {
      return;
    }

    const observers = this.#runtime.run.getObservers(this.tab.id);
    if (!observers) {
      return;
    }

    const currentRun = (await observers.runObserver?.runs())?.at(0);
    if (!currentRun) {
      return;
    }

    const serializedRun = await currentRun.serialize?.();
    if (!serializedRun) {
      return;
    }

    const data = JSON.stringify(serializedRun, null, 2);
    const fileName = `run-${new Date().toISOString()}.json`;
    const url = URL.createObjectURL(
      new Blob([data], { type: "application/json" })
    );

    const anchor = document.createElement("a");
    anchor.download = fileName;
    anchor.href = url;
    anchor.click();
  }

  async #selectRun(evt: BreadboardUI.Events.NodeActivitySelectedEvent) {
    if (!this.tab) {
      return;
    }

    const observers = this.#runtime.run.getObservers(this.tab.id);
    if (!observers) {
      return;
    }

    const currentRun = (await observers.runObserver?.runs())?.at(0);
    if (!currentRun) {
      return;
    }

    const event = currentRun.getEventById(evt.runId);

    if (!event) {
      console.warn(
        "The `bbrunselect` was received but the event was not found."
      );
      return;
    }

    if (event.type !== "node") {
      console.warn(
        "The `bbrunselect` was received but the event is not a node."
      );
      return;
    }

    const run = event.runs[0];
    if (!run) {
      console.warn(
        "The `bbrunselect` was received but the run was not found in the event."
      );
      return;
    }

    const topGraphObserver =
      await BreadboardUI.Utils.TopGraphObserver.fromRun(run);

    if (!topGraphObserver) {
      return;
    }

    const runGraph = topGraphObserver.current()?.graph ?? null;
    if (runGraph) {
      runGraph.title = evt.nodeTitle;
      this.#runtime.board.createTabFromRun(
        runGraph,
        topGraphObserver,
        createPastRunObserver(run),
        true
      );
    }
  }

  #attemptBoardStop() {
    const tabId = this.tab?.id ?? null;
    const abortController = this.#runtime.run.getAbortSignal(tabId);
    if (!abortController) {
      return;
    }

    abortController.abort("Stopped board");
    const runner = this.#runtime.run.getRunner(tabId);
    runner?.run();
    this.requestUpdate();
  }

  async #clearBoardSave() {
    if (!this.tab) {
      return;
    }

    const tabToSave = this.tab;
    this.#tabSaveId.delete(tabToSave.id);
  }

  #attemptUndo() {
    if (!this.#runtime.edit.canUndo(this.tab)) {
      return;
    }

    this.#runtime.edit.undo(this.tab);
  }

  #attemptRedo() {
    if (!this.#runtime.edit.canRedo(this.tab)) {
      return;
    }

    this.#runtime.edit.redo(this.tab);
  }

  async #attemptBoardSave(
    message = "Board saved",
    ackUser = true,
    showSaveAsIfNeeded = true,
    timeout = 0
  ) {
    if (!this.tab) {
      return;
    }

    const tabToSave = this.tab;
    if (tabToSave.readOnly) {
      return;
    }

    if (timeout !== 0) {
      const saveId = globalThis.crypto.randomUUID();
      this.#tabSaveId.set(tabToSave.id, saveId);
      await new Promise((r) => setTimeout(r, timeout));

      // Check the tab still exists.
      if (!this.#runtime.board.tabs.has(tabToSave.id)) {
        return;
      }

      // If the stored save ID has changed then the user has made a newer change
      // and there is another save pending; therefore, ignore this request.
      const storedSaveId = this.#tabSaveId.get(tabToSave.id);
      if (!storedSaveId || storedSaveId !== saveId) {
        return;
      }

      this.#tabSaveId.delete(tabToSave.id);
    }

    const saveStatus = this.#tabSaveStatus.get(tabToSave.id);
    if (
      saveStatus &&
      saveStatus === BreadboardUI.Types.BOARD_SAVE_STATUS.SAVING
    ) {
      return;
    }

    if (!this.#runtime.board.canSave(tabToSave.id)) {
      if (showSaveAsIfNeeded) {
        this.showSaveAsDialog = true;
      }
      return;
    }

    let id;
    if (ackUser) {
      id = this.toast(
        "Saving board...",
        BreadboardUI.Events.ToastType.PENDING,
        true
      );
    }

    this.#tabSaveStatus.set(
      tabToSave.id,
      BreadboardUI.Types.BOARD_SAVE_STATUS.SAVING
    );
    this.requestUpdate();

    try {
      const { result } = await this.#runtime.board.save(tabToSave.id);

      this.#tabSaveStatus.set(
        tabToSave.id,
        BreadboardUI.Types.BOARD_SAVE_STATUS.SAVED
      );
      this.requestUpdate();

      if (!result) {
        this.#tabSaveStatus.set(
          tabToSave.id,
          BreadboardUI.Types.BOARD_SAVE_STATUS.ERROR
        );
        this.requestUpdate();
        return;
      }

      this.#setBoardPendingSaveState(false);
      if (ackUser && id) {
        this.toast(
          message,
          BreadboardUI.Events.ToastType.INFORMATION,
          false,
          id
        );
      }
    } catch (err) {
      this.#tabSaveStatus.set(
        tabToSave.id,
        BreadboardUI.Types.BOARD_SAVE_STATUS.ERROR
      );
      this.requestUpdate();
    }
  }

  async #attemptBoardSaveAs(
    boardServerName: string,
    location: string,
    fileName: string,
    graph: GraphDescriptor
  ) {
    if (this.#isSaving) {
      return;
    }

    const id = this.toast(
      "Saving board...",
      BreadboardUI.Events.ToastType.PENDING,
      true
    );

    this.#isSaving = true;
    const { result, error, url } = await this.#runtime.board.saveAs(
      boardServerName,
      location,
      fileName,
      graph
    );
    this.#isSaving = false;

    if (!result || !url) {
      this.toast(
        error || "Unable to create board",
        BreadboardUI.Events.ToastType.ERROR,
        false,
        id
      );
      return;
    }

    this.#setBoardPendingSaveState(false);
    this.#persistBoardServerAndLocation(boardServerName, location);

    this.#attemptBoardStart(new BreadboardUI.Events.StartEvent(url.href));
    this.toast(
      "Board saved",
      BreadboardUI.Events.ToastType.INFORMATION,
      false,
      id
    );
  }

  async #attemptBoardDelete(
    boardServerName: string,
    url: string,
    isActive: boolean
  ) {
    if (
      !confirm(
        "Are you sure you want to delete this board? This cannot be undone"
      )
    ) {
      return;
    }

    const id = this.toast(
      "Deleting board...",
      BreadboardUI.Events.ToastType.PENDING,
      true
    );

    const { result, error } = await this.#runtime.board.delete(
      boardServerName,
      url
    );
    if (result) {
      this.toast(
        "Board deleted",
        BreadboardUI.Events.ToastType.INFORMATION,
        false,
        id
      );
    } else {
      this.toast(
        error || "Unexpected error",
        BreadboardUI.Events.ToastType.ERROR,
        false,
        id
      );
    }

    if (this.tab && isActive) {
      this.#runtime.board.closeTab(this.tab.id);
      this.#removeRecentUrl(url);
    }

    this.boardServerNavState = globalThis.crypto.randomUUID();
  }

  #attemptBoardCreate(graph: GraphDescriptor) {
    this.#saveAsState = {
      title: "Create new board",
      graph,
      isNewBoard: true,
    };

    this.showSaveAsDialog = true;
  }

  #setPageTitle(title: string | null) {
    const suffix = "Breadboard - Visual Editor";
    if (title) {
      window.document.title = `${title} - ${suffix}`;
      return;
    }

    window.document.title = suffix;
  }

  async #trackRecentBoard(url: string) {
    url = url.replace(window.location.origin, "");
    const currentIndex = this.#recentBoards.findIndex(
      (board) => board.url === url
    );
    if (currentIndex === -1) {
      this.#recentBoards.unshift({
        title: this.tab?.graph.title ?? "Untitled Board",
        url,
      });
    } else {
      const [item] = this.#recentBoards.splice(currentIndex, 1);
      this.#recentBoards.unshift(item);
    }

    if (this.#recentBoards.length > 5) {
      this.#recentBoards.length = 5;
    }

    await this.#recentBoardStore.store(this.#recentBoards);
  }

  async #removeRecentUrl(url: string) {
    url = url.replace(window.location.origin, "");
    const count = this.#recentBoards.length;

    this.#recentBoards = this.#recentBoards.filter(
      (board) => board.url !== url
    );

    if (count === this.#recentBoards.length) {
      return;
    }

    await this.#recentBoardStore.store(this.#recentBoards);
  }

  async #runBoard(config: RunConfig, history?: InspectableRunSequenceEntry[]) {
    if (!this.tab) {
      console.error("Unable to run board, no active tab");
      return;
    }

    this.#runtime.run.runBoard(this.tab, config, history);
  }

  #clearTabParams() {
    const pageUrl = new URL(window.location.href);
    const tabs = [...pageUrl.searchParams].filter(([id]) =>
      id.startsWith("tab")
    );

    for (const [id] of tabs) {
      pageUrl.searchParams.delete(id);
    }

    window.history.replaceState(null, "", pageUrl);
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

  untoast(id: string | undefined) {
    if (!id) {
      return;
    }

    this.toasts.delete(id);
    this.requestUpdate();
  }

  toast(
    message: string,
    type: BreadboardUI.Events.ToastType,
    persistent = false,
    id = globalThis.crypto.randomUUID()
  ) {
    if (message.length > 70) {
      message = message.slice(0, 67) + "...";
    }

    this.toasts.set(id, { message, type, persistent });
    this.requestUpdate();

    return id;
  }

  async #getProxyURL(urlString: string): Promise<string | null> {
    const url = new URL(urlString, window.location.href);
    for (const boardServer of this.#boardServers) {
      const proxyURL = await boardServer.canProxy?.(url);
      if (proxyURL) {
        return proxyURL;
      }
    }
    return null;
  }

  #confirmUnloadWithUserFirstIfNeeded(evt: Event) {
    if (!this.#boardPendingSave) {
      return;
    }

    evt.returnValue = true;
    return true;
  }

  async #confirmSaveWithUserFirstIfNeeded() {
    if (!this.#boardPendingSave) {
      return;
    }

    if (!this.tab?.graph || !this.tab?.graph.url) {
      return;
    }

    try {
      const url = new URL(this.tab?.graph.url, window.location.href);
      const boardServer = this.#runtime.board.getBoardServerForURL(url);
      if (!boardServer) {
        return;
      }

      const capabilities = boardServer.canProvide(url);
      if (!capabilities || !capabilities.save) {
        return;
      }
    } catch (err) {
      // Likely an error with the URL.
      return;
    }

    if (
      !confirm("The current board isn't saved - would you like to save first?")
    ) {
      return;
    }

    return this.#attemptBoardSave();
  }

  async #handleBoardInfoUpdate(evt: BreadboardUI.Events.BoardInfoUpdateEvent) {
    if (!this.tab) {
      this.toast(
        "Unable to edit; no active graph",
        BreadboardUI.Events.ToastType.ERROR
      );
      return;
    }

    if (evt.subGraphId) {
      await this.#runtime.edit.updateSubBoardInfo(
        this.tab,
        evt.subGraphId,
        evt.title,
        evt.version,
        evt.description,
        evt.status,
        evt.isTool,
        evt.isComponent
      );
    } else {
      this.#runtime.edit.updateBoardInfo(
        this.tab,
        evt.title,
        evt.version,
        evt.description,
        evt.status,
        evt.isTool,
        evt.isComponent
      );
    }
  }

  #persistBoardServerAndLocation(boardServerName: string, location: string) {
    this.selectedBoardServer = boardServerName;
    this.selectedLocation = location;

    globalThis.sessionStorage.setItem(
      `${STORAGE_PREFIX}-board-server`,
      `${boardServerName}::${location}`
    );
  }

  #attemptLoad(evt: DragEvent) {
    if (
      !evt.dataTransfer ||
      !evt.dataTransfer.files ||
      !evt.dataTransfer.files.length
    ) {
      return;
    }

    const isSerializedRun = (
      data: SerializedRun | GraphDescriptor
    ): data is SerializedRun => {
      return "timeline" in data;
    };

    const fileDropped = evt.dataTransfer.files[0];
    fileDropped.text().then((data) => {
      try {
        const runData = JSON.parse(data) as SerializedRun | GraphDescriptor;
        if (isSerializedRun(runData)) {
          const runObserver = createRunObserver(this.#graphStore, {
            logLevel: "debug",
            dataStore: this.#dataStore,
            sandbox,
          });

          evt.preventDefault();

          runObserver.load(runData).then(async (result) => {
            if (result.success) {
              // TODO: Append the run to the runObserver so that it can be obtained later.
              const topGraphObserver =
                await BreadboardUI.Utils.TopGraphObserver.fromRun(result.run);
              const descriptor = topGraphObserver?.current()?.graph ?? null;

              if (descriptor) {
                this.#runtime.board.createTabFromRun(
                  descriptor,
                  topGraphObserver,
                  runObserver,
                  true
                );
              } else {
                this.toast(
                  "Unable to load run data",
                  BreadboardUI.Events.ToastType.ERROR
                );
              }
            } else {
              this.toast(
                "Unable to load run data",
                BreadboardUI.Events.ToastType.ERROR
              );
            }
          });
        } else {
          this.#runtime.board.createTabFromDescriptor(runData);
        }
      } catch (err) {
        console.warn(err);
        this.toast("Unable to load file", BreadboardUI.Events.ToastType.ERROR);
      }
    });
  }

  async #attemptBoardStart(evt: BreadboardUI.Events.StartEvent) {
    if (evt.url) {
      let id;
      const loadingTimeout = setTimeout(() => {
        id = this.toast(
          "Loading...",
          BreadboardUI.Events.ToastType.PENDING,
          true
        );
      }, LOADING_TIMEOUT);

      await this.#runtime.board.createTabFromURL(evt.url);
      clearTimeout(loadingTimeout);
      this.untoast(id);
    } else if (evt.descriptor) {
      this.#runtime.board.createTabFromDescriptor(evt.descriptor);
    }
  }

  async #attemptNodeRun(id: string, stopAfter = true) {
    if (!this.tab) {
      console.warn(
        "NodeRunRequestEvent dispatched, but no current tab is present. Likely a bug somewhere."
      );
      return;
    }
    const firstRun = (
      await this.#runtime.run.getObservers(this.tab.id)?.runObserver?.runs()
    )?.at(0);

    const nodeConfig = this.#runtime.edit
      .getEditor(this.tab)
      ?.inspect("")
      ?.nodeById(id)
      ?.configuration();

    const configResult = await getRunNodeConfig(id, nodeConfig, firstRun);
    if (!configResult.success) {
      return;
    }
    const { config, history } = configResult.result;
    if (!stopAfter && config) {
      delete config.stopAfter;
    }

    if (!this.tab?.graph?.url) {
      return;
    }

    const graph = this.tab?.graph;

    this.showBoardActivityOverlay = true;

    this.#runBoard(
      addNodeProxyServerConfig(
        this.#proxy,
        {
          url: this.tab.graph.url!,
          runner: graph,
          diagnostics: true,
          kits: [], // The kits are added by the runtime.
          loader: this.#runtime.board.getLoader(),
          store: this.#dataStore,
          inputs: BreadboardUI.Data.inputsFromSettings(this.#settings),
          interactiveSecrets: true,
          graphStore: this.#graphStore,
          ...config,
        },
        this.#settings,
        this.proxyFromUrl,
        await this.#getProxyURL(this.tab?.graph.url)
      ),
      history
    );
  }

  #attemptModuleCreate(moduleId: ModuleIdentifier) {
    if (!this.tab) {
      return;
    }

    const newModule: Module = {
      code: defaultModuleContent(),
      metadata: {},
    };

    const createAsTypeScript =
      this.#settings
        ?.getSection(BreadboardUI.Types.SETTINGS_TYPE.GENERAL)
        .items.get("Use TypeScript as Module default language")?.value ?? false;
    if (createAsTypeScript) {
      newModule.metadata = {
        source: {
          code: defaultModuleContent("typescript"),
          language: "typescript",
        },
      };
    }

    this.#runtime.edit.createModule(this.tab, moduleId, newModule);
  }

  #showBoardEditOverlay(
    x: number | null,
    y: number | null,
    subGraphId: string | null
  ) {
    if (!this.tab) {
      return;
    }

    const graph = subGraphId
      ? this.tab.graph.graphs?.[subGraphId]
      : this.tab.graph;

    if (!graph) {
      return;
    }

    const { description, title, version, metadata } = graph;

    this.boardEditOverlayInfo = {
      description: description ?? "",
      isTool: metadata?.tags?.includes("tool") ?? false,
      isComponent: metadata?.tags?.includes("component") ?? false,
      published: metadata?.tags?.includes("published") ?? false,
      subGraphId,
      title: title ?? "",
      version: version ?? "",
      x,
      y,
    };
  }

  async #setNodeDataForConfiguration(
    configuration: Partial<BreadboardUI.Types.NodePortConfiguration>,
    nodeConfiguration: NodeConfiguration | null
  ) {
    if (!configuration.id) {
      console.warn("Unable to set node data, no ID");
      return;
    }

    const { id, subGraphId } = configuration;

    const title = this.#runtime.edit.getNodeTitle(this.tab, id, subGraphId);

    const [ports, nodeType, metadata] = await Promise.all([
      this.#runtime.edit.getNodePorts(this.tab, id, subGraphId),
      this.#runtime.edit.getNodeType(this.tab, id, subGraphId),
      this.#runtime.edit.getNodeMetadata(this.tab, id, subGraphId),
    ]);

    if (!ports) {
      return;
    }

    this.showNodeConfigurator = true;
    this.#nodeConfiguratorData = {
      id,
      x: configuration.x ?? 0,
      y: configuration.y ?? 0,
      title,
      type: nodeType?.title ? nodeType?.title : null,
      selectedPort: configuration.selectedPort ?? null,
      subGraphId: subGraphId ?? null,
      ports,
      metadata,
      nodeConfiguration,
      addHorizontalClickClearance:
        configuration.addHorizontalClickClearance ?? false,
    };
  }

  render() {
    const toasts = html`${map(
      this.toasts,
      ([toastId, { message, type, persistent }], idx) => {
        const offset = this.toasts.size - idx - 1;
        return html`<bb-toast
          .toastId=${toastId}
          .offset=${offset}
          .message=${message}
          .type=${type}
          .timeout=${persistent ? 0 : nothing}
          @bbtoastremoved=${(evt: BreadboardUI.Events.ToastRemovedEvent) => {
            this.toasts.delete(evt.toastId);
          }}
        ></bb-toast>`;
      }
    )}`;

    const showingOverlay =
      this.boardEditOverlayInfo !== null ||
      this.showSettingsOverlay ||
      this.showFirstRun ||
      this.showBoardServerAddOverlay ||
      this.showSaveAsDialog ||
      this.showNodeConfigurator ||
      this.showEdgeValue ||
      this.showCommentEditor ||
      this.showOpenBoardOverlay ||
      this.showCommandPalette ||
      this.showModulePalette ||
      this.showNewWorkspaceItemOverlay;

    const nav = this.#initialize.then(() => {
      return html`<bb-nav
        .visible=${this.showNav}
        .url=${this.tab?.graph.url ?? null}
        .selectedBoardServer=${this.selectedBoardServer}
        .selectedLocation=${this.selectedLocation}
        .boardServers=${this.#boardServers}
        .boardServerNavState=${this.boardServerNavState}
        ?inert=${showingOverlay}
        @pointerdown=${(evt: Event) => evt.stopPropagation()}
        @bbreset=${() => {
          if (!this.tab) {
            return;
          }

          this.#runtime.board.closeTab(this.tab.id);
        }}
        @bbgraphboardserveradd=${() => {
          this.showBoardServerAddOverlay = true;
        }}
        @bbgraphboardserverblankboard=${() => {
          this.#attemptBoardCreate(blankLLMContent());
        }}
        @bbgraphboardserverdeleterequest=${async (
          evt: BreadboardUI.Events.GraphBoardServerDeleteRequestEvent
        ) => {
          await this.#attemptBoardDelete(
            evt.boardServerName,
            evt.url,
            evt.isActive
          );
        }}
        @bbstart=${(evt: BreadboardUI.Events.StartEvent) => {
          this.#attemptBoardStart(evt);
        }}
        @bbgraphboardserverrefresh=${async (
          evt: BreadboardUI.Events.GraphBoardServerRefreshEvent
        ) => {
          const boardServer = this.#runtime.board.getBoardServerByName(
            evt.boardServerName
          );
          if (!boardServer) {
            return;
          }

          const refreshed = await boardServer.refresh(evt.location);
          if (refreshed) {
            this.toast(
              "Source files refreshed",
              BreadboardUI.Events.ToastType.INFORMATION
            );
          } else {
            this.toast(
              "Unable to refresh source files",
              BreadboardUI.Events.ToastType.WARNING
            );
          }

          this.boardServerNavState = globalThis.crypto.randomUUID();
        }}
        @bbgraphboardserverdisconnect=${async (
          evt: BreadboardUI.Events.GraphBoardServerDisconnectEvent
        ) => {
          await this.#runtime.board.disconnect(evt.location);
          this.boardServerNavState = globalThis.crypto.randomUUID();
        }}
        @bbgraphboardserverrenewaccesssrequest=${async (
          evt: BreadboardUI.Events.GraphBoardServerRenewAccessRequestEvent
        ) => {
          const boardServer = this.#runtime.board.getBoardServerByName(
            evt.boardServerName
          );

          if (!boardServer) {
            return;
          }

          if (boardServer.renewAccess) {
            await boardServer.renewAccess();
          }

          this.boardServerNavState = globalThis.crypto.randomUUID();
        }}
        @bbgraphboardserverloadrequest=${async (
          evt: BreadboardUI.Events.GraphBoardServerLoadRequestEvent
        ) => {
          this.#attemptBoardStart(new BreadboardUI.Events.StartEvent(evt.url));
        }}
        @bbgraphboardserverselectionchange=${(
          evt: BreadboardUI.Events.GraphBoardServerSelectionChangeEvent
        ) => {
          this.#persistBoardServerAndLocation(
            evt.selectedBoardServer,
            evt.selectedLocation
          );
        }}
      ></bb-nav> `;
    });

    const uiController = this.#initialize
      .then(() => {
        const observers = this.#runtime?.run.getObservers(this.tab?.id ?? null);
        if (observers && observers.runObserver) {
          return observers.runObserver?.runs();
        }

        return [];
      })
      .then((runs: InspectableRun[]) => {
        const observers = this.#runtime?.run.getObservers(this.tab?.id ?? null);
        const topGraphResult =
          observers?.topGraphObserver?.current() ??
          TopGraphObserver.entryResult(this.tab?.graph);
        const inputsFromLastRun = runs[1]?.inputs() ?? null;
        const tabURLs = this.#runtime.board.getTabURLs();
        const showNodeTypeDescriptions =
          (this.#settings
            ?.getSection(BreadboardUI.Types.SETTINGS_TYPE.GENERAL)
            .items.get("Show Node Type Descriptions")?.value as boolean) ??
          false;

        const offerConfigurationEnhancements =
          this.#settings?.getItem(
            BreadboardUI.Types.SETTINGS_TYPE.GENERAL,
            "Offer Configuration Enhancements"
          )?.value ?? false;

        let tabStatus = BreadboardUI.Types.STATUS.STOPPED;
        if (this.tab) {
          tabStatus =
            this.#tabBoardStatus.get(this.tab.id) ??
            BreadboardUI.Types.STATUS.STOPPED;
        }

        let tabLoadStatus = BreadboardUI.Types.BOARD_LOAD_STATUS.LOADING;
        if (this.tab) {
          tabLoadStatus =
            this.#tabLoadStatus.get(this.tab.id) ??
            BreadboardUI.Types.BOARD_LOAD_STATUS.LOADING;
        }

        let boardOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.boardEditOverlayInfo) {
          const location = {
            x: this.boardEditOverlayInfo.x ?? 160,
            y: this.boardEditOverlayInfo.y ?? 100,
            addHorizontalClickClearance: true,
          };

          boardOverlay = html`<bb-board-details-overlay
            .boardTitle=${this.boardEditOverlayInfo.title}
            .boardVersion=${this.boardEditOverlayInfo.version}
            .boardDescription=${this.boardEditOverlayInfo.description}
            .boardPublished=${this.boardEditOverlayInfo.published}
            .boardIsTool=${this.boardEditOverlayInfo.isTool}
            .boardIsComponent=${this.boardEditOverlayInfo.isComponent}
            .subGraphId=${this.boardEditOverlayInfo.subGraphId}
            .location=${location}
            @bboverlaydismissed=${() => {
              this.boardEditOverlayInfo = null;
            }}
            @bbboardinfoupdate=${async (
              evt: BreadboardUI.Events.BoardInfoUpdateEvent
            ) => {
              await this.#handleBoardInfoUpdate(evt);
              this.boardEditOverlayInfo = null;
              this.requestUpdate();
            }}
          ></bb-board-details-overlay>`;
        }

        let settingsOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showSettingsOverlay) {
          settingsOverlay = html`<bb-settings-edit-overlay
            class="settings"
            .settings=${this.#settings?.values || null}
            @bbsettingsupdate=${async (
              evt: BreadboardUI.Events.SettingsUpdateEvent
            ) => {
              if (!this.#settings) {
                return;
              }

              try {
                await this.#settings.save(evt.settings);
                this.toast(
                  "Saved settings",
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } catch (err) {
                console.warn(err);
                this.toast(
                  "Unable to save settings",
                  BreadboardUI.Events.ToastType.ERROR
                );
              }

              this.requestUpdate();
            }}
            @bboverlaydismissed=${() => {
              this.showSettingsOverlay = false;
            }}
          ></bb-settings-edit-overlay>`;
        }

        let showNewWorkspaceItemOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showNewWorkspaceItemOverlay) {
          showNewWorkspaceItemOverlay = html`<bb-new-workspace-item-overlay
            @bbworkspaceitemcreate=${async (
              evt: BreadboardUI.Events.WorkspaceItemCreateEvent
            ) => {
              this.showNewWorkspaceItemOverlay = false;

              let source: Module | undefined = undefined;
              if (evt.itemType === "imperative") {
                const createAsTypeScript =
                  this.#settings
                    ?.getSection(BreadboardUI.Types.SETTINGS_TYPE.GENERAL)
                    .items.get("Use TypeScript as Module default language")
                    ?.value ?? false;

                if (createAsTypeScript) {
                  source = {
                    code: "",
                    metadata: {
                      title: evt.title ?? "Untitled item",
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
                      title: evt.title ?? "Untitled item",
                    },
                  };
                }
              }

              await this.#runtime.edit.createWorkspaceItem(
                this.tab,
                evt.itemType,
                evt.title ?? "Untitled item",
                crypto.randomUUID(),
                source
              );
            }}
            @bboverlaydismissed=${() => {
              this.showNewWorkspaceItemOverlay = false;
            }}
          ></bb-new-workspace-item-overlay>`;
        }

        let firstRunOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showFirstRun) {
          const currentUrl = new URL(window.location.href);
          const boardServerUrl = currentUrl.searchParams.get("boardserver");

          firstRunOverlay = html`<bb-first-run-overlay
            class="settings"
            .settings=${this.#settings?.values || null}
            .boardServerUrl=${boardServerUrl}
            .boardServers=${this.#boardServers}
            @bbgraphboardserverconnectrequest=${async (
              evt: BreadboardUI.Events.GraphBoardServerConnectRequestEvent
            ) => {
              const result = await this.#runtime.board.connect(
                evt.location,
                evt.apiKey
              );

              if (result.error) {
                this.toast(result.error, BreadboardUI.Events.ToastType.ERROR);
              }

              if (!result.success) {
                return;
              }

              this.showBoardServerAddOverlay = false;
            }}
            @bbsettingsupdate=${async (
              evt: BreadboardUI.Events.SettingsUpdateEvent
            ) => {
              if (!this.#settings) {
                return;
              }

              try {
                await this.#settings.save(evt.settings);
                this.toast(
                  "Welcome to Breadboard!",
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } catch (err) {
                console.warn(err);
                this.toast(
                  "Unable to save settings",
                  BreadboardUI.Events.ToastType.ERROR
                );
              }

              this.#setUrlParam("firstrun", null);
              this.#setUrlParam("boardserver", null);
              this.showFirstRun = false;
              this.requestUpdate();
            }}
            @bboverlaydismissed=${() => {
              this.#setUrlParam("firstrun", null);
              this.#setUrlParam("boardserver", null);
              this.showFirstRun = false;
            }}
          ></bb-first-run-overlay>`;
        }

        let boardServerAddOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showBoardServerAddOverlay) {
          boardServerAddOverlay = html`<bb-board-server-overlay
            .showGoogleDrive=${true}
            .boardServers=${this.#boardServers}
            @bboverlaydismissed=${() => {
              this.showBoardServerAddOverlay = false;
            }}
            @bbgraphboardserverconnectrequest=${async (
              evt: BreadboardUI.Events.GraphBoardServerConnectRequestEvent
            ) => {
              const result = await this.#runtime.board.connect(
                evt.location,
                evt.apiKey
              );

              if (result.error) {
                this.toast(result.error, BreadboardUI.Events.ToastType.ERROR);
              }

              if (!result.success) {
                return;
              }

              // Trigger a re-render.
              this.showBoardServerAddOverlay = false;
            }}
          ></bb-board-server-overlay>`;
        }

        const run = runs[0] ?? null;
        const events = runs[0]?.events ?? [];

        // Maybe a hack, not sure yet. When the run status is "STOPPED",
        // it more than likely means we're in the "step-by-step" mode,
        // and so any incomplete nodes (the ones that are next in the step)
        // should be hidden.
        const hideLast = tabStatus === BreadboardUI.Types.STATUS.STOPPED;

        // We have a guard around the board activity overlay to prevent it
        // from re-rendering on every change (which triggers the entry
        // animation). This means we need to "manually" send it the run and
        // events on each pass, which is done immediately after this.
        const boardActivityOverlay = html`${guard([], () => {
          return html`<bb-board-activity-overlay
            ${ref(this.#boardActivityRef)}
            .location=${this.#boardActivityLocation}
            .run=${run}
            .events=${events}
            .topGraphResult=${topGraphResult}
            .settings=${this.#settings}
            .boardServers=${this.#boardServers}
            .hideLast=${hideLast}
            .inputsFromLastRun=${inputsFromLastRun}
            @bboverlaydismissed=${() => {
              if (!this.#boardActivityRef.value) {
                return;
              }

              if (this.#boardActivityRef.value.persist) {
                return;
              }

              this.showBoardActivityOverlay = false;
              this.#boardActivityLocation = null;
            }}
            @bbrunisolatednode=${async (
              evt: BreadboardUI.Events.RunIsolatedNodeEvent
            ) => {
              await this.#attemptNodeRun(evt.id, evt.stopAfter);
            }}
            @bbinputenter=${async (
              event: BreadboardUI.Events.InputEnterEvent
            ) => {
              if (!this.#settings || !this.tab) {
                return;
              }

              const isSecret = "secret" in event.data;
              const runner = this.#runtime.run.getRunner(this.tab.id);
              if (!runner) {
                throw new Error("Can't send input, no runner");
              }
              if (isSecret) {
                if (this.#secretsHelper) {
                  this.#secretsHelper.receiveSecrets(event);
                  if (
                    this.#secretsHelper.hasAllSecrets() &&
                    !runner?.running()
                  ) {
                    const secrets = this.#secretsHelper.getSecrets();
                    this.#secretsHelper = null;
                    runner?.run(secrets);
                  }
                } else {
                  // This is the case when the "secret" event hasn't yet
                  // been received.
                  // Likely, this is a side effect of how the
                  // activity-log is built: it relies on the run observer
                  // for the events list, and the run observer updates the
                  // list of run events before the run API dispatches
                  // the "secret" event.
                  this.#secretsHelper = new SecretsHelper(this.#settings!);
                  this.#secretsHelper.receiveSecrets(event);
                }
              } else {
                const data = event.data as InputValues;
                if (!runner.running()) {
                  runner.run(data);
                }
              }
            }}
          ></bb-board-activity-overlay>`;
        })}`;

        // Update board activity values.
        if (this.#boardActivityRef.value) {
          const latest = events.at(-1);
          let showDebugControls = false;
          if (latest && latest.type === "node") {
            showDebugControls = tabStatus === "stopped" && latest.end === null;
          }

          this.#boardActivityRef.value.run = run;
          this.#boardActivityRef.value.events = events;
          this.#boardActivityRef.value.inputsFromLastRun = inputsFromLastRun;
          this.#boardActivityRef.value.hideLast = hideLast;
          this.#boardActivityRef.value.showDebugControls = showDebugControls;
          this.#boardActivityRef.value.nextNodeId =
            topGraphResult.currentNode?.descriptor.id ?? null;
        }

        let historyOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showHistory) {
          const history = this.#runtime.edit.getHistory(this.tab);
          if (history) {
            historyOverlay = html`<bb-graph-history
              .entries=${history.entries()}
              .canRedo=${history.canRedo()}
              .canUndo=${history.canUndo()}
              .count=${history.entries().length}
              .idx=${history.index()}
              @bbundo=${() => {
                if (!history.canUndo()) {
                  return;
                }

                history.undo();
                this.requestUpdate();
              }}
              @bbredo=${() => {
                if (!history.canRedo()) {
                  return;
                }

                history.redo();
                this.requestUpdate();
              }}
            ></bb-graph-history>`;
          }
        }

        let saveAsDialogOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showSaveAsDialog) {
          saveAsDialogOverlay = html`<bb-save-as-overlay
            .panelTitle=${this.#saveAsState?.title ?? "Save As..."}
            .boardServers=${this.#boardServers}
            .selectedBoardServer=${this.selectedBoardServer}
            .selectedLocation=${this.selectedLocation}
            .graph=${structuredClone(
              this.#saveAsState?.graph ?? this.tab?.graph
            )}
            .isNewBoard=${this.#saveAsState?.isNewBoard ?? false}
            @bboverlaydismissed=${() => {
              this.showSaveAsDialog = false;
            }}
            @bbgraphboardserversaveboard=${async (
              evt: BreadboardUI.Events.GraphBoardServerSaveBoardEvent
            ) => {
              this.showSaveAsDialog = false;

              const { boardServerName, location, fileName, graph } = evt;
              await this.#attemptBoardSaveAs(
                boardServerName,
                location,
                fileName,
                graph
              );
            }}
          ></bb-save-as-overlay>`;

          this.#saveAsState = null;
        }

        let nodeConfiguratorOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showNodeConfigurator) {
          const canRunNode = this.#nodeConfiguratorData
            ? topGraphResult.nodeInformation.canRunNode(
                this.#nodeConfiguratorData.id
              )
            : false;
          nodeConfiguratorOverlay = html`<bb-node-configuration-overlay
            ${ref(this.#nodeConfiguratorRef)}
            .canRunNode=${canRunNode}
            .value=${this.#nodeConfiguratorData}
            .graph=${this.tab?.graph}
            .boardServers=${this.#boardServers}
            .showTypes=${false}
            .offerConfigurationEnhancements=${offerConfigurationEnhancements}
            .showNodeTypeDescriptions=${showNodeTypeDescriptions}
            .readOnly=${this.tab?.readOnly}
            @bbworkspaceitemchosen=${(
              evt: BreadboardUI.Events.WorkspaceItemChosenEvent
            ) => {
              if (!this.tab) {
                return;
              }

              this.#nodeConfiguratorData = null;
              this.showNodeConfigurator = false;
              this.#runtime.board.changeWorkspaceItem(
                this.tab.id,
                evt.subGraphId,
                evt.moduleId
              );
            }}
            @bbmodulecreate=${(evt: BreadboardUI.Events.ModuleCreateEvent) => {
              this.#attemptModuleCreate(evt.moduleId);
              this.#nodeConfiguratorData = null;
              this.showNodeConfigurator = false;
            }}
            @bbrunisolatednode=${async (
              evt: BreadboardUI.Events.RunIsolatedNodeEvent
            ) => {
              await this.#attemptNodeRun(evt.id);
            }}
            @bbenhancenodeconfiguration=${(
              evt: BreadboardUI.Events.EnhanceNodeConfigurationEvent
            ) => {
              if (!this.tab) {
                return;
              }

              const enhancer: EnhanceSideboard = {
                enhance: async (config) => {
                  // Currently, the API of the board is fixed.
                  // Inputs: { config }
                  // Outputs: { config }
                  // We should probably have some way to codify the shape.
                  const invocationResult =
                    await this.#runtime.run.invokeSideboard(
                      this.tab!.kits,
                      "/side-boards/enhance-configuration.bgl.json",
                      this.#runtime.board.getLoader(),
                      { config },
                      this.#settings
                    );
                  if (!invocationResult.success) {
                    return invocationResult;
                  }
                  const result = invocationResult.result;
                  if ("$error" in result) {
                    return {
                      success: false,
                      error: BreadboardUI.Utils.formatError(
                        result.$error as string
                      ),
                    };
                  }
                  return {
                    success: true,
                    result,
                  };
                },
              };

              this.#runtime.edit.enhanceNodeConfiguration(
                this.tab,
                this.tab.subGraphId,
                evt.id,
                enhancer,
                evt.property,
                evt.value
              );
            }}
            @bboverlaydismissed=${() => {
              this.#nodeConfiguratorData = null;
              this.showNodeConfigurator = false;
            }}
            @bbnodepartialupdate=${async (
              evt: BreadboardUI.Events.NodePartialUpdateEvent
            ) => {
              if (!this.tab) {
                this.toast(
                  "Unable to edit; no active graph",
                  BreadboardUI.Events.ToastType.ERROR
                );
                return;
              }

              if (!evt.debugging) {
                this.#nodeConfiguratorData = null;
                this.showNodeConfigurator = false;
              }

              this.#runtime.edit.changeNodeConfigurationPart(
                this.tab,
                evt.id,
                evt.configuration,
                evt.subGraphId,
                evt.metadata
              );
            }}
          ></bb-node-configuration-overlay>`;
        }

        let edgeValueOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showEdgeValue) {
          // Ensure that the edge has the latest values.
          const edge = this.#edgeValueData?.edge ?? null;
          const nodeValue = edge?.from.descriptor.id ?? null;
          const nodeType = edge?.from.descriptor.type ?? "unknown";
          const canRunNode = nodeValue
            ? topGraphResult.nodeInformation.canRunNode(nodeValue)
            : false;
          if (this.#edgeValueData && edge) {
            const info =
              topGraphResult.edgeValues.get(edge as InspectableEdge) ?? null;

            this.#edgeValueData = { ...this.#edgeValueData, info };
          }

          edgeValueOverlay = html`<bb-edge-value-overlay
            .canRunNode=${canRunNode}
            .showRegenerateEdgeValueButton=${nodeType !== "input"}
            .readOnly=${topGraphResult.status !== "stopped"}
            .edgeValue=${this.#edgeValueData}
            .graph=${this.tab?.graph}
            .subGraphId=${this.tab?.subGraphId}
            .boardServers=${this.#boardServers}
            @bbrunisolatednode=${async (
              evt: BreadboardUI.Events.RunIsolatedNodeEvent
            ) => {
              await this.#attemptNodeRun(evt.id);
            }}
            @bbedgevalueupdate=${(
              evt: BreadboardUI.Events.EdgeValueUpdateEvent
            ) => {
              // TODO: Process this for the EditableRun.
              console.log(evt);
              this.showEdgeValue = false;
            }}
            @bboverlaydismissed=${() => {
              this.showEdgeValue = false;
            }}
          ></bb-edge-value-overlay>`;
        }

        let commentOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showCommentEditor) {
          commentOverlay = html`<bb-comment-overlay
            .commentValue=${this.#commentValueData}
            @bbcommentupdate=${(
              evt: BreadboardUI.Events.CommentUpdateEvent
            ) => {
              this.#commentValueData = null;
              this.showCommentEditor = false;

              this.#runtime.edit.changeComment(
                this.tab,
                evt.id,
                evt.text,
                evt.subGraphId
              );
            }}
            @bboverlaydismissed=${() => {
              this.#commentValueData = null;
              this.showCommentEditor = false;
            }}
          ></bb-comment-overlay>`;
        }

        let previewOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.previewOverlayURL) {
          previewOverlay = html`<bb-overlay @bboverlaydismissed=${() => {
            this.previewOverlayURL = null;
          }}><iframe src=${this.previewOverlayURL.href}></bb-overlay>`;
        }

        let openDialogOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showOpenBoardOverlay) {
          openDialogOverlay = html`<bb-open-board-overlay
            .selectedBoardServer=${this.selectedBoardServer}
            .selectedLocation=${this.selectedLocation}
            .boardServers=${this.#boardServers}
            .boardServerNavState=${this.boardServerNavState}
            @bboverlaydismissed=${() => {
              this.showOpenBoardOverlay = false;
              this.#maybeShowWelcomePanel();
            }}
            @bbgraphboardserverblankboard=${() => {
              this.showOpenBoardOverlay = false;
              this.#attemptBoardCreate(blankLLMContent());
            }}
            @bbgraphboardserveradd=${() => {
              this.showBoardServerAddOverlay = true;
            }}
            @bbgraphboardserverrefresh=${async (
              evt: BreadboardUI.Events.GraphBoardServerRefreshEvent
            ) => {
              const boardServer = this.#runtime.board.getBoardServerByName(
                evt.boardServerName
              );
              if (!boardServer) {
                return;
              }

              const refreshed = await boardServer.refresh(evt.location);
              if (refreshed) {
                this.toast(
                  "Source files refreshed",
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } else {
                this.toast(
                  "Unable to refresh source files",
                  BreadboardUI.Events.ToastType.WARNING
                );
              }

              this.boardServerNavState = globalThis.crypto.randomUUID();
            }}
            @bbgraphboardserverdisconnect=${async (
              evt: BreadboardUI.Events.GraphBoardServerDisconnectEvent
            ) => {
              await this.#runtime.board.disconnect(evt.location);
              this.boardServerNavState = globalThis.crypto.randomUUID();
            }}
            @bbgraphboardserverrenewaccesssrequest=${async (
              evt: BreadboardUI.Events.GraphBoardServerRenewAccessRequestEvent
            ) => {
              const boardServer = this.#runtime.board.getBoardServerByName(
                evt.boardServerName
              );

              if (!boardServer) {
                return;
              }

              if (boardServer.renewAccess) {
                await boardServer.renewAccess();
              }

              this.boardServerNavState = globalThis.crypto.randomUUID();
            }}
            @bbgraphboardserverloadrequest=${async (
              evt: BreadboardUI.Events.GraphBoardServerLoadRequestEvent
            ) => {
              this.showOpenBoardOverlay = false;
              this.#attemptBoardStart(
                new BreadboardUI.Events.StartEvent(evt.url)
              );
            }}
            @bbgraphboardserverdeleterequest=${async (
              evt: BreadboardUI.Events.GraphBoardServerDeleteRequestEvent
            ) => {
              await this.#attemptBoardDelete(
                evt.boardServerName,
                evt.url,
                evt.isActive
              );
            }}
            @bbgraphboardserverselectionchange=${(
              evt: BreadboardUI.Events.GraphBoardServerSelectionChangeEvent
            ) => {
              this.#persistBoardServerAndLocation(
                evt.selectedBoardServer,
                evt.selectedLocation
              );
            }}
            >Open board</bb-open-board-overlay
          >`;
        }

        const tabs = this.#runtime?.board.tabs ?? [];
        const ui = html`<header>
          <div id="header-bar" ?inert=${showingOverlay}>
          <button
            id="show-nav"
            @click=${() => {
              this.showNav = !this.showNav;
              window.addEventListener(
                "pointerdown",
                () => {
                  this.showNav = false;
                },
                { once: true }
              );
            }}
          ></button>
          <h1 id="breadboard-logo">
            Breadboard
          </h1>
          <div id="tab-container" ${ref(this.#tabContainerRef)}>
            ${map(tabs, ([id, tab]) => {
              const canSave = this.#runtime.board.canSave(id) && !tab.readOnly;
              const saveStatus = this.#tabSaveStatus.get(id) ?? "saved";
              const remote =
                (tab.graph.url?.startsWith("http") ||
                  tab.graph.url?.startsWith("drive")) ??
                false;
              const readonly = tab.readOnly;

              let saveTitle = "Saved";
              switch (saveStatus) {
                case BreadboardUI.Types.BOARD_SAVE_STATUS.SAVING: {
                  saveTitle = "Saving";
                  break;
                }

                case BreadboardUI.Types.BOARD_SAVE_STATUS.SAVED: {
                  saveTitle = remote
                    ? "Saved on Board Server"
                    : "Saved on device";

                  if (readonly) {
                    saveTitle += " - read-only";
                  }
                  break;
                }

                case BreadboardUI.Types.BOARD_SAVE_STATUS.ERROR: {
                  saveTitle = "Error saving board";
                  break;
                }
              }

              return html`<h1
                class=${classMap({
                  active: this.tab?.id === tab.id,
                })}
              >
                <button
                  class=${classMap({
                    "back-to-main-board": true,
                    "can-save": canSave,
                  })}
                  @click=${() => {
                    if (this.tab?.id === tab.id && tab.subGraphId !== null) {
                      tab.subGraphId = null;
                      return;
                    }

                    this.#runtime.board.changeTab(tab.id);
                  }}
                  @dblclick=${(evt: PointerEvent) => {
                    if (!this.tab) {
                      return;
                    }

                    this.#showBoardEditOverlay(
                      evt.clientX,
                      evt.clientY,
                      this.tab.subGraphId
                    );
                  }}
                >
                  <span>${tab.graph.title}</span>
                  <span
                    class=${classMap({
                      "save-status": true,
                      "can-save": canSave,
                      remote,
                      [saveStatus]: true,
                      readonly,
                    })}
                    title=${saveTitle}
                  ></span>
                </button>
                <button
                  @click=${() => {
                    this.#runtime.board.closeTab(id);
                  }}
                  ?disabled=${tab.graph === null}
                  class="close-board"
                  title="Close Board"
                >
                  Close
                </button>
              </h1>`;
            })}
            ${
              tabs.size > 0 // The Welcome Panel is shown when there are no tabs.
                ? html`<div id="add-tab-container">
                    <button
                      id="add-tab"
                      @click=${() => {
                        this.showOpenBoardOverlay = true;
                      }}
                    >
                      +
                    </button>
                  </div>`
                : nothing
            }

          </div>
          <button
            class=${classMap({ active: this.showSettingsOverlay })}
            id="toggle-settings"
            title="Edit your Visual Editor settings"
            @click=${() => {
              this.showSettingsOverlay = true;
            }}
          >
            Settings
          </button>
        </div>
      </header>
      <div id="content" ?inert=${showingOverlay}>
        <bb-ui-controller
              ${ref(this.#uiRef)}
              ?inert=${showingOverlay}
              .readOnly=${this.tab?.readOnly ?? true}
              .graph=${this.tab?.graph ?? null}
              .editor=${this.#runtime.edit.getEditor(this.tab)}
              .subGraphId=${this.tab?.subGraphId ?? null}
              .moduleId=${this.tab?.moduleId ?? null}
              .run=${runs[0] ?? null}
              .topGraphResult=${topGraphResult}
              .kits=${this.tab?.kits ?? []}
              .loader=${this.#runtime.board.getLoader()}
              .status=${tabStatus}
              .boardId=${this.#boardId}
              .tabLoadStatus=${tabLoadStatus}
              .settings=${this.#settings}
              .boardServers=${this.#boardServers}
              .history=${this.#runtime.edit.getHistory(this.tab)}
              .version=${this.#version}
              .showWelcomePanel=${this.showWelcomePanel}
              .recentBoards=${this.#recentBoards}
              .inputsFromLastRun=${inputsFromLastRun}
              .isShowingBoardActivityOverlay=${this.showBoardActivityOverlay}
              .tabURLs=${tabURLs}
              @bbcommandsavailable=${(
                evt: BreadboardUI.Events.CommandsAvailableEvent
              ) => {
                this.#viewCommands.set(evt.namespace, evt.commands);
              }}
              @bbcommandssetswitch=${(
                evt: BreadboardUI.Events.CommandsSetSwitchEvent
              ) => {
                this.#viewCommandNamespace = evt.namespace;
              }}
              @bbinteraction=${() => {
                this.#clearBoardSave();
              }}
              @bbnodepartialupdate=${async (
                evt: BreadboardUI.Events.NodePartialUpdateEvent
              ) => {
                if (!this.tab) {
                  this.toast(
                    "Unable to edit; no active graph",
                    BreadboardUI.Events.ToastType.ERROR
                  );
                  return;
                }

                if (!evt.debugging) {
                  this.#nodeConfiguratorData = null;
                  this.showNodeConfigurator = false;
                }

                this.#runtime.edit.changeNodeConfigurationPart(
                  this.tab,
                  evt.id,
                  evt.configuration,
                  evt.subGraphId,
                  evt.metadata
                );
              }}
              @bbworkspacenewitemcreaterequest=${() => {
                this.showNewWorkspaceItemOverlay = true;
              }}
              @bbboarditemcopy=${(
                evt: BreadboardUI.Events.BoardItemCopyEvent
              ) => {
                this.#runtime.edit.copyBoardItem(
                  this.tab,
                  evt.itemType,
                  evt.id,
                  evt.title
                );
              }}
              @bbsave=${() => {
                this.#attemptBoardSave();
              }}
              @bbsaveas=${() => {
                this.showSaveAsDialog = true;
              }}
              @bbundo=${() => {
                this.#attemptUndo();
              }}
              @bbredo=${() => {
                this.#attemptRedo();
              }}
              @bbstart=${(evt: BreadboardUI.Events.StartEvent) => {
                this.#attemptBoardStart(evt);
              }}
              @bbgraphboardopenrequest=${() => {
                this.showOpenBoardOverlay = true;
              }}
              @bboverflowmenuaction=${async (
                evt: BreadboardUI.Events.OverflowMenuActionEvent
              ) => {
                switch (evt.action) {
                  case "edit-board-details": {
                    this.#showBoardEditOverlay(
                      evt.x ?? null,
                      evt.y ?? null,
                      evt.value
                    );
                    break;
                  }

                  case "copy-board-contents": {
                    if (!this.tab?.graph || !this.tab?.graph.url) {
                      this.toast(
                        "Unable to copy board URL",
                        BreadboardUI.Events.ToastType.ERROR
                      );
                      break;
                    }

                    await navigator.clipboard.writeText(
                      JSON.stringify(this.tab.graph, null, 2)
                    );
                    this.toast(
                      "Board contents copied",
                      BreadboardUI.Events.ToastType.INFORMATION
                    );
                    break;
                  }

                  case "copy-to-clipboard": {
                    if (!this.tab?.graph || !this.tab?.graph.url) {
                      this.toast(
                        "Unable to copy board URL",
                        BreadboardUI.Events.ToastType.ERROR
                      );
                      break;
                    }

                    await navigator.clipboard.writeText(this.tab.graph.url);
                    this.toast(
                      "Board URL copied",
                      BreadboardUI.Events.ToastType.INFORMATION
                    );
                    break;
                  }

                  case "copy-tab-to-clipboard": {
                    if (!this.tab?.graph || !this.tab?.graph.url) {
                      this.toast(
                        "Unable to copy board URL",
                        BreadboardUI.Events.ToastType.ERROR
                      );
                      break;
                    }

                    const url = new URL(window.location.href);
                    url.search = `?tab0=${this.tab.graph.url}`;

                    await navigator.clipboard.writeText(url.href);
                    this.toast(
                      "Tab URL copied",
                      BreadboardUI.Events.ToastType.INFORMATION
                    );
                    break;
                  }

                  case "download": {
                    if (!this.tab?.graph) {
                      break;
                    }

                    const board = structuredClone(this.tab?.graph);
                    delete board["url"];

                    const data = JSON.stringify(board, null, 2);
                    const url = URL.createObjectURL(
                      new Blob([data], { type: "application/json" })
                    );

                    for (const url of generatedUrls) {
                      try {
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        console.warn(err);
                      }
                    }

                    generatedUrls.clear();
                    generatedUrls.add(url);

                    let fileName = `${board.title ?? "Untitled Board"}.json`;
                    if (this.tab.graph.url) {
                      try {
                        const boardUrl = new URL(
                          this.tab.graph.url,
                          window.location.href
                        );
                        const baseName = /[^/]+$/.exec(boardUrl.pathname);
                        if (baseName) {
                          fileName = baseName[0];
                        }
                      } catch (err) {
                        // Ignore errors - this is best-effort to get the file name from the URL.
                      }
                    }

                    const anchor = document.createElement("a");
                    anchor.download = fileName;
                    anchor.href = url;
                    anchor.click();
                    break;
                  }

                  case "delete": {
                    if (!this.tab?.graph || !this.tab?.graph.url) {
                      return;
                    }

                    const boardServer =
                      this.#runtime.board.getBoardServerForURL(
                        new URL(this.tab?.graph.url)
                      );
                    if (!boardServer) {
                      return;
                    }

                    this.#attemptBoardDelete(
                      boardServer.name,
                      this.tab?.graph.url,
                      true
                    );
                    break;
                  }

                  case "save": {
                    this.#attemptBoardSave();
                    break;
                  }

                  case "save-as": {
                    this.showSaveAsDialog = true;
                    break;
                  }

                  case "copy-preview-to-clipboard": {
                    if (!this.tab?.graph || !this.tab?.graph.url) {
                      return;
                    }

                    const boardServer =
                      this.#runtime.board.getBoardServerForURL(
                        new URL(this.tab?.graph.url)
                      );
                    if (!boardServer) {
                      return;
                    }

                    try {
                      const previewUrl = await boardServer.preview(
                        new URL(this.tab?.graph.url)
                      );

                      await navigator.clipboard.writeText(previewUrl.href);
                      this.toast(
                        "Preview URL copied",
                        BreadboardUI.Events.ToastType.INFORMATION
                      );
                    } catch (err) {
                      this.toast(
                        "Unable to create preview",
                        BreadboardUI.Events.ToastType.ERROR
                      );
                    }
                    break;
                  }

                  default: {
                    this.toast(
                      "Unknown action",
                      BreadboardUI.Events.ToastType.WARNING
                    );
                    break;
                  }
                }
              }}
              @bbtoggleboardactivity=${(
                evt: BreadboardUI.Events.ToggleBoardActivityEvent
              ) => {
                if (evt.forceOn) {
                  this.showBoardActivityOverlay = true;
                } else {
                  this.showBoardActivityOverlay =
                    !this.showBoardActivityOverlay;
                }

                this.#boardActivityLocation = this.showBoardActivityOverlay
                  ? { x: evt.x, y: evt.y }
                  : null;
              }}
              @dragover=${(evt: DragEvent) => {
                evt.preventDefault();
              }}
              @drop=${(evt: DragEvent) => {
                evt.preventDefault();
                this.#attemptLoad(evt);
              }}
              @bbinputerror=${(evt: BreadboardUI.Events.InputErrorEvent) => {
                this.toast(evt.detail, BreadboardUI.Events.ToastType.ERROR);
                return;
              }}
              @bbboardinfoupdate=${(
                evt: BreadboardUI.Events.BoardInfoUpdateEvent
              ) => {
                this.#handleBoardInfoUpdate(evt);
                this.requestUpdate();
              }}
              @bbgraphboardserverblankboard=${() => {
                this.#attemptBoardCreate(blankLLMContent());
              }}
              @bbsubgraphcreate=${async (
                evt: BreadboardUI.Events.SubGraphCreateEvent
              ) => {
                const result = await this.#runtime.edit.createSubGraph(
                  this.tab,
                  evt.subGraphTitle
                );
                if (!result) {
                  this.toast(
                    "Unable to create sub board",
                    BreadboardUI.Events.ToastType.ERROR
                  );
                  return;
                }

                if (!this.tab) {
                  return;
                }
                this.tab.subGraphId = result;
                this.requestUpdate();
              }}
              @bbsubgraphdelete=${async (
                evt: BreadboardUI.Events.SubGraphDeleteEvent
              ) => {
                this.#runtime.edit.deleteSubGraph(this.tab, evt.subGraphId);
              }}
              @bbmodulechangelanguage=${(
                evt: BreadboardUI.Events.ModuleChangeLanguageEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.edit.changeModuleLanguage(
                  this.tab,
                  evt.moduleId,
                  evt.moduleLanguage
                );
              }}
              @bbworkspaceitemchosen=${(
                evt: BreadboardUI.Events.WorkspaceItemChosenEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.board.changeWorkspaceItem(
                  this.tab.id,
                  evt.subGraphId,
                  evt.moduleId
                );
              }}
              @bbmodulecreate=${(
                evt: BreadboardUI.Events.ModuleCreateEvent
              ) => {
                this.#attemptModuleCreate(evt.moduleId);
              }}
              @bbmoduledelete=${(
                evt: BreadboardUI.Events.ModuleDeleteEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.edit.deleteModule(this.tab, evt.moduleId);
              }}
              @bbmoduleedit=${(evt: BreadboardUI.Events.ModuleEditEvent) => {
                this.#runtime.edit.editModule(
                  this.tab,
                  evt.moduleId,
                  evt.code,
                  evt.metadata
                );
              }}
              @bbnoderunrequest=${async (
                evt: BreadboardUI.Events.NodeRunRequestEvent
              ) => {
                await this.#attemptNodeRun(evt.id);
              }}
              @bbrunboard=${async () => {
                if (!this.tab?.graph?.url) {
                  return;
                }

                const graph = this.tab?.graph;

                this.#runBoard(
                  addNodeProxyServerConfig(
                    this.#proxy,
                    {
                      url: this.tab?.graph.url,
                      runner: graph,
                      diagnostics: true,
                      kits: [], // The kits are added by the runtime.
                      loader: this.#runtime.board.getLoader(),
                      store: this.#dataStore,
                      graphStore: this.#graphStore,
                      inputs: BreadboardUI.Data.inputsFromSettings(
                        this.#settings
                      ),
                      interactiveSecrets: true,
                    },
                    this.#settings,
                    this.proxyFromUrl,
                    await this.#getProxyURL(this.tab?.graph.url)
                  )
                );
              }}
              @bbstopboard=${() => {
                this.#attemptBoardStop();
              }}
              @bbedgechange=${(evt: BreadboardUI.Events.EdgeChangeEvent) => {
                this.#runtime.edit.changeEdge(
                  this.tab,
                  evt.changeType,
                  evt.from,
                  evt.to,
                  evt.subGraphId
                );
              }}
              @bbnodemetadataupdate=${(
                evt: BreadboardUI.Events.NodeMetadataUpdateEvent
              ) => {
                this.#runtime.edit.updateNodeMetadata(
                  this.tab,
                  evt.id,
                  evt.metadata,
                  evt.subGraphId
                );
              }}
              @bbmultiedit=${(evt: BreadboardUI.Events.MultiEditEvent) => {
                this.#runtime.edit.multiEdit(
                  this.tab,
                  evt.edits,
                  evt.description
                );
              }}
              @bbnodecreate=${(evt: BreadboardUI.Events.NodeCreateEvent) => {
                this.#runtime.edit.createNode(
                  this.tab,
                  evt.id,
                  evt.nodeType,
                  evt.configuration,
                  evt.metadata,
                  evt.subGraphId
                );
              }}
              @bbnodeconfigurationupdaterequest=${async (
                evt: BreadboardUI.Events.NodeConfigurationUpdateRequestEvent
              ) => {
                const configuration = {
                  id: evt.id,
                  subGraphId: evt.subGraphId,
                  port: evt.port,
                  selectedPort: evt.selectedPort,
                  x: evt.x,
                  y: evt.y,
                  addHorizontalClickClearance: evt.addHorizontalClickClearance,
                };

                await this.#setNodeDataForConfiguration(configuration, null);
              }}
              @bbcommenteditrequest=${(
                evt: BreadboardUI.Events.CommentEditRequestEvent
              ) => {
                this.showCommentEditor = true;
                const value = this.#runtime.edit.getGraphComment(
                  this.tab,
                  evt.id
                );
                this.#commentValueData = {
                  x: evt.x,
                  y: evt.y,
                  value,
                  subGraphId: evt.subGraphId,
                };
              }}
              @bbedgevalueselected=${(
                evt: BreadboardUI.Events.EdgeValueSelectedEvent
              ) => {
                this.showEdgeValue = true;
                // TODO: Figure out what ID to apply here so that the edge update event is meaningful.
                this.#edgeValueData = { id: "unknown-edge", ...evt };
              }}
              @bbnodeactivityselected=${(
                evt: BreadboardUI.Events.NodeActivitySelectedEvent
              ) => {
                this.#selectRun(evt);
              }}
              @bbcommentupdate=${(
                evt: BreadboardUI.Events.CommentUpdateEvent
              ) => {
                this.#runtime.edit.changeComment(
                  this.tab,
                  evt.id,
                  evt.text,
                  evt.subGraphId
                );
              }}
              @bbnodeupdate=${(evt: BreadboardUI.Events.NodeUpdateEvent) => {
                this.#runtime.edit.changeNodeConfiguration(
                  this.tab,
                  evt.id,
                  evt.configuration,
                  evt.subGraphId
                );
              }}
              @bbnodedelete=${(evt: BreadboardUI.Events.NodeDeleteEvent) => {
                this.#runtime.edit.deleteNode(this.tab, evt.id, evt.subGraphId);
              }}
              @bbtoast=${(toastEvent: BreadboardUI.Events.ToastEvent) => {
                this.toast(toastEvent.message, toastEvent.toastType);
              }}
              @bbnodetyperetrievalerror=${(
                evt: BreadboardUI.Events.NodeTypeRetrievalErrorEvent
              ) => {
                this.toast(
                  `Error retrieving type information for ${evt.id}; try removing the component from the board`,
                  BreadboardUI.Events.ToastType.ERROR
                );
              }}
            ></bb-ui-controller>
          </div>
        ${until(nav)}
      </div>`;
        const recentItemsKey =
          (this.graph?.url ?? "untitled-graph").replace(/[\W\s]/gim, "-") +
          `-${this.#viewCommandNamespace}`;
        const commands = [
          ...this.#globalCommands,
          ...(this.#viewCommands.get(this.#viewCommandNamespace) ?? []),
        ];
        const commandPalette = this.showCommandPalette
          ? html`<bb-command-palette
              .commands=${commands}
              .recentItemsKey=${recentItemsKey}
              .recencyType=${"local"}
              @pointerdown=${(evt: PointerEvent) => {
                evt.stopImmediatePropagation();
              }}
              @bbcommand=${(evt: BreadboardUI.Events.CommandEvent) => {
                this.#hideCommandPalette();

                const command = [
                  ...this.#globalCommands,
                  ...(this.#viewCommands.get(this.#viewCommandNamespace) ?? []),
                ].find((command) => command.name === evt.command);

                if (!command) {
                  console.warn(`Unable to find command "${evt.command}"`);
                  return;
                }

                if (!command.callback) {
                  console.warn(`No callback for command "${evt.command}"`);
                  return;
                }

                command.callback.call(
                  null,
                  evt.command,
                  command.secondaryAction
                );
              }}
              @bbpalettedismissed=${() => {
                this.#hideCommandPalette();
              }}
            ></bb-command-palette>`
          : nothing;

        const tabModules = Object.entries(this.tab?.graph.modules ?? {});

        // For standard, non-imperative graphs prepend the main board ID
        if (!this.tab?.graph.main) {
          tabModules.unshift([
            BreadboardUI.Constants.MAIN_BOARD_ID,
            { code: "" },
          ]);
        }

        const modules: BreadboardUI.Types.Command[] = tabModules
          .filter(([id]) => {
            if (this.tab?.moduleId) {
              return id !== this.tab?.moduleId;
            }

            return id !== BreadboardUI.Constants.MAIN_BOARD_ID;
          })
          .map(([id, module]): BreadboardUI.Types.Command => {
            if (id === BreadboardUI.Constants.MAIN_BOARD_ID) {
              return {
                title: `Open Main Board...`,
                icon: "open",
                name: "open",
              };
            }
            return {
              title: `Open ${module.metadata?.title ?? id}...`,
              icon: "open",
              name: "open",
              secondaryAction: id,
            };
          });

        const modulePalette = this.showModulePalette
          ? html`<bb-command-palette
              .commands=${modules}
              .recentItemsKey=${recentItemsKey}
              .recencyType=${"session"}
              @pointerdown=${(evt: PointerEvent) => {
                evt.stopImmediatePropagation();
              }}
              @bbcommand=${(evt: BreadboardUI.Events.CommandEvent) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.board.changeWorkspaceItem(
                  this.tab.id,
                  null,
                  evt.secondaryAction ?? null
                );
                this.#hideModulePalette();
              }}
              @bbpalettedismissed=${() => {
                this.#hideModulePalette();
              }}
            ></bb-command-palette>`
          : nothing;

        return [
          ui,
          boardOverlay,
          settingsOverlay,
          firstRunOverlay,
          showNewWorkspaceItemOverlay,
          historyOverlay,
          boardServerAddOverlay,
          previewOverlay,
          boardActivityOverlay,
          nodeConfiguratorOverlay,
          edgeValueOverlay,
          commentOverlay,
          saveAsDialogOverlay,
          openDialogOverlay,
          commandPalette,
          modulePalette,
        ];
      });

    const tooltip = html`<bb-tooltip ${ref(this.#tooltipRef)}></bb-tooltip>`;
    return [until(uiController), tooltip, toasts];
  }
}
