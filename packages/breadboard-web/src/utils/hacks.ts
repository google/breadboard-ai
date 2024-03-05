/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HarnessRunResult } from "@google-labs/breadboard/harness";

// Temporary hacks while extruding the inspectRun API.
type Runner = AsyncGenerator<HarnessRunResult, void, unknown>;

export class RunInspector {
  messages: HarnessRunResult[] = [];

  observe(runner: Runner): Runner {
    return new Observer(runner, (message) => {
      this.messages.push(message);
    });
  }
}

type OnResult = (message: HarnessRunResult) => void;

class Observer implements Runner {
  #runner: Runner;
  #onResult: OnResult;

  constructor(runner: Runner, onResult: OnResult) {
    this.#onResult = onResult;
    this.#runner = runner;
  }

  async next() {
    const result = await this.#runner.next();
    if (result.done) {
      return result;
    }
    this.#onResult(result.value);
    return result;
  }
  async return() {
    return this.#runner.return();
  }
  async throw(error?: unknown) {
    return this.#runner.throw(error);
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
