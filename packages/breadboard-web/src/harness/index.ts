/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MainThreadHarness } from "./main-thread-harness";
import { ProxyServerHarness } from "./proxy-server-harness";
import { Harness, HarnessConfig, SecretHandler } from "./types";
import { WorkerHarness } from "./worker-harness";

export const createHarness = (
  config: HarnessConfig,
  onSecret: SecretHandler
): Harness => {
  if (config.runtime.location === "main") {
    if (config.proxy?.[0]?.location === "http") {
      return new ProxyServerHarness(config);
    }
    return new MainThreadHarness(config, onSecret);
  }
  if (config.runtime.location === "worker") {
    return new WorkerHarness(config, onSecret);
  }
  throw new Error(`Unsupported harness configuration: ${config}`);
};
