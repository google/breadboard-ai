/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import test, { describe } from "node:test";
import {
  Context,
  LlmContent,
  SplitMarkerData,
  SplitMetadata,
  combineContextsFunction,
} from "../src/context.js";
import { deepStrictEqual, ok } from "node:assert";

const split = (type: SplitMarkerData["type"], id: string): Context => {
  return { role: "$metadata", type: "split", data: { id, type } };
};

const text = (text: string): Context => {
  return { parts: [{ text }] };
};

describe("combineContexts", () => {
  test("works fine when `merge` isn't specified", () => {
    const a1 = text("Before");
    const a2 = text("Hello");
    const b1 = text("In a");
    const b2 = text("world");
    const result = combineContextsFunction({
      contextA: [a1, a2] satisfies Context[],
      contextB: [b1, b2] satisfies Context[],
    }) as { context: Context[] };

    // Fish out the marker
    const marker = (result?.context[0] as SplitMetadata)?.data?.id;
    ok(marker, "Marker is missing");

    deepStrictEqual(result, {
      context: [
        split("start", marker),
        a1,
        a2,
        split("next", marker),
        b1,
        b2,
        split("end", marker),
      ],
    });
  });

  test("works fine with split markers in the context", () => {
    const common = text("Common");
    const a1 = text("Before");
    const a2 = text("Hello");
    const b1 = text("In a");
    const b2 = text("world");
    const result = combineContextsFunction({
      contextA: [common, split("start", "1"), a1, a2] satisfies Context[],
      contextB: [common, split("start", "1"), b1, b2] satisfies Context[],
    }) as { context: Context[] };

    deepStrictEqual(result, {
      context: [
        common,
        split("start", "1"),
        a1,
        a2,
        split("next", "1"),
        b1,
        b2,
        split("end", "1"),
      ],
    });
  });

  test("handles context ending with a split marker", () => {
    const a1 = text("Before");
    const a2 = text("Hello");
    const result = combineContextsFunction({
      contextA: [a1, split("start", "1")] satisfies Context[],
      contextB: [a1, split("start", "1"), a2] satisfies Context[],
    }) as { context: Context[] };

    deepStrictEqual(result, {
      context: [a1, split("start", "1"), a2, split("end", "1")],
    });
  });

  test("ignores split markers when some context are missing them", () => {
    const a1 = text("Before");
    const a2 = text("Hello");
    const b1 = text("In a");
    const b2 = text("world");
    const result = combineContextsFunction({
      contextA: [a1, a2] satisfies Context[],
      contextB: [b1, b2, split("start", "1")] satisfies Context[],
    }) as { context: Context[] };

    deepStrictEqual(result, {
      context: [a1, a2, b1, b2, split("start", "1")],
    });
  });

  test("Handles resolved split markers", () => {
    const a1 = text("Before");
    const a2 = text("Hello");
    const a3 = text("hello!");
    const b3 = text("where");
    const result = combineContextsFunction({
      contextA: [
        a1,
        split("start", "1"),
        a2,
        split("end", "1"),
        split("start", "2"),
        a3,
      ] satisfies Context[],
      contextB: [
        a1,
        split("start", "1"),
        a2,
        split("end", "1"),
        split("start", "2"),
        b3,
      ] satisfies Context[],
    }) as { context: Context[] };

    deepStrictEqual(result, {
      context: [
        a1,
        split("start", "1"),
        a2,
        split("end", "1"),
        split("start", "2"),
        a3,
        split("next", "2"),
        b3,
        split("end", "2"),
      ],
    });
  });

  test("merges contexts when asked", () => {
    const a1 = { text: "Before" };
    const a2 = { text: "Hello" };
    const b1 = { text: "In a" };
    const b2 = { text: "world" };
    const result = combineContextsFunction({
      contextA: [{ parts: [a1] }, { parts: [a2] }] satisfies LlmContent[],
      contextB: [{ parts: [b1] }, { parts: [b2] }] satisfies LlmContent[],
      merge: true,
    });

    deepStrictEqual(result, {
      context: [{ parts: [a2, b2] }],
    });
  });
});
