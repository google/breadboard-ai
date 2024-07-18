/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  annotate,
  board,
  input,
  object,
  output,
} from "@breadboard-ai/build";
import { invoke } from "@google-labs/core-kit";

const prompt = input({
  type: "string",
  title: "Prompt",
  description: "The prompt to generate a completion for",
  examples: ["Tell me a fun story about playing with breadboards"],
});

const generator = input({
  title: "Generator",
  type: annotate(object({}), {
    behavior: ["board"],
  }),
  description: "The URL of the generator to call",
  default: { kind: "board", path: "gemini-generator.json" },
});

const response = invoke({ $id: "gemini", $board: generator, instructions: prompt }).unsafeOutput("text");

export default board({
  title: "The simplest LLM-based board",
  description:
    "This board is as simple as it gets: takes text as input and invokes Gemini to generate a text response as output.",
  version: "0.1.0",
  inputs: { generator, prompt },
  outputs: {
    response: output(response, {
      title: "Response",
      description: "The completion generated by the LLM",
    }),
  }
});