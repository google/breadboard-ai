/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GraphDescriptor,
  InputValues,
  NodeHandlerContext,
  type Kit,
} from "@google-labs/breadboard";

import { WebModuleManager } from "@breadboard-ai/jsandbox";
import wasm from "/sandbox.wasm?url";

import { Capabilities } from "@breadboard-ai/jsandbox";

export { addSandboxedRunModule };

function findHandler(handlerName: string, kits?: Kit[]) {
  const handler = kits
    ?.flatMap((kit) => Object.entries(kit.handlers))
    .find(([name]) => name === handlerName)
    ?.at(1);

  return handler;
}

function getHandler(handlerName: string, context: NodeHandlerContext) {
  const handler = findHandler(handlerName, context.kits);

  if (!handler || typeof handler === "string") {
    throw new Error("Trying to get one of the non-core handlers");
  }

  const invoke = "invoke" in handler ? handler.invoke : handler;

  return [
    handlerName,
    async (inputs: InputValues) => {
      try {
        return invoke(inputs as InputValues, context);
      } catch (e) {
        return { $error: (e as Error).message };
      }
    },
  ] as [
    string,
    (inputs: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ];
}

function addSandboxedRunModule(board: GraphDescriptor, kits: Kit[]): Kit[] {
  const modules = board.modules;
  if (!modules) {
    return kits;
  }

  const runner = new WebModuleManager(
    new URL(wasm, window.location.href),
    Object.fromEntries(
      Object.entries(modules).map(([name, spec]) => [name, spec.code])
    )
  );

  const existingRunModule = findHandler("runModule", kits);
  const describe =
    existingRunModule &&
    typeof existingRunModule !== "string" &&
    "describe" in existingRunModule
      ? existingRunModule.describe
      : undefined;

  return [
    {
      url: import.meta.url,
      handlers: {
        runModule: {
          invoke: async ({ $module, ...rest }, context) => {
            Capabilities.instance().install([
              getHandler("fetch", context),
              getHandler("secrets", context),
            ]);

            const modules = context.board?.modules;
            if (!modules) {
              throw new Error(`No modules were found in this graph`);
            }
            const result = await runner.invoke($module as string, rest);
            return result as InputValues;
          },
          describe,
        },
      },
    },
    ...kits,
  ];
}
