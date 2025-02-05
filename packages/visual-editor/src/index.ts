/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as BreadboardUI from "@breadboard-ai/shared-ui";
const Strings = BreadboardUI.Strings.forSection("Global");

import {
  HarnessProxyConfig,
  RunConfig,
  RunErrorEvent,
  RunSecretEvent,
} from "@google-labs/breadboard/harness";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import { until } from "lit/directives/until.js";
import { map } from "lit/directives/map.js";
import { customElement, property, state } from "lit/decorators.js";
import { LitElement, html, HTMLTemplateResult, nothing } from "lit";
import {
  blankLLMContent,
  createRunObserver,
  GraphDescriptor,
  BoardServer,
  InspectableRun,
  InspectableRunSequenceEntry,
  NodeConfiguration,
  SerializedRun,
  MutableGraphStore,
  defaultModuleContent,
  createFileSystem,
  createEphemeralBlobStore,
  assetsFromGraphDescriptor,
} from "@google-labs/breadboard";
import {
  createFileSystemBackend,
  getDataStore,
  getRunStore,
} from "@breadboard-ai/data-store";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { SettingsStore } from "@breadboard-ai/shared-ui/data/settings-store.js";
import { addNodeProxyServerConfig } from "./data/node-proxy-servers";
import { provide } from "@lit/context";
import { RecentBoardStore } from "./data/recent-boards";
import { SecretsHelper } from "./utils/secrets-helper";
import { SettingsHelperImpl } from "./utils/settings-helper";
import { styles as mainStyles } from "./index.styles.js";
import * as Runtime from "./runtime/runtime.js";
import {
  EnhanceSideboard,
  TabId,
  WorkspaceSelectionStateWithChangeId,
  WorkspaceVisualChangeId,
} from "./runtime/types";
import { createPastRunObserver } from "./utils/past-run-observer";
import { getRunNodeConfig } from "./utils/run-node";
import {
  createTokenVendor,
  TokenVendor,
} from "@breadboard-ai/connection-client";

import { sandbox } from "./sandbox";
import {
  GraphIdentifier,
  InputValues,
  Module,
  ModuleIdentifier,
} from "@breadboard-ai/types";
import { KeyboardCommand, KeyboardCommandDeps } from "./commands/types";
import {
  CopyCommand,
  CutCommand,
  DeleteCommand,
  PasteCommand,
  SelectAllCommand,
} from "./commands/commands";
import {
  HideTooltipEvent,
  ShowTooltipEvent,
} from "../../shared-ui/dist/events/events";

const STORAGE_PREFIX = "bb-main";
const LOADING_TIMEOUT = 250;

type MainArguments = {
  boards: BreadboardUI.Types.Board[];
  providers?: BoardServer[]; // Deprecated.
  settings?: SettingsStore;
  proxy?: HarnessProxyConfig[];
  version?: string;
  languagePack: string;
};

type SaveAsConfiguration = {
  title: string;
  graph: GraphDescriptor;
  isNewBoard: boolean;
};

type BoardOverlowMenuConfiguration = {
  tabId: TabId;
  x: number;
  y: number;
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
  accessor graph: GraphDescriptor | null = null;

  @property()
  accessor subGraphId: string | null = null;

  @state()
  accessor showNav = false;

  @state()
  accessor showBoardServerAddOverlay = false;

  @state()
  accessor showHistory = false;

  @state()
  accessor showFirstRun = false;

  @state()
  accessor showWelcomePanel = false;

  @state()
  accessor showBoardReferenceMarkers = false;

  @state()
  accessor showOpenBoardOverlay = false;

  @state()
  accessor showCommandPalette = false;

  @state()
  accessor showModulePalette = false;

  @state()
  accessor showNewWorkspaceItemOverlay = false;

  @state()
  accessor view: "deploy" | "create" = "create";

  @state()
  accessor showBoardOverflowMenu = false;
  #boardOverflowMenuConfiguration: BoardOverlowMenuConfiguration | null = null;

  @state()
  accessor showSaveAsDialog = false;
  #saveAsState: SaveAsConfiguration | null = null;

  @state()
  accessor showNodeConfigurator = false;
  #nodeConfiguratorData: BreadboardUI.Types.NodePortConfiguration | null = null;
  #nodeConfiguratorRef: Ref<BreadboardUI.Elements.NodeConfigurationOverlay> =
    createRef();

  @state()
  accessor showCommentEditor = false;
  #commentValueData: BreadboardUI.Types.CommentConfiguration | null = null;

  @state()
  accessor boardEditOverlayInfo: {
    tabId: TabId;
    title: string;
    version: string;
    description: string;
    published: boolean | null;
    isTool: boolean | null;
    isComponent: boolean | null;
    subGraphId: string | null;
    moduleId: string | null;
    x: number | null;
    y: number | null;
  } | null = null;

  @state()
  accessor showSettingsOverlay = false;

  @state()
  accessor toasts = new Map<
    string,
    {
      message: string;
      type: BreadboardUI.Events.ToastType;
      persistent: boolean;
    }
  >();

  @provide({ context: BreadboardUI.Contexts.environmentContext })
  accessor environment: BreadboardUI.Contexts.Environment;

  @provide({ context: BreadboardUI.Elements.tokenVendorContext })
  accessor tokenVendor!: TokenVendor;

  @provide({ context: BreadboardUI.Contexts.settingsHelperContext })
  accessor settingsHelper!: SettingsHelperImpl;

  @state()
  accessor selectedBoardServer = "Example Boards";

  @state()
  accessor selectedLocation = "example://example-boards";

  @state()
  accessor previewOverlayURL: URL | null = null;

  @state()
  accessor boardServerNavState: string | null = null;

  @property()
  accessor tab: Runtime.Types.Tab | null = null;

  #uiRef: Ref<BreadboardUI.Elements.UI> = createRef();
  #tooltipRef: Ref<BreadboardUI.Elements.Tooltip> = createRef();
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
  #fileSystem = createFileSystem({
    local: createFileSystemBackend(createEphemeralBlobStore()),
  });
  #selectionState: WorkspaceSelectionStateWithChangeId | null = null;
  #lastVisualChangeId: WorkspaceVisualChangeId | null = null;
  #lastPointerPosition = { x: 0, y: 0 };

  /**
   * Monotonically increases whenever the graph topology of a graph in the
   * current tab changes. Graph topology == any non-visual change to the graph.
   * - this property is incremented whenever the "update" event is received
   *   from the `GraphStore` instance, which stores and tracks all known graphs,
   *   across all tabs, etc.
   * - this property is only incremented when the "update" is for the current
   *   tab's graph, but that still works when we switch tabs, since we don't
   *   check the value of the property, just whether it changed.
   * - because it is decorated with `@state()` on this component,
   *   incrementing this property causes a new render of the component.
   * - this property is then passed to various sub-components that need to be
   *   aware of graph topology changes.
   * - these sub-components need to have their own `graphTopologyUpdateId` that
   *   should be decorated as `@property()`, so that the change to this property
   *   causes a new render of that component, too.
   * - as the resulting effect, incrementing the property will keep the parts
   *   of the UI that need to reflect the latest graph topology up to date.
   */
  @state()
  accessor graphTopologyUpdateId: number = 0;

  /**
   * Similar to graphTopologyUpdateId, but for all graphs in the graph store.
   * This is useful for tracking all changes to all graphs, like in
   * component/boards selectors.
   */
  @state()
  accessor graphStoreUpdateId: number = 0;

  #globalCommands: BreadboardUI.Types.Command[] = [
    {
      title: Strings.from("COMMAND_OPEN_PROJECT"),
      name: "open-board",
      icon: "open",
      callback: () => {
        this.showOpenBoardOverlay = true;
      },
    },
    {
      title: Strings.from("COMMAND_SAVE_PROJECT"),
      name: "save-board",
      icon: "save",
      callback: () => {
        this.#attemptBoardSave();
      },
    },
    {
      title: Strings.from("COMMAND_SAVE_PROJECT_AS"),
      name: "save-board-as",
      icon: "save",
      callback: () => {
        this.showSaveAsDialog = true;
      },
    },
    {
      title: Strings.from("COMMAND_EDIT_PROJECT_INFORMATION"),
      name: "edit-board-information",
      icon: "edit",
      callback: () => {
        this.#showBoardEditOverlay(
          this.tab,
          100,
          50,
          this.tab?.subGraphId ?? null,
          null
        );
      },
    },
    {
      title: Strings.from("COMMAND_OPEN_MODULE"),
      name: "open-module",
      icon: "open",
      callback: () => {
        this.showModulePalette = true;
      },
    },
    {
      title: Strings.from("COMMAND_CREATE_MODULE"),
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

    // Due to https://github.com/lit/lit/issues/4675, context provider values
    // must be done in the constructor.
    this.environment = ENVIRONMENT;

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
    //  1. Language support.
    //  2. Recent boards.
    //  3. Settings.
    //  4. Runtime.
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

        this.#graphStore.addEventListener("update", (evt) => {
          const { mainGraphId } = evt;
          const current = this.tab?.mainGraphId;
          this.graphStoreUpdateId++;
          if (
            !current ||
            (mainGraphId !== current && !evt.affectedGraphs.includes(current))
          ) {
            return;
          }
          this.graphTopologyUpdateId++;
        });

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

        this.#runtime.select.addEventListener(
          Runtime.Events.RuntimeSelectionChangeEvent.eventName,
          (evt: Runtime.Events.RuntimeSelectionChangeEvent) => {
            this.#selectionState = {
              selectionChangeId: evt.selectionChangeId,
              selectionState: evt.selectionState,
              moveToSelection: evt.moveToSelection,
            };

            this.requestUpdate();
          }
        );

        this.#runtime.edit.addEventListener(
          Runtime.Events.RuntimeVisualChangeEvent.eventName,
          (evt: Runtime.Events.RuntimeVisualChangeEvent) => {
            this.#lastVisualChangeId = evt.visualChangeId;
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
              this.tab,
              Strings.from("STATUS_SAVING_PROJECT"),
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
              Strings.from("ERROR_UNABLE_TO_LOAD_PROJECT"),
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
                  evt.chatController,
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

              this.#runtime.select.refresh(
                this.tab.id,
                this.#runtime.util.createWorkspaceSelectionChangeId()
              );
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
    this.boardEditOverlayInfo = null;
    this.showSettingsOverlay = false;
    this.showBoardServerAddOverlay = false;
    this.showSaveAsDialog = false;
    this.showNodeConfigurator = false;
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
    this.#tooltipRef.value.x = Math.min(
      Math.max(tooltipEvent.x, 80),
      window.innerWidth - 80
    );
    this.#tooltipRef.value.y = Math.max(tooltipEvent.y, 90);
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
      target instanceof HTMLCanvasElement ||
      target instanceof BreadboardUI.Elements.ModuleEditor ||
      (target instanceof HTMLElement &&
        (target.contentEditable === "true" ||
          target.contentEditable === "plaintext-only"))
    );
  }

  #commands: Map<string[], KeyboardCommand> = new Map([
    [DeleteCommand.keys, DeleteCommand],
    [SelectAllCommand.keys, SelectAllCommand],
    [CopyCommand.keys, CopyCommand],
    [CutCommand.keys, CutCommand],
    [PasteCommand.keys, PasteCommand],
  ]);

  #handlingKey = false;
  async #onKeyDown(evt: KeyboardEvent) {
    if (this.#handlingKey) {
      return;
    }

    if (!this.tab) {
      return;
    }

    // Check if there's an input preference before actioning any main keyboard
    // command.
    if (
      evt.composedPath().some((target) => this.#receivesInputPreference(target))
    ) {
      return;
    }

    const isMac = navigator.platform.indexOf("Mac") === 0;
    const isCtrlCommand = isMac ? evt.metaKey : evt.ctrlKey;

    let key = evt.key;

    if (key === "Meta" || key === "Ctrl" || key === "Shift") {
      return;
    }

    if (evt.metaKey) {
      key = `Cmd+${key}`;
    }
    if (evt.ctrlKey) {
      key = `Ctrl+${key}`;
    }
    if (evt.shiftKey) {
      key = `Shift+${key}`;
    }

    const deps: KeyboardCommandDeps = {
      runtime: this.#runtime,
      selectionState: this.#selectionState,
      tab: this.tab,
      originalEvent: evt,
      pointerLocation: this.#lastPointerPosition,
    } as const;

    for (const [keys, command] of this.#commands) {
      if (keys.includes(key) && command.willHandle(evt)) {
        evt.preventDefault();
        evt.stopImmediatePropagation();

        this.#handlingKey = true;

        // Toast.
        let toastId;
        const notifyUser = () => {
          toastId = this.toast(
            command.messagePending ?? Strings.from("STATUS_GENERIC_WORKING"),
            BreadboardUI.Events.ToastType.PENDING,
            true
          );
        };

        // Either notify or set a timeout for notifying the user.
        let notifyUserOnTimeout;
        if (command.alwaysNotify) {
          notifyUser();
        } else {
          notifyUserOnTimeout = setTimeout(
            notifyUser,
            command.messageTimeout ?? 100
          );
        }

        // Perform the command.
        try {
          await command.do(deps);

          // Replace the toast.
          if (toastId) {
            this.toast(
              command.messageComplete ?? Strings.from("STATUS_GENERIC_WORKING"),
              command.messageType ?? BreadboardUI.Events.ToastType.INFORMATION,
              false,
              toastId
            );
          }
        } catch (err) {
          const commandErr = err as { message: string };
          this.toast(
            commandErr.message ?? Strings.from("ERROR_GENERIC"),
            BreadboardUI.Events.ToastType.ERROR,
            false,
            toastId
          );
        } finally {
          // Clear the timeout in case it's not fired yet.
          if (notifyUserOnTimeout) {
            clearTimeout(notifyUserOnTimeout);
          }
        }

        this.#handlingKey = false;
      }
    }

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

    if (evt.key === "s" && isCtrlCommand) {
      evt.preventDefault();

      if (evt.shiftKey) {
        this.showSaveAsDialog = true;
        return;
      }

      let saveMessage = Strings.from("STATUS_PROJECT_SAVED");
      if (this.#nodeConfiguratorRef.value) {
        this.#nodeConfiguratorRef.value.processData();
        saveMessage = Strings.from("STATUS_PROJECT_CONFIGURATION_SAVED");
      }

      this.#attemptBoardSave(this.tab, saveMessage);
      return;
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

  async #attemptBoardStart() {
    const url = this.tab?.graph?.url;
    if (!url) {
      return;
    }

    const graph = this.tab?.graph;

    this.#runBoard(
      addNodeProxyServerConfig(
        this.#proxy,
        {
          url,
          runner: graph,
          diagnostics: true,
          kits: [], // The kits are added by the runtime.
          loader: this.#runtime.board.getLoader(),
          store: this.#dataStore,
          graphStore: this.#graphStore,
          fileSystem: this.#fileSystem.createRunFileSystem({
            graphUrl: url,
            env: [],
            assets: assetsFromGraphDescriptor(graph),
          }),
          inputs: BreadboardUI.Data.inputsFromSettings(this.#settings),
          interactiveSecrets: true,
        },
        this.#settings,
        this.proxyFromUrl,
        await this.#getProxyURL(url)
      )
    );
  }

  #attemptBoardStop() {
    const tabId = this.tab?.id ?? null;
    const abortController = this.#runtime.run.getAbortSignal(tabId);
    if (!abortController) {
      return;
    }

    abortController.abort(Strings.from("STATUS_GENERIC_RUN_STOPPED"));
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
    tabToSave = this.tab,
    message = Strings.from("STATUS_PROJECT_SAVED"),
    ackUser = true,
    showSaveAsIfNeeded = true,
    timeout = 0
  ) {
    if (!tabToSave) {
      return;
    }

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
        Strings.from("STATUS_SAVING_PROJECT"),
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
      Strings.from("STATUS_SAVING_PROJECT"),
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
        error || Strings.from("ERROR_UNABLE_TO_CREATE_PROJECT"),
        BreadboardUI.Events.ToastType.ERROR,
        false,
        id
      );
      return;
    }

    this.#setBoardPendingSaveState(false);
    this.#persistBoardServerAndLocation(boardServerName, location);

    this.#attemptBoardLoad(new BreadboardUI.Events.StartEvent(url.href));
    this.toast(
      Strings.from("STATUS_PROJECT_SAVED"),
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
    if (!confirm(Strings.from("QUERY_DELETE_PROJECT"))) {
      return;
    }

    const id = this.toast(
      Strings.from("STATUS_DELETING_PROJECT"),
      BreadboardUI.Events.ToastType.PENDING,
      true
    );

    const { result, error } = await this.#runtime.board.delete(
      boardServerName,
      url
    );
    if (result) {
      this.toast(
        Strings.from("STATUS_PROJECT_DELETED"),
        BreadboardUI.Events.ToastType.INFORMATION,
        false,
        id
      );
    } else {
      this.toast(
        error || Strings.from("ERROR_GENERIC"),
        BreadboardUI.Events.ToastType.ERROR,
        false,
        id
      );
    }

    if (this.tab && isActive) {
      this.#runtime.select.deselectAll(
        this.tab.id,
        this.#runtime.select.generateId()
      );
      this.#runtime.board.closeTab(this.tab.id);
      this.#removeRecentUrl(url);
    }

    this.boardServerNavState = globalThis.crypto.randomUUID();
  }

  #attemptBoardCreate(graph: GraphDescriptor) {
    this.#saveAsState = {
      title: Strings.from("TITLE_CREATE_PROJECT"),
      graph,
      isNewBoard: true,
    };

    this.showSaveAsDialog = true;
  }

  #setPageTitle(title: string | null) {
    const suffix = `${Strings.from("APP_NAME")} - ${Strings.from("SUB_APP_NAME")}`;
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
        title: this.tab?.graph.title ?? Strings.from("TITLE_UNTITLED_PROJECT"),
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
    if (message.length > 77) {
      message = message.slice(0, 74) + "...";
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

    if (!confirm(Strings.from("QUERY_SAVE_PROJECT"))) {
      return;
    }

    return this.#attemptBoardSave();
  }

  async #handleBoardInfoUpdate(evt: BreadboardUI.Events.BoardInfoUpdateEvent) {
    if (!evt.tabId) {
      this.toast(
        Strings.from("ERROR_GENERIC"),
        BreadboardUI.Events.ToastType.ERROR
      );
      return;
    }

    const tab = this.#runtime.board.getTabById(evt.tabId as TabId);
    if (!tab) {
      this.toast(
        Strings.from("ERROR_NO_PROJECT"),
        BreadboardUI.Events.ToastType.ERROR
      );
      return;
    }

    if (evt.subGraphId) {
      await this.#runtime.edit.updateSubBoardInfo(
        tab,
        evt.subGraphId,
        evt.title,
        evt.version,
        evt.description,
        evt.status,
        evt.isTool,
        evt.isComponent
      );
    } else if (evt.moduleId) {
      await this.#runtime.edit.updateModuleInfo(
        tab,
        evt.moduleId,
        evt.title,
        evt.description
      );
    } else {
      this.#runtime.edit.updateBoardInfo(
        tab,
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
                  Strings.from("ERROR_RUN_LOAD_DATA_FAILED"),
                  BreadboardUI.Events.ToastType.ERROR
                );
              }
            } else {
              this.toast(
                Strings.from("ERROR_RUN_LOAD_DATA_FAILED"),
                BreadboardUI.Events.ToastType.ERROR
              );
            }
          });
        } else {
          this.#runtime.board.createTabFromDescriptor(runData);
        }
      } catch (err) {
        console.warn(err);
        this.toast(
          Strings.from("ERROR_LOAD_FAILED"),
          BreadboardUI.Events.ToastType.ERROR
        );
      }
    });
  }

  async #attemptBoardLoad(evt: BreadboardUI.Events.StartEvent) {
    if (evt.url) {
      let id;
      const loadingTimeout = setTimeout(() => {
        id = this.toast(
          Strings.from("STATUS_GENERIC_LOADING"),
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

  #attemptToggleExport(
    id: ModuleIdentifier | GraphIdentifier,
    type: "imperative" | "declarative"
  ) {
    if (!this.tab) {
      return;
    }

    this.#runtime.edit.toggleExport(this.tab, id, type);
  }

  #showBoardEditOverlay(
    tab = this.tab,
    x: number | null,
    y: number | null,
    subGraphId: string | null,
    moduleId: string | null
  ) {
    if (!tab) {
      return;
    }

    if (moduleId) {
      const module = tab.graph.modules?.[moduleId];
      if (!module) {
        return;
      }

      const { metadata } = module;

      this.boardEditOverlayInfo = {
        tabId: tab.id,
        description: metadata?.description ?? "",
        isTool: false,
        isComponent: false,
        published: false,
        subGraphId,
        moduleId,
        title: metadata?.title ?? "",
        version: "",
        x,
        y,
      };
      return;
    }

    const graph = subGraphId ? tab.graph.graphs?.[subGraphId] : tab.graph;

    if (!graph) {
      return;
    }

    const { description, title, version, metadata } = graph;

    this.boardEditOverlayInfo = {
      tabId: tab.id,
      description: description ?? "",
      isTool: metadata?.tags?.includes("tool") ?? false,
      isComponent: metadata?.tags?.includes("component") ?? false,
      published: metadata?.tags?.includes("published") ?? false,
      subGraphId,
      moduleId,
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

    const [ports, nodeType, metadata, currentMetadata] = await Promise.all([
      this.#runtime.edit.getNodePorts(this.tab, id, subGraphId),
      this.#runtime.edit.getNodeType(this.tab, id, subGraphId),
      this.#runtime.edit.getNodeMetadata(this.tab, id, subGraphId),
      this.#runtime.edit.getNodeCurrentMetadata(this.tab, id, subGraphId),
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
      type: nodeType,
      selectedPort: configuration.selectedPort ?? null,
      subGraphId: subGraphId ?? null,
      ports,
      metadata,
      nodeConfiguration,
      currentMetadata,
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
      this.showCommentEditor ||
      this.showOpenBoardOverlay ||
      this.showCommandPalette ||
      this.showModulePalette ||
      this.showNewWorkspaceItemOverlay ||
      this.showBoardOverflowMenu;

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
          BreadboardUI.Utils.TopGraphObserver.entryResult(this.tab?.graph);
        const projectState = this.#runtime.state.getOrCreate(
          this.tab?.mainGraphId,
          this.#runtime.edit.getEditor(this.tab)
        );
        const inputsFromLastRun = runs[1]?.inputs() ?? null;
        const tabURLs = this.#runtime.board.getTabURLs();
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
            .tabId=${this.boardEditOverlayInfo.tabId}
            .boardTitle=${this.boardEditOverlayInfo.title}
            .boardVersion=${this.boardEditOverlayInfo.version}
            .boardDescription=${this.boardEditOverlayInfo.description}
            .boardPublished=${this.boardEditOverlayInfo.published}
            .boardIsTool=${this.boardEditOverlayInfo.isTool}
            .boardIsComponent=${this.boardEditOverlayInfo.isComponent}
            .subGraphId=${this.boardEditOverlayInfo.subGraphId}
            .moduleId=${this.boardEditOverlayInfo.moduleId}
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
                  Strings.from("STATUS_SAVED_SETTINGS"),
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } catch (err) {
                console.warn(err);
                this.toast(
                  Strings.from("ERROR_SAVE_SETTINGS"),
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

              await this.#runtime.edit.createWorkspaceItem(
                this.tab,
                evt.itemType,
                evt.title,
                this.#settings
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
                  `Welcome to ${Strings.from("APP_NAME")}!`,
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } catch (err) {
                console.warn(err);
                this.toast(
                  Strings.from("ERROR_SAVE_SETTINGS"),
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

        let saveAsDialogOverlay: HTMLTemplateResult | symbol = nothing;
        if (this.showSaveAsDialog) {
          saveAsDialogOverlay = html`<bb-save-as-overlay
            .panelTitle=${this.#saveAsState?.title ??
            Strings.from("COMMAND_SAVE_PROJECT_AS")}
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

          const run = runs?.[0] ?? null;
          const events = run?.events ?? [];
          const runEventsForNode = events.filter((evt) => {
            return (
              evt.type === "node" &&
              evt.node.descriptor.id === this.#nodeConfiguratorData?.id &&
              evt.end !== null
            );
          });

          nodeConfiguratorOverlay = html`<bb-node-configuration-overlay
            ${ref(this.#nodeConfiguratorRef)}
            .canRunNode=${canRunNode}
            .configuration=${this.#nodeConfiguratorData}
            .graph=${this.tab?.graph}
            .runEventsForNode=${runEventsForNode}
            .boardServers=${this.#boardServers}
            .showTypes=${false}
            .offerConfigurationEnhancements=${offerConfigurationEnhancements}
            .projectState=${projectState}
            .readOnly=${this.tab?.readOnly}
            @bbworkspaceselectionstate=${(
              evt: BreadboardUI.Events.WorkspaceSelectionStateEvent
            ) => {
              if (!this.tab) {
                return;
              }

              this.#nodeConfiguratorData = null;
              this.showNodeConfigurator = false;
              if (evt.replaceExistingSelections) {
                this.#runtime.select.processSelections(
                  this.tab.id,
                  evt.selectionChangeId,
                  evt.selections,
                  evt.replaceExistingSelections,
                  evt.moveToSelection
                );
              }
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
                      this.tab!.boardServerKits,
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
                  Strings.from("ERROR_NO_PROJECT"),
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
                evt.metadata,
                evt.ins
              );
            }}
            @bbtoast=${(toastEvent: BreadboardUI.Events.ToastEvent) => {
              this.toast(toastEvent.message, toastEvent.toastType);
            }}
          ></bb-node-configuration-overlay>`;
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
                  Strings.from("STATUS_PROJECTS_REFRESHED"),
                  BreadboardUI.Events.ToastType.INFORMATION
                );
              } else {
                this.toast(
                  Strings.from("ERROR_UNABLE_TO_REFRESH_PROJECTS"),
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
              this.#attemptBoardLoad(
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

        let boardOverflowMenu: HTMLTemplateResult | symbol = nothing;
        if (
          this.showBoardOverflowMenu &&
          this.#boardOverflowMenuConfiguration
        ) {
          const tabId = this.#boardOverflowMenuConfiguration.tabId;
          const actions: BreadboardUI.Types.OverflowAction[] = [
            {
              title: Strings.from("COMMAND_SAVE_PROJECT_AS"),
              name: "save-as",
              icon: "save",
              value: tabId,
            },
            {
              title: Strings.from("COMMAND_COPY_PROJECT_CONTENTS"),
              name: "copy-board-contents",
              icon: "copy",
              value: tabId,
            },
            {
              title: Strings.from("COMMAND_COPY_PROJECT_URL"),
              name: "copy-to-clipboard",
              icon: "copy",
              value: tabId,
            },
            {
              title: Strings.from("COMMAND_COPY_FULL_URL"),
              name: "copy-tab-to-clipboard",
              icon: "copy",
              value: tabId,
            },
          ];

          if (this.#runtime.board.canPreview(tabId)) {
            actions.push({
              title: Strings.from("COMMAND_COPY_APP_PREVIEW_URL"),
              name: "copy-preview-to-clipboard",
              icon: "copy",
              value: tabId,
            });
          }

          if (this.#runtime.board.canSave(tabId)) {
            actions.unshift({
              title: Strings.from("COMMAND_SAVE_PROJECT"),
              name: "save",
              icon: "save",
              value: tabId,
            });

            actions.push({
              title: Strings.from("COMMAND_EDIT_PROJECT_INFORMATION"),
              name: "edit",
              icon: "edit",
              value: tabId,
            });

            actions.push({
              title: Strings.from("COMMAND_DELETE_PROJECT"),
              name: "delete",
              icon: "delete",
              value: tabId,
            });
          }

          actions.push({
            title: Strings.from("COMMAND_EXPORT_PROJECT"),
            name: "download",
            icon: "download",
            value: tabId,
          });

          boardOverflowMenu = html`<bb-overflow-menu
            id="board-overflow"
            style=${styleMap({
              left: `${this.#boardOverflowMenuConfiguration.x}px`,
              top: `${this.#boardOverflowMenuConfiguration.y}px`,
            })}
            .actions=${actions}
            .disabled=${false}
            @bboverflowmenudismissed=${() => {
              this.showBoardOverflowMenu = false;
            }}
            @bboverflowmenuaction=${async (
              actionEvt: BreadboardUI.Events.OverflowMenuActionEvent
            ) => {
              this.showBoardOverflowMenu = false;
              const x = this.#boardOverflowMenuConfiguration?.x ?? 100;
              const y = this.#boardOverflowMenuConfiguration?.y ?? 100;

              if (!actionEvt.value) {
                this.toast(
                  Strings.from("ERROR_GENERIC"),
                  BreadboardUI.Events.ToastType.ERROR
                );
                return;
              }

              const tab = this.#runtime.board.getTabById(
                actionEvt.value as TabId
              );
              if (!tab) {
                this.toast(
                  Strings.from("ERROR_GENERIC"),
                  BreadboardUI.Events.ToastType.ERROR
                );
                return;
              }

              switch (actionEvt.action) {
                case "edit-board-details": {
                  this.#showBoardEditOverlay(tab, x, y, null, null);
                  break;
                }

                case "copy-board-contents": {
                  if (!tab.graph || !tab.graph.url) {
                    this.toast(
                      Strings.from("ERROR_GENERIC"),
                      BreadboardUI.Events.ToastType.ERROR
                    );
                    break;
                  }

                  await navigator.clipboard.writeText(
                    JSON.stringify(tab.graph, null, 2)
                  );
                  this.toast(
                    Strings.from("STATUS_PROJECT_CONTENTS_COPIED"),
                    BreadboardUI.Events.ToastType.INFORMATION
                  );
                  break;
                }

                case "copy-to-clipboard": {
                  if (!tab.graph || !tab.graph.url) {
                    this.toast(
                      Strings.from("ERROR_GENERIC"),
                      BreadboardUI.Events.ToastType.ERROR
                    );
                    break;
                  }

                  await navigator.clipboard.writeText(tab.graph.url);
                  this.toast(
                    Strings.from("STATUS_PROJECT_URL_COPIED"),
                    BreadboardUI.Events.ToastType.INFORMATION
                  );
                  break;
                }

                case "copy-tab-to-clipboard": {
                  if (!tab.graph || !tab.graph.url) {
                    this.toast(
                      Strings.from("ERROR_GENERIC"),
                      BreadboardUI.Events.ToastType.ERROR
                    );
                    break;
                  }

                  const url = new URL(window.location.href);
                  url.search = `?tab0=${tab.graph.url}`;

                  await navigator.clipboard.writeText(url.href);
                  this.toast(
                    Strings.from("STATUS_FULL_URL_COPIED"),
                    BreadboardUI.Events.ToastType.INFORMATION
                  );
                  break;
                }

                case "download": {
                  if (!tab.graph) {
                    break;
                  }

                  const board = structuredClone(tab.graph);
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

                  let fileName = `${board.title ?? Strings.from("TITLE_UNTITLED_PROJECT")}.json`;
                  if (tab.graph.url) {
                    try {
                      const boardUrl = new URL(
                        tab.graph.url,
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
                  if (!tab.graph || !tab.graph.url) {
                    return;
                  }

                  const boardServer = this.#runtime.board.getBoardServerForURL(
                    new URL(tab.graph.url)
                  );
                  if (!boardServer) {
                    return;
                  }

                  this.#attemptBoardDelete(
                    boardServer.name,
                    tab.graph.url,
                    true
                  );
                  break;
                }

                case "save": {
                  this.#attemptBoardSave(tab);
                  break;
                }

                case "save-as": {
                  this.#saveAsState = {
                    title: Strings.from("COMMAND_SAVE_PROJECT_AS"),
                    graph: tab.graph,
                    isNewBoard: false,
                  };

                  this.showSaveAsDialog = true;
                  break;
                }

                case "copy-preview-to-clipboard": {
                  if (!tab.graph || !tab.graph.url) {
                    return;
                  }

                  const boardServer = this.#runtime.board.getBoardServerForURL(
                    new URL(tab.graph.url)
                  );
                  if (!boardServer) {
                    return;
                  }

                  try {
                    const previewUrl = await boardServer.preview(
                      new URL(tab.graph.url)
                    );

                    await navigator.clipboard.writeText(previewUrl.href);
                    this.toast(
                      Strings.from("STATUS_APP_PREVIEW_URL_COPIED"),
                      BreadboardUI.Events.ToastType.INFORMATION
                    );
                  } catch (err) {
                    this.toast(
                      Strings.from("ERROR_GENERIC"),
                      BreadboardUI.Events.ToastType.ERROR
                    );
                  }
                  break;
                }
              }
            }}
          ></bb-overflow-menu>`;
        }

        let tabControls: HTMLTemplateResult | symbol = nothing;
        const tabHistory = this.#runtime.edit.getHistory(this.tab);
        if (this.tab && tabHistory) {
          tabControls = html` <button
              id="undo"
              ?disabled=${!tabHistory.canUndo()}
              @click=${() => {
                this.#attemptUndo();
              }}
              @pointerover=${(evt: PointerEvent) => {
                this.dispatchEvent(
                  new ShowTooltipEvent(
                    Strings.from("LABEL_UNDO"),
                    evt.clientX,
                    evt.clientY
                  )
                );
              }}
              @pointerout=${() => {
                this.dispatchEvent(new HideTooltipEvent());
              }}
            >
              Undo
            </button>
            <button
              id="redo"
              ?disabled=${!tabHistory.canRedo()}
              @click=${() => {
                this.#attemptRedo();
              }}
              @pointerover=${(evt: PointerEvent) => {
                this.dispatchEvent(
                  new ShowTooltipEvent(
                    Strings.from("LABEL_REDO"),
                    evt.clientX,
                    evt.clientY
                  )
                );
              }}
              @pointerout=${() => {
                this.dispatchEvent(new HideTooltipEvent());
              }}
            >
              Redo
            </button>`;
        }

        const canSave = this.tab
          ? this.#runtime.board.canSave(this.tab.id) && !this.tab.readOnly
          : false;
        const saveStatus = this.tab
          ? (this.#tabSaveStatus.get(this.tab.id) ?? "saved")
          : BreadboardUI.Types.BOARD_SAVE_STATUS.ERROR;
        const remote =
          (this.tab?.graph.url?.startsWith("http") ||
            this.tab?.graph.url?.startsWith("drive")) ??
          false;
        const readonly = this.tab?.readOnly ?? !canSave;
        let saveTitle = Strings.from("LABEL_SAVE_STATUS_SAVED");
        switch (saveStatus) {
          case BreadboardUI.Types.BOARD_SAVE_STATUS.SAVING: {
            saveTitle = Strings.from("LABEL_SAVE_STATUS_SAVING");
            break;
          }

          case BreadboardUI.Types.BOARD_SAVE_STATUS.SAVED: {
            if (readonly) {
              saveTitle += " - " + Strings.from("LABEL_SAVE_STATUS_READ_ONLY");
            }
            break;
          }

          case BreadboardUI.Types.BOARD_SAVE_STATUS.ERROR: {
            saveTitle = Strings.from("LABEL_SAVE_ERROR");
            break;
          }

          case BreadboardUI.Types.BOARD_SAVE_STATUS.UNSAVED: {
            saveTitle = Strings.from("LABEL_SAVE_UNSAVED");
            break;
          }
        }

        const ui = html`<header>
          <div id="header-bar" data-active=${this.tab ? "true" : nothing} ?inert=${showingOverlay}>
            <div id="tab-info">
              <button id="logo" @click=${() => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.board.closeTab(this.tab.id);
              }}
                  ?disabled=${this.tab === null}>
                ${Strings.from("APP_NAME")}
              </button>

              ${
                this.tab
                  ? html` <span class="tab-title">${this.tab.graph.title}</span>
                      <button
                        id="tab-edit"
                        class=${classMap({
                          "can-save": canSave,
                        })}
                        @click=${(evt: PointerEvent) => {
                          if (!this.tab || !canSave) {
                            return;
                          }

                          this.#showBoardEditOverlay(
                            this.tab,
                            evt.clientX,
                            evt.clientY,
                            this.tab.subGraphId,
                            null
                          );
                        }}
                      >
                        Edit
                      </button>

                      <span
                        class=${classMap({
                          "save-status": true,
                          "can-save": canSave,
                          remote,
                          [saveStatus]: true,
                          readonly,
                        })}
                      >
                        ${saveTitle}
                      </span>`
                  : nothing
              }

            </div>
            <div id="tab-toggle">
              ${
                this.tab
                  ? html`<button
                      class=${classMap({ [this.view]: true })}
                      @click=${() => {
                        this.view =
                          this.view === "create" ? "deploy" : "create";
                      }}
                    >
                      Toggle View
                    </button>`
                  : nothing
              }
            </div>
            <div id="tab-controls">

              ${tabControls}
              <button
                id="toggle-overflow-menu"
                @pointerover=${(evt: PointerEvent) => {
                  this.dispatchEvent(
                    new BreadboardUI.Events.ShowTooltipEvent(
                      Strings.from("COMMAND_ADDITIONAL_ITEMS"),
                      evt.clientX,
                      evt.clientY
                    )
                  );
                }}
                @pointerout=${() => {
                  this.dispatchEvent(
                    new BreadboardUI.Events.HideTooltipEvent()
                  );
                }}
                @click=${(evt: PointerEvent) => {
                  if (!(evt.target instanceof HTMLButtonElement)) {
                    return;
                  }

                  if (!this.tab) {
                    return;
                  }

                  const btnBounds = evt.target.getBoundingClientRect();
                  const x = btnBounds.x + btnBounds.width - 205;
                  const y = btnBounds.y + btnBounds.height;

                  this.#boardOverflowMenuConfiguration = {
                    tabId: this.tab.id,
                    x,
                    y,
                  };
                  this.showBoardOverflowMenu = true;
                }}
              >
                Overflow
              </button>
              <button
                class=${classMap({ active: this.showSettingsOverlay })}
                id="toggle-settings"
                @pointerover=${(evt: PointerEvent) => {
                  this.dispatchEvent(
                    new BreadboardUI.Events.ShowTooltipEvent(
                      Strings.from("COMMAND_EDIT_SETTINGS"),
                      evt.clientX,
                      evt.clientY
                    )
                  );
                }}
                @pointerout=${() => {
                  this.dispatchEvent(
                    new BreadboardUI.Events.HideTooltipEvent()
                  );
                }}
                @click=${() => {
                  this.showSettingsOverlay = true;
                }}
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      </header>
      <div id="content" ?inert=${showingOverlay}>
        <bb-ui-controller
              ${ref(this.#uiRef)}
              ?inert=${showingOverlay}
              .mainView=${this.view}
              .dataStore=${this.#dataStore}
              .runStore=${this.#runStore}
              .sandbox=${sandbox}
              .fileSystem=${this.#fileSystem}
              .graphStore=${this.#graphStore}
              .mainGraphId=${this.tab?.mainGraphId}
              .readOnly=${this.tab?.readOnly ?? true}
              .graph=${this.tab?.graph ?? null}
              .editor=${this.#runtime.edit.getEditor(this.tab)}
              .subGraphId=${this.tab?.subGraphId ?? null}
              .moduleId=${this.tab?.moduleId ?? null}
              .runs=${runs ?? null}
              .topGraphResult=${topGraphResult}
              .boardServerKits=${this.tab?.boardServerKits ?? []}
              .loader=${this.#runtime.board.getLoader()}
              .status=${tabStatus}
              .boardId=${this.#boardId}
              .tabLoadStatus=${tabLoadStatus}
              .settings=${this.#settings}
              .boardServers=${this.#boardServers}
              .history=${this.#runtime.edit.getHistory(this.tab)}
              .version=${this.#version}
              .recentBoards=${this.#recentBoards}
              .inputsFromLastRun=${inputsFromLastRun}
              .tabURLs=${tabURLs}
              .selectionState=${this.#selectionState}
              .visualChangeId=${this.#lastVisualChangeId}
              .graphTopologyUpdateId=${this.graphTopologyUpdateId}
              .graphStoreUpdateId=${this.graphStoreUpdateId}
              .showBoardReferenceMarkers=${this.showBoardReferenceMarkers}
              .chatController=${observers?.chatController}
              .organizer=${projectState?.organizer}
              @bbrun=${async () => {
                await this.#attemptBoardStart();
              }}
              @bbstop=${() => {
                this.#attemptBoardStop();
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
              @bbgraphboardserverloadrequest=${async (
                evt: BreadboardUI.Events.GraphBoardServerLoadRequestEvent
              ) => {
                this.#attemptBoardLoad(
                  new BreadboardUI.Events.StartEvent(evt.url)
                );
              }}
              @bbworkspaceselectionmove=${async (
                evt: BreadboardUI.Events.WorkspaceSelectionMoveEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                await this.#runtime.edit.moveToNewGraph(
                  this.tab,
                  evt.selections,
                  evt.targetGraphId,
                  evt.delta
                );
              }}
              @bbnodecreatereference=${async (
                evt: BreadboardUI.Events.NodeCreateReferenceEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                await this.#runtime.edit.createReference(
                  this.tab,
                  evt.graphId,
                  evt.nodeId,
                  evt.portId,
                  evt.value
                );
              }}
              @bbeditorpositionchange=${(
                evt: BreadboardUI.Events.EditorPointerPositionChangeEvent
              ) => {
                this.#lastPointerPosition.x = evt.x;
                this.#lastPointerPosition.y = evt.y;
              }}
              @bbworkspaceselectionstate=${(
                evt: BreadboardUI.Events.WorkspaceSelectionStateEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.select.processSelections(
                  this.tab.id,
                  evt.selectionChangeId,
                  evt.selections,
                  evt.replaceExistingSelections,
                  evt.moveToSelection
                );
              }}
              @bbworkspacevisualupdate=${(
                evt: BreadboardUI.Events.WorkspaceVisualUpdateEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.edit.processVisualChanges(
                  this.tab,
                  evt.visualChangeId,
                  evt.visualState
                );
              }}
              @bbworkspaceitemvisualupdate=${(
                evt: BreadboardUI.Events.WorkspaceItemVisualUpdateEvent
              ) => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.edit.processVisualChange(
                  this.tab,
                  evt.visualChangeId,
                  evt.graphId,
                  evt.visual
                );
              }}
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
                    Strings.from("ERROR_GENERIC"),
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
              @bbstart=${(evt: BreadboardUI.Events.StartEvent) => {
                this.#attemptBoardLoad(evt);
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
                      this.tab,
                      evt.x ?? null,
                      evt.y ?? null,
                      evt.value,
                      null
                    );
                    break;
                  }

                  case "edit-module-details": {
                    this.#showBoardEditOverlay(
                      this.tab,
                      evt.x ?? null,
                      evt.y ?? null,
                      null,
                      evt.value
                    );
                    break;
                  }

                  default: {
                    this.toast(
                      Strings.from("ERROR_GENERIC"),
                      BreadboardUI.Events.ToastType.WARNING
                    );
                    break;
                  }
                }
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
              @bbboardinfoupdate=${async (
                evt: BreadboardUI.Events.BoardInfoUpdateEvent
              ) => {
                await this.#handleBoardInfoUpdate(evt);
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
                    Strings.from("ERROR_GENERIC"),
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
                await this.#runtime.edit.deleteSubGraph(
                  this.tab,
                  evt.subGraphId
                );
                if (!this.tab) {
                  return;
                }

                this.#runtime.select.deselectAll(
                  this.tab.id,
                  this.#runtime.util.createWorkspaceSelectionChangeId()
                );
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
              @bbtoggleexport=${(
                evt: BreadboardUI.Events.ToggleExportEvent
              ) => {
                this.#attemptToggleExport(evt.exportId, evt.exportType);
              }}
              @bbnoderunrequest=${async (
                evt: BreadboardUI.Events.NodeRunRequestEvent
              ) => {
                await this.#attemptNodeRun(evt.id);
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
              @bbmultiedit=${async (
                evt: BreadboardUI.Events.MultiEditEvent
              ) => {
                await this.#runtime.edit.multiEdit(
                  this.tab,
                  evt.edits,
                  evt.description
                );

                if (!this.tab) {
                  return;
                }

                const additions: string[] = evt.edits
                  .map((edit) =>
                    edit.type === "addnode" ? edit.node.id : null
                  )
                  .filter((item) => item !== null);
                this.#runtime.select.selectNodes(
                  this.tab.id,
                  this.#runtime.select.generateId(),
                  evt.subGraphId ?? BreadboardUI.Constants.MAIN_BOARD_ID,
                  additions
                );
              }}
              @bbnodecreate=${async (
                evt: BreadboardUI.Events.NodeCreateEvent
              ) => {
                await this.#runtime.edit.createNode(
                  this.tab,
                  evt.id,
                  evt.nodeType,
                  evt.configuration,
                  evt.metadata,
                  evt.subGraphId
                );

                if (!this.tab) {
                  return;
                }

                this.#runtime.select.selectNode(
                  this.tab.id,
                  this.#runtime.select.generateId(),
                  evt.subGraphId ?? BreadboardUI.Constants.MAIN_BOARD_ID,
                  evt.id
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
                  evt.id,
                  evt.subGraphId
                );
                this.#commentValueData = {
                  x: evt.x,
                  y: evt.y,
                  value,
                  subGraphId: evt.subGraphId,
                };
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
              @bbnodetyperetrievalerror=${() => {
                this.toast(
                  Strings.from("ERROR_UNABLE_TO_RETRIEVE_TYPE_INFO"),
                  BreadboardUI.Events.ToastType.ERROR
                );
              }}
              @bboutlinemodechange=${() => {
                if (!this.tab) {
                  return;
                }

                this.#runtime.select.deselectAll(
                  this.tab?.id,
                  this.#runtime.util.createWorkspaceSelectionChangeId()
                );
              }}
            ></bb-ui-controller>
        ${
          this.showWelcomePanel
            ? html`<bb-project-listing
                .version=${this.#version}
                .recentBoards=${this.#recentBoards}
                .selectedBoardServer=${this.selectedBoardServer}
                .selectedLocation=${this.selectedLocation}
                .boardServers=${this.#boardServers}
                .boardServerNavState=${this.boardServerNavState}
                @bbgraphboardserverblankboard=${() => {
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
                      Strings.from("STATUS_PROJECTS_REFRESHED"),
                      BreadboardUI.Events.ToastType.INFORMATION
                    );
                  } else {
                    this.toast(
                      Strings.from("ERROR_UNABLE_TO_REFRESH_PROJECTS"),
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
                  this.showWelcomePanel = false;
                  this.#attemptBoardLoad(
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
              ></bb-project-listing>`
            : nothing
        }
          </div>
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
                title: `${Strings.from("COMMAND_OPEN")} ${Strings.from("LABEL_MAIN_PROJECT")}`,
                icon: "open",
                name: "open",
              };
            }
            return {
              title: `${Strings.from("COMMAND_OPEN")} ${module.metadata?.title ?? id}...`,
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
          boardServerAddOverlay,
          nodeConfiguratorOverlay,
          commentOverlay,
          saveAsDialogOverlay,
          openDialogOverlay,
          commandPalette,
          modulePalette,
          boardOverflowMenu,
        ];
      });

    const tooltip = html`<bb-tooltip ${ref(this.#tooltipRef)}></bb-tooltip>`;
    return [until(uiController), tooltip, toasts];
  }
}
