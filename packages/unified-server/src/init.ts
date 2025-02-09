/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as pkg from "../package.json" with { type: "json" };
import * as StringsHelper from "@breadboard-ai/shared-ui/strings";

const icon = document.createElement("link");
icon.rel = "icon";
icon.type = "image/svg+xml";
icon.href = MAIN_ICON;
document.head.appendChild(icon);

const assetPack = document.createElement("style");
assetPack.textContent = ASSET_PACK;
document.head.appendChild(assetPack);

const params = new URLSearchParams(location.search);
if (params.has("dark")) {
  globalThis.localStorage.setItem("dark-theme", "true");
} else if (params.has("light")) {
  globalThis.localStorage.removeItem("dark-theme");
}

if (globalThis.localStorage.getItem("dark-theme") === "true") {
  document.documentElement.classList.add("dark-theme");
}

async function init() {
  const version = pkg.default.version;
  await StringsHelper.initFrom(LANGUAGE_PACK);

  const { Main } = await import("@breadboard-ai/visual-editor");
  const { SettingsStore } = await import(
    "@breadboard-ai/shared-ui/data/settings-store.js"
  );

  const config = {
    settings: SettingsStore.instance(),
    version,
  };

  window.oncontextmenu = (evt) => evt.preventDefault();

  const main = new Main(config);
  document.body.appendChild(main);

  const Strings = StringsHelper.forSection("Global");
  console.log(
    `[${Strings.from("APP_NAME")} Visual Editor: Version ${version}]`
  );
}

init();
