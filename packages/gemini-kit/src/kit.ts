/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Board } from "@google-labs/breadboard";

import { geminiText } from "./components/text.js";
import { geminiNano } from "./components/nano.js";

import { Core } from "@google-labs/core-kit";
import { serialize } from "@breadboard-ai/build";

// TODO: Convert to new syntax
const kit = new Board({
  title: "Gemini API Kit",
  description:
    "This board is actually a kit: a collection of nodes for working with the Gemini API.",
  version: "0.0.1",
});
const core = kit.addKit(Core);

kit.graphs = {
  text: serialize(geminiText),
  nano: serialize(geminiNano),
};

core.invoke({
  $id: "text",
  $metadata: {
    title: "Gemini Generator",
    description: "Generates text using the Gemini API.",
    help: {
      url: "https://breadboard-ai.github.io/breadboard/docs/kits/gemini/#the-text-component",
    },
  },
  $board: "#text",
});
core.invoke({
  $id: "nano",
  $board: "#nano",
  $metadata: {
    title: "Gemini Nano (Preview)",
    description: "Generates text with the on-device Gemini Nano model ",
    icon: "nano",
    help: {
      url: "https://breadboard-ai.github.io/breadboard/docs/kits/gemini/#the-nano-component",
    },
  },
});

export default kit;
