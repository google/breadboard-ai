/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from "http";

export type ApiHandler = (
  path: string,
  headers: Record<string, string | number>,
  req: IncomingMessage,
  res: ServerResponse
) => Promise<boolean>;
