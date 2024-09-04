/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { InspectableEdgeType, InspectablePort } from "@google-labs/breadboard";
import type { EdgeData } from "../../types/types.js";

const documentStyles = getComputedStyle(document.documentElement);

type ValidColorStrings = `#${number}` | `--${string}`;

export function getGlobalColor(
  name: ValidColorStrings,
  defaultValue: ValidColorStrings = "#333333"
) {
  const value = documentStyles.getPropertyValue(name)?.replace(/^#/, "");
  const valueAsNumber = parseInt(value || defaultValue, 16);
  if (Number.isNaN(valueAsNumber)) {
    return 0xff00ff;
  }
  return valueAsNumber;
}

export function inspectableEdgeToString(edge: EdgeData): string {
  return `${edge.from.descriptor.id}:${edge.out}->${edge.to.descriptor.id}:${edge.in}`;
}

export function edgeToString(edge: {
  from: string;
  to: string;
  out: string;
  in: string;
}): string {
  const fakeEdge = {
    from: {
      descriptor: {
        id: edge.from,
      },
    },
    to: {
      descriptor: {
        id: edge.to,
      },
    },
    out: edge.out,
    in: edge.in,
    type: InspectableEdgeType.Ordinary,
  };
  return inspectableEdgeToString(fakeEdge);
}

export const DBL_CLICK_DELTA = 450;

export function isConfigurablePort(port: InspectablePort) {
  if (port.star) return false;
  if (port.name === "") return false;

  // TODO: Figure out if this is the right call.
  if (port.schema.behavior?.includes("ports-spec")) return false;

  if (port.schema.behavior?.includes("config")) return true;
  const items = port.schema.items;
  if (items && !Array.isArray(items) && items.behavior?.includes("config")) {
    return true;
  }

  return false;
}
