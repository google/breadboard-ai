/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bootstrap } from "@breadboard-ai/visual-editor/bootstrap";

bootstrap({
  boardServerUrl: new URL("/board", window.location.href),
});
