/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  InputValues,
  OutputValues,
  Schema,
} from "@google-labs/breadboard";
import type {
  RunOutputEvent,
  RunInputEvent,
} from "@google-labs/breadboard/harness";
import { idFromPath } from "./top-graph-observer";
import type { EdgeLogEntry } from "../../types/types";

export class EdgeEntry implements EdgeLogEntry {
  type = "edge" as const;
  value?: InputValues | undefined;
  end = null;
}

export class BubbledOutputEdge implements EdgeLogEntry {
  type = "edge" as const;
  value?: OutputValues | undefined;
  schema: Schema | undefined;
  end: number;

  constructor(event: RunOutputEvent) {
    this.schema = event.data.node.configuration?.schema as Schema;
    this.value = event.data.outputs;
    this.end = event.data.timestamp;
  }
}

export class BubbledInputEdge implements EdgeLogEntry {
  type = "edge" as const;
  id: string;
  value: InputValues | undefined;
  schema: Schema | undefined;
  end: number | null;

  constructor(event: RunInputEvent) {
    this.schema = event.data.inputArguments.schema;
    this.id = idFromPath(event.data.path);
    this.end = null;
  }
}

export class InputEdge implements EdgeLogEntry {
  type = "edge" as const;
  id: string;
  value: InputValues | undefined;
  schema: Schema | undefined;
  end: number | null;

  constructor(event: RunInputEvent) {
    this.schema = event.data.inputArguments.schema as Schema;
    this.id = idFromPath(event.data.path);
    this.end = null;
  }
}
