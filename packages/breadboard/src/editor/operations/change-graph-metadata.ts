/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { toSubgraphContext } from "../subgraph-context.js";
import {
  EditOperation,
  EditOperationContext,
  EditSpec,
  SingleEditResult,
} from "../types.js";

export class ChangeGraphMetadata implements EditOperation {
  async do(
    spec: EditSpec,
    context: EditOperationContext
  ): Promise<SingleEditResult> {
    if (spec.type !== "changegraphmetadata") {
      throw new Error(
        `Editor API integrity error: expected type "changegraphmetadata", received "${spec.type}" instead.`
      );
    }
    const { metadata, graphId } = spec;
    const subgraphContext = toSubgraphContext(context, graphId);
    if (!subgraphContext.success) {
      return subgraphContext;
    }

    const { graph } = subgraphContext.result;
    const visualOnly = graph.metadata === metadata;
    graph.metadata = metadata;
    return {
      success: true,
      visualOnly,
      affectedNodes: [],
      affectedModules: [],
      affectedGraphs: [],
    };
  }
}
