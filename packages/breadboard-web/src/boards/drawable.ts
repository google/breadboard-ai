/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { board, code } from "@google-labs/breadboard";
import { gemini } from "@google-labs/gemini-kit";

// A node that appends the prompt to the picture.
// Note, this one is a bit "in the weeds": it literally formats the Gemini Pro
// API request to include the picture as part of the prompt.
const partsMaker = code(({ picture, prompt }) => {
  const picturePart = (picture as { parts: unknown[] }).parts[0];
  return { parts: [picturePart, { text: prompt }] };
});

export default await board(({ picture, prompt }) => {
  picture
    .isObject()
    .behavior("llm-content")
    .title("Image")
    .format("image-drawable");
  prompt
    .isString()
    .title("Prompt")
    .examples("Describe what you see in the picture");
  const { parts } = partsMaker({
    $id: "combinePictureAndPrompt",
    picture,
    prompt,
  });
  const describePicture = gemini.vision({
    $id: "describePicture",
    parts,
  });
  return { text: describePicture.result };
}).serialize({
  title: "Drawable",
  description:
    "An example of using Gemini Kit's vision node with a drawable canvas",
  version: "0.0.2",
});
