/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineNodeType } from "@breadboard-ai/build";
import {
  ErrorCapability,
  InputValues,
  OutputValues,
} from "@google-labs/breadboard";
import {
  GenerateTextResponse,
  SafetySetting,
  Text,
  palm,
} from "@google-labs/palm-lite";

export type GenerateTextOutputs = GenerateTextResponse & {
  completion: string;
};

export type GenerateTextInputs = InputValues & {
  /**
   * Prompt for text completion.
   */
  text: string;
  /**
   * The Google Cloud Platform API key
   */
  PALM_KEY: string;
  /**
   * Stop sequences
   */
  stopSequences: string[];
  /**
   * Safety settings
   */
  safetySettings: SafetySetting[];
};

export type GenerateTextError = ErrorCapability & {
  inputs: GenerateTextInputs;
  filters: GenerateTextResponse["filters"];
  safetyFeedback: GenerateTextResponse["safetyFeedback"];
};

export const prepareRequest = ({
  text,
  PALM_KEY,
  stopSequences,
  safetySettings,
}: GenerateTextInputs) => {
  if (!PALM_KEY) throw new Error("Text completion requires `PALM_KEY` input");
  if (!text) throw new Error("Text completion requires `text` input");

  const prompt = new Text().text(text);
  stopSequences = stopSequences || [];
  stopSequences.forEach((stopSequence) => prompt.addStopSequence(stopSequence));
  safetySettings = safetySettings || [];
  safetySettings.forEach((safetySetting) =>
    prompt.addSafetySetting(safetySetting.category, safetySetting.threshold)
  );
  return palm(PALM_KEY).text(prompt);
};

export const prepareResponse = async (
  data: Response
): Promise<OutputValues> => {
  const json = await data.json();
  const response = json as GenerateTextResponse;

  const completion = response?.candidates?.[0]?.output as string;
  if (completion) return { completion, ...json };
  else
    return {
      $error: {
        kind: "error",
        error: new Error(
          "Palm generateText failed: " +
            (data.ok ? JSON.stringify(json) : data.statusText)
        ),
        status: data.status,
        ...json,
      } as GenerateTextError,
    } as OutputValues;
};

export default defineNodeType({
  name: "generateText",
  metadata: {
    deprecated: true, // TODO(Tina): Should this still be here?
  },
  inputs: {
    text: {
      type: "string",
      description: "Prompt for text completion.",
    },
    PALM_KEY: {
      type: "string",
      description: "The Google Cloud Platform API key",
    },
    stopSequences: {
      type: "array",
      description: "Stop sequences",
      items: {
        type: "string",
      },
    },
    safetySettings: {
      type: "array",
      description: "Safety settings",
      items: {
        type: "object",
        required: ["category", "threshold"],
      },
    },
  },
  outputs: {
    completion: {
      type: "string",
      description: "The generated text completion of the supplied text input.",
    },
    $error: {
      type: "object",
      description: "Error information, if any.",
    },
  },
  invoke: async ({ text, PALM_KEY, stopSequences, safetySettings }) => {
    return await prepareResponse(
      await fetch(
        prepareRequest({ text, PALM_KEY, stopSequences, safetySettings })
      )
    );
  },
});
