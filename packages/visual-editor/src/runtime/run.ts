/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createRunObserver,
  DataStore,
  GraphLoader,
  InputValues,
  InspectableRunObserver,
  InspectableRunSequenceEntry,
  invokeGraph,
  Kit,
  OutputValues,
  RunArguments,
  RunStore,
} from "@google-labs/breadboard";
import { Result, TabId } from "./types";
import * as BreadboardUI from "@breadboard-ai/shared-ui";
import {
  createRunner,
  HarnessRunner,
  RunConfig,
  RunEndEvent,
  RunErrorEvent,
  RunGraphEndEvent,
  RunGraphStartEvent,
  RunInputEvent,
  RunLifecycleEvent,
  RunNextEvent,
  RunNodeEndEvent,
  RunNodeStartEvent,
  RunOutputEvent,
  RunSecretEvent,
  RunSkipEvent,
} from "@google-labs/breadboard/harness";
import { RuntimeBoardRunEvent } from "./events";

export class Run extends EventTarget {
  #runs = new Map<
    TabId,
    {
      harnessRunner?: HarnessRunner;
      topGraphObserver?: BreadboardUI.Utils.TopGraphObserver;
      runObserver?: InspectableRunObserver;
      abortController?: AbortController;
    }
  >();

  constructor(
    public readonly dataStore: DataStore,
    public readonly runStore: RunStore,
    public readonly kits: Kit[]
  ) {
    super();
  }

  create(
    tabId: TabId,
    topGraphObserver: BreadboardUI.Utils.TopGraphObserver,
    runObserver?: InspectableRunObserver
  ) {
    this.#runs.set(tabId, { topGraphObserver, runObserver });
  }

  getRunner(tabId: TabId | null) {
    if (!tabId) {
      return null;
    }

    const run = this.#runs.get(tabId);
    if (!run) {
      return null;
    }

    return run.harnessRunner ?? null;
  }

  getAbortSignal(tabId: TabId | null) {
    if (!tabId) {
      return null;
    }

    const run = this.#runs.get(tabId);
    if (!run) {
      return null;
    }

    return run.abortController ?? null;
  }

  getObservers(tabId: TabId | null) {
    if (!tabId) {
      return null;
    }

    const run = this.#runs.get(tabId);
    if (!run) {
      return null;
    }

    const { topGraphObserver, runObserver } = run;
    return { topGraphObserver, runObserver };
  }

  async runBoard(
    tabId: TabId,
    config: RunConfig,
    history?: InspectableRunSequenceEntry[]
  ) {
    const abortController = new AbortController();
    config = { ...config, kits: this.kits, signal: abortController.signal };

    const runner = this.#createBoardRunner(config, abortController);
    this.#runs.set(tabId, runner);

    const { harnessRunner, runObserver, topGraphObserver } = runner;
    harnessRunner.addEventListener("start", (evt: RunLifecycleEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("pause", (evt: RunLifecycleEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("resume", (evt: RunLifecycleEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("next", (evt: RunNextEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("input", (evt: RunInputEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("output", (evt: RunOutputEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("secret", (evt: RunSecretEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("error", (evt: RunErrorEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("skip", (evt: RunSkipEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("graphstart", (evt: RunGraphStartEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("graphend", (evt: RunGraphEndEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("nodestart", (evt: RunNodeStartEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("nodeend", (evt: RunNodeEndEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    harnessRunner.addEventListener("end", (evt: RunEndEvent) => {
      this.dispatchEvent(
        new RuntimeBoardRunEvent(tabId, evt, harnessRunner, abortController)
      );
    });

    if (history) {
      await runObserver.append(history);
      topGraphObserver.startWith(history);
    }
    harnessRunner.run();
  }

  #createBoardRunner(config: RunConfig, abortController: AbortController) {
    const harnessRunner = createRunner(config);
    const runObserver = createRunObserver({
      logLevel: "debug",
      dataStore: this.dataStore,
      runStore: this.runStore,
      kits: this.kits,
    });

    const topGraphObserver = new BreadboardUI.Utils.TopGraphObserver(
      harnessRunner,
      config.signal,
      runObserver
    );

    harnessRunner.addObserver(runObserver);

    return { harnessRunner, topGraphObserver, runObserver, abortController };
  }

  async invokeSideboard(
    url: string,
    loader: GraphLoader,
    inputs: InputValues
  ): Promise<Result<OutputValues>> {
    const sideboard = await loader.load(url, {
      base: new URL(window.location.href),
    });
    if (!sideboard) {
      return {
        success: false,
        error: `Unable to load sidebard at "${url}`,
      };
    }
    const args: RunArguments = {
      kits: this.kits,
      loader: loader,
      store: this.dataStore,
    };
    const result = await invokeGraph(sideboard, inputs, args);
    return { success: true, result };
  }
}
