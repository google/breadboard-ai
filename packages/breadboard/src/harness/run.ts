/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocalHarness } from "./local-harness.js";
import { Harness, HarnessConfig } from "./types.js";
import { WorkerHarness } from "./worker-harness.js";

const createHarness = (config: HarnessConfig): Harness => {
  if (!config.remote) {
    return new LocalHarness(config);
  }
  if (config.remote.type === "worker") {
    return new WorkerHarness(config);
  }
  throw new Error(`Unsupported harness configuration: ${config}`);
};

export const run = (config: HarnessConfig) => {
  const harness = createHarness(config);
  return harness.run();
};
