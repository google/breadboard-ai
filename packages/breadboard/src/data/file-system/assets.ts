/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphDescriptor } from "@breadboard-ai/types";
import { FileSystemEntry } from "../types.js";
import { isLLMContentArray } from "../common.js";

export { assetsFromGraphDescriptor };

function assetsFromGraphDescriptor(
  descriptor?: GraphDescriptor
): FileSystemEntry[] {
  const { assets } = descriptor || {};
  if (!assets) return [];

  return Object.entries(assets)
    .filter(([, data]) => isLLMContentArray(data))
    .map(([path, data]) => {
      return { path: `/assets/${path}`, data } as FileSystemEntry;
    });
}
