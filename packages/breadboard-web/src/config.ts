/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { asRuntimeKit } from "@google-labs/breadboard";
import {
  HarnessProxyConfig,
  HarnessRemoteConfig,
  KitConfig,
  defineServeConfig,
  RunConfig,
} from "@google-labs/breadboard/harness";
import Core from "@google-labs/core-kit";
import JSONKit from "@google-labs/json-kit";
import TemplateKit from "@google-labs/template-kit";
import NodeNurseryWeb from "@google-labs/node-nursery-web";
import PaLMKit from "@google-labs/palm-kit";
import Pinecone from "@google-labs/pinecone-kit";
import GeminiKit from "@google-labs/gemini-kit";
import AgentKit from "@google-labs/agent-kit";

const PROXY_NODES = [
  "palm-generateText",
  "palm-embedText",
  "secrets",
  "fetch",
  // TODO: These are only meaningful when proxying to main thread,
  //       not anywhere else. Need to figure out what to do here.
  // "credentials",
  // "driveList",
];

const WORKER_URL =
  import.meta.env.MODE === "development" ? "/src/worker.ts" : "/worker.js";

const HARNESS_SWITCH_KEY = "bb-harness";

const PROXY_SERVER_HARNESS_VALUE = "proxy-server";
const WORKER_HARNESS_VALUE = "worker";

const PROXY_SERVER_URL = import.meta.env.VITE_PROXY_SERVER_URL;
const DEFAULT_HARNESS = PROXY_SERVER_URL
  ? PROXY_SERVER_HARNESS_VALUE
  : WORKER_HARNESS_VALUE;

const fetchAndLoadKits = async () => {
  const response = await fetch(`${self.location.origin}/kits.json`);
  const kitList = await response.json();

  const kits = await Promise.all(
    kitList.map(async (kit: string) => {
      const module = await import(`${kit}`);

      if (module.default == undefined) {
        throw new Error(`Module ${kit} does not have a default export.`);
      }

      const moduleKeys = Object.getOwnPropertyNames(module.default.prototype);

      if (
        moduleKeys.includes("constructor") == false ||
        moduleKeys.includes("handlers") == false
      ) {
        throw new Error(
          `Module default export '${kit}' does not look like a Kit (either no constructor or no handler).`
        );
      }
      return module.default;
    })
  );

  return kits;
};

const kits = [
  TemplateKit,
  Core,
  Pinecone,
  PaLMKit,
  GeminiKit,
  NodeNurseryWeb,
  JSONKit,
  AgentKit,
  ...(await fetchAndLoadKits()),
].map((kitConstructor) => asRuntimeKit(kitConstructor));

export const createRunConfig = (url: string): RunConfig => {
  const harness =
    globalThis.localStorage.getItem(HARNESS_SWITCH_KEY) ?? DEFAULT_HARNESS;

  const proxy: HarnessProxyConfig[] = [];
  if (harness === PROXY_SERVER_HARNESS_VALUE) {
    proxy.push({
      location: "http",
      url: PROXY_SERVER_URL,
      nodes: PROXY_NODES,
    });
  } else if (harness === WORKER_HARNESS_VALUE) {
    proxy.push({ location: "main", nodes: PROXY_NODES });
  }
  const remote: HarnessRemoteConfig = harness === WORKER_HARNESS_VALUE && {
    type: "worker",
    url: WORKER_URL,
  };
  const diagnostics = true;
  return { url, kits, remote, proxy, diagnostics, runner: undefined };
};

export const serveConfig = defineServeConfig({
  transport: "worker",
  kits: [{ proxy: PROXY_NODES } as KitConfig, ...kits],
  diagnostics: true,
});
