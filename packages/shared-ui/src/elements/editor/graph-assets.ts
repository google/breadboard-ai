/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as PIXI from "pixi.js";

const root = document.querySelector(":root");
const darkTheme = root?.classList.contains("dark-theme") ?? false;
const themeSuffix = darkTheme ? "-inverted" : "";
const themeAssets: [string, string][] = [
  [
    "code-blocks",
    `/third_party/icons/graph/code-blocks${themeSuffix}-48px.svg`,
  ],
  [
    "drag-click-inverted",
    `/third_party/icons/graph/drag-click-inverted-48px.svg`,
  ],
  ["edit", `/third_party/icons/graph/edit${themeSuffix}-48px.svg`],
  ["fetch", `/third_party/icons/graph/fetch${themeSuffix}-48px.svg`],
  [
    "google-drive",
    `/third_party/icons/graph/google-drive${themeSuffix}-48px.svg`,
  ],
  ["human", `/third_party/icons/graph/human${themeSuffix}-48px.svg`],
  ["input", `/third_party/icons/graph/input${themeSuffix}-48px.svg`],
  ["jsonata", `/third_party/icons/graph/jsonata${themeSuffix}-48px.svg`],
  ["laps", `/third_party/icons/graph/laps${themeSuffix}-48px.svg`],
  ["joiner", `/third_party/icons/graph/merge-type${themeSuffix}-48px.svg`],
  ["nano", `/third_party/icons/graph/nano${themeSuffix}-48px.svg`],
  ["output", `/third_party/icons/graph/output${themeSuffix}-48px.svg`],
  [
    "play-filled",
    `/third_party/icons/graph/play-filled${themeSuffix}-48px.svg`,
  ],
  ["runJavascript", `/third_party/icons/graph/js${themeSuffix}-48px.svg`],
  ["runModule", `/third_party/icons/graph/extension${themeSuffix}-48px.svg`],
  ["secrets", `/third_party/icons/graph/secrets${themeSuffix}-48px.svg`],
  ["smart-toy", `/third_party/icons/graph/smart-toy${themeSuffix}-48px.svg`],
  [
    "generative",
    `/third_party/icons/graph/generative/generative${themeSuffix}-48px.svg`,
  ],
  [
    "generative-audio",
    `/third_party/icons/graph/generative/generative-audio${themeSuffix}-48px.svg`,
  ],
  [
    "generative-image",
    `/third_party/icons/graph/generative/generative-image${themeSuffix}-48px.svg`,
  ],
  [
    "generative-text",
    `/third_party/icons/graph/generative/generative-text${themeSuffix}-48px.svg`,
  ],
  ["urlTemplate", `/third_party/icons/graph/http${themeSuffix}-48px.svg`],
  ["value", `/third_party/icons/graph/value${themeSuffix}-48px.svg`],
];

const ASSET_LIST: Map<string, string> = new Map(themeAssets);

type AssetMap = Map<string, PIXI.Texture>;

export class GraphAssets {
  static assetPrefix = "~";
  static #instance: GraphAssets;
  static instance() {
    if (!this.#instance) {
      this.#instance = new GraphAssets();
    }
    return this.#instance;
  }

  #assets: AssetMap = new Map();
  #loaded: Promise<void> = Promise.resolve();

  loadAssets(assetPrefix: string) {
    GraphAssets.assetPrefix = assetPrefix;
    const loadedAssets = [...ASSET_LIST.entries()].map(
      async ([name, path]): Promise<[string, PIXI.Texture | null]> => {
        try {
          const texture = await PIXI.Assets.load<PIXI.Texture>(
            `${GraphAssets.assetPrefix}${path}`
          );
          return [name, texture];
        } catch (e) {
          return [name, null];
        }
      }
    );

    this.#loaded = Promise.all(loadedAssets).then((vals) => {
      this.#assets = new Map(
        vals.filter((v) => v[1] !== null) as [string, PIXI.Texture][]
      );
    });
  }

  // Not to be instantiated directly.
  private constructor() {}

  get loaded() {
    return this.#loaded;
  }

  get(name: string) {
    return this.#assets.get(name) || null;
  }

  has(name: string) {
    return this.#assets.has(name);
  }
}
