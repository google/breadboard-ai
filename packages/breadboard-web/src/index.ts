/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as BreadboardUI from "@google-labs/breadboard-ui";
import { createHarness } from "@google-labs/breadboard/harness";
import { createHarnessConfig } from "./config";
import { InputValues } from "@google-labs/breadboard";

// TODO: Remove once all elements are Lit-based.
BreadboardUI.register();

type PauserCallback = (paused: boolean) => void;
class Pauser extends EventTarget {
  #paused = false;
  #subscribers: PauserCallback[] = [];

  set paused(value: boolean) {
    this.#paused = value;
    this.#notify();
  }

  get paused() {
    return this.#paused;
  }

  #notify() {
    while (this.#subscribers.length) {
      const sub = this.#subscribers.pop();
      if (!sub) {
        break;
      }

      sub.call(null, this.#paused);
    }
  }

  once(callback: () => void) {
    this.#subscribers.push(callback);
  }
}

const sleep = (time: number) =>
  new Promise((resolve) => setTimeout(resolve, time));

export class Main {
  #ui = new BreadboardUI.UI();
  #boardId = 0;
  #delay = 0;
  #pauser = new Pauser();

  constructor(config: { boards: BreadboardUI.Types.Board[] }) {
    // Remove boards that are still works-in-progress from production builds.
    // These boards will have either no version or a version of "0.0.1".
    if (import.meta.env.MODE === "production") {
      config.boards = config.boards.filter(
        (board) => board.version && board.version !== "0.0.1"
      );
    }
    config.boards.sort((a, b) => a.title.localeCompare(b.title));

    this.#ui.boards = config.boards;
    document.body.appendChild(this.#ui);

    document.body.addEventListener(
      BreadboardUI.StartEvent.eventName,
      async (evt: Event) => {
        if (this.#pauser.paused) {
          // Setting this to false will "unpause" the current board, allowing it
          // to shut down. But we'll switch the pause back on for the new board.
          this.#pauser.paused = false;
          this.#pauser.paused = true;
        }

        this.#boardId++;

        const startEvent = evt as BreadboardUI.StartEvent;
        this.setActiveBreadboard(startEvent.url);

        const harness = createHarness(createHarnessConfig(startEvent.url));
        this.#ui.load(await harness.load());

        const currentBoardId = this.#boardId;
        for await (const result of harness.run()) {
          if (result.type !== "nodestart") {
            await this.#suspendIfPaused();
            if (currentBoardId !== this.#boardId) {
              console.log("Changed board");
              return;
            }
          }
          await sleep(this.#delay);

          const answer = (await this.#ui.handleStateChange(
            result
          )) as InputValues;
          if (answer) {
            result.reply({ inputs: answer });
          }
        }
      }
    );

    this.#ui.addEventListener(
      BreadboardUI.Events.BoardUnloadEvent.eventName,
      () => {
        this.setActiveBreadboard(null);
        this.#boardId++;
      }
    );

    this.#ui.addEventListener(
      BreadboardUI.ToastEvent.eventName,
      (evt: Event) => {
        const toastEvent = evt as BreadboardUI.ToastEvent;
        this.#ui.toast(toastEvent.message, toastEvent.toastType);
      }
    );

    this.#ui.addEventListener(
      BreadboardUI.DelayEvent.eventName,
      (evt: Event) => {
        const delayEvent = evt as BreadboardUI.DelayEvent;
        this.#delay = delayEvent.duration;
      }
    );

    const boardFromUrl = this.#getBoardFromUrl();
    if (boardFromUrl) {
      document.body.dispatchEvent(new BreadboardUI.StartEvent(boardFromUrl));
    }
  }

  setActiveBreadboard(url: string | null) {
    const pageUrl = new URL(window.location.href);
    if (url === null) {
      pageUrl.searchParams.delete("board");
    } else {
      pageUrl.searchParams.set("board", url);
    }
    window.history.replaceState(null, "", pageUrl);

    this.#ui.url = url;
  }

  #getBoardFromUrl() {
    return new URL(window.location.href).searchParams.get("board");
  }

  async #suspendIfPaused(): Promise<void> {
    return new Promise((resolve) => {
      if (this.#pauser.paused) {
        this.#ui.paused = true;
        this.#pauser.once(() => {
          this.#ui.paused = false;
          resolve();
        });

        return;
      }

      resolve();
    });
  }
}
