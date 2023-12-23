/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Harness,
  HarnessConfig,
  HarnessRunResult,
  SecretHandler,
} from "./types.js";
import { LocalRunResult } from "./result.js";
import { createOnSecret } from "./secrets.js";
import { KitBuilder } from "../kits/builder.js";
import { InputValues } from "../types.js";
import { asRuntimeKit } from "../kits/ctors.js";
import { ProxyClient } from "../remote/proxy.js";
import { HTTPClientTransport } from "../remote/http.js";
import { asyncGen } from "../utils/async-gen.js";
import { Board } from "../board.js";
import { Diagnostics } from "./diagnostics.js";

export class LocalHarness implements Harness {
  #config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.#config = config;
  }

  #configureKits(onSecret: SecretHandler) {
    let kits = this.#config.kits;
    // Because we're in the browser, we need to ask for secrets from the user.
    // Add a special kit that overrides the `secrets` handler to ask the user
    // for secrets.
    const secretAskingKit = new KitBuilder({
      url: "secret-asking-kit",
    }).build({
      secrets: async (inputs) => {
        return await onSecret(inputs as InputValues);
      },
    });
    kits = [asRuntimeKit(secretAskingKit), ...kits];

    // If a proxy is configured, add the proxy kit to the list of kits.
    // Note, this may override the `secrets` handler from the SecretAskingKit.
    const proxyConfig = this.#config.proxy?.[0];
    if (proxyConfig) {
      if (proxyConfig.location === "http") {
        if (!proxyConfig.url) {
          throw new Error("No node proxy server URL provided.");
        }
        const proxyClient = new ProxyClient(
          new HTTPClientTransport(proxyConfig.url)
        );
        kits = [proxyClient.createProxyKit(proxyConfig.nodes), ...kits];
      } else {
        throw new Error(
          "Only HTTP node proxy server is supported at this time."
        );
      }
    }
    return kits;
  }

  async *run(url: string) {
    yield* asyncGen<HarnessRunResult>(async (next) => {
      const kits = this.#configureKits(createOnSecret(next));

      try {
        const runner = await Board.load(url);

        await next(
          new LocalRunResult({
            type: "load",
            data: {
              title: runner.title,
              description: runner.description,
              version: runner.version,
              diagram: runner.mermaid("TD", true),
              url: url,
              nodes: runner.nodes,
            },
          })
        );

        const probe = new Diagnostics(async (message) => {
          await next(new LocalRunResult(message));
        });

        for await (const data of runner.run({ probe, kits })) {
          const { type } = data;
          if (type === "input") {
            const inputResult = new LocalRunResult({ type, data });
            await next(inputResult);
            data.inputs = inputResult.response as InputValues;
          } else if (type === "output") {
            await next(new LocalRunResult({ type, data }));
          } else if (type === "beforehandler") {
            await next(new LocalRunResult({ type, data }));
          } else if (type === "afterhandler") {
            await next(new LocalRunResult({ type, data }));
          }
        }
        await next(new LocalRunResult({ type: "end", data: {} }));
      } catch (e) {
        let error = e as Error;
        let message = "";
        while (error?.cause) {
          error = (error.cause as { error: Error }).error;
          message += `\n${error.message}`;
        }
        console.error(message, error);
        await next(new LocalRunResult({ type: "error", data: { error } }));
      }
    });
  }
}
