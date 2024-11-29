/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test";
import { Snapshot } from "../../../src/inspector/snapshot/snapshot.js";
import { GraphDescriptor } from "@breadboard-ai/types";
import { MutableGraphImpl } from "../../../src/inspector/graph/mutable-graph.js";
import { makeTestGraphStore } from "../../helpers/_graph-store.js";
import { deepStrictEqual } from "node:assert";
import {
  SnapshotChangeSpec,
  SnapshotPendingUpdate,
} from "../../../src/inspector/snapshot/types.js";

function mutable(graph: GraphDescriptor) {
  return new MutableGraphImpl(
    graph,
    makeTestGraphStore({
      kits: [
        {
          url: "",
          handlers: {
            type: {
              invoke: () => {
                throw new Error('Test error: "type" should not be invoked');
              },
            },
            runModule: {
              invoke: () => {
                throw new Error(
                  'Test error: "run-module" should not be invoked'
                );
              },
            },
          },
        },
      ],
    })
  );
}

describe("Snapshot changes", async () => {
  it("correctly builds initial list of changes", () => {
    const blank = new Snapshot(mutable({ nodes: [], edges: [] }));
    deepStrictEqual(blank.changes, [
      {
        type: "addgraph",
        graphId: "",
      },
    ] satisfies SnapshotChangeSpec[]);

    const withInlineMetadata = new Snapshot(
      mutable({ title: "Foo", description: "Bar", nodes: [], edges: [] })
    );
    deepStrictEqual(withInlineMetadata.changes, [
      {
        type: "addgraph",
        metadata: { title: "Foo", description: "Bar" },
        graphId: "",
      },
    ] satisfies SnapshotChangeSpec[]);

    const withMetadata = new Snapshot(
      mutable({
        version: "0.0.1",
        nodes: [],
        edges: [],
        metadata: { tags: ["published"] },
      })
    );
    deepStrictEqual(withMetadata.changes, [
      {
        type: "addgraph",
        metadata: { version: "0.0.1" },
        graphId: "",
      },
      {
        type: "changegraphmetadata",
        graphId: "",
        metadata: { tags: ["published"] },
      },
    ] satisfies SnapshotChangeSpec[]);

    const everything = new Snapshot(
      mutable({
        title: "Title",
        nodes: [
          { id: "first", type: "type", configuration: { foo: "foo" } },
          { id: "second", type: "type", configuration: { bar: "bar" } },
        ],
        edges: [{ from: "first", out: "out", to: "second", in: "in" }],
        modules: {
          mod1: {
            code: "foo",
          },
          mod2: {
            code: "bar",
            metadata: {
              runnable: true,
            },
          },
        },
        graphs: {
          subgraph1: {
            title: "Subgraph 1",
            nodes: [
              { id: "third", type: "type", configuration: { foo: "baz" } },
            ],
            edges: [{ from: "third", out: "out", to: "third", in: "in" }],
          },
        },
      })
    );
    deepStrictEqual(everything.changes, [
      {
        type: "addgraph",
        metadata: { title: "Title" },
        graphId: "",
      },
      {
        type: "addnode",
        node: { id: "first", type: "type", configuration: { foo: "foo" } },
        graphId: "",
      },
      {
        type: "addnode",
        node: { id: "second", type: "type", configuration: { bar: "bar" } },
        graphId: "",
      },
      {
        type: "addedge",
        edge: { from: "first", out: "out", to: "second", in: "in" },
        id: 1115284803,
        graphId: "",
      },
      {
        type: "addmodule",
        id: "mod1",
        module: {
          code: "foo",
        },
      },
      {
        type: "addmodule",
        id: "mod2",
        module: {
          code: "bar",
          metadata: {
            runnable: true,
          },
        },
      },
      {
        graphId: "subgraph1",
        metadata: {
          title: "Subgraph 1",
        },
        type: "addgraph",
      },
      {
        graphId: "subgraph1",
        node: {
          configuration: {
            foo: "baz",
          },
          id: "third",
          type: "type",
        },
        type: "addnode",
      },
      {
        edge: {
          from: "third",
          in: "in",
          out: "out",
          to: "third",
        },
        graphId: "subgraph1",
        id: 4075679067,
        type: "addedge",
      },
    ] satisfies SnapshotChangeSpec[]);
    deepStrictEqual(everything.pending, [
      {
        type: "updateports",
        graphId: "",
        nodeId: "first",
      },
      {
        type: "updateports",
        graphId: "",
        nodeId: "second",
      },
      {
        type: "updateports",
        graphId: "subgraph1",
        nodeId: "third",
      },
    ] satisfies SnapshotPendingUpdate[]);

    const imperative = new Snapshot(
      mutable({
        title: "Title",
        main: "main",
        modules: {
          main: {
            code: "code",
          },
        },
        edges: [],
        nodes: [],
      })
    );
    deepStrictEqual(imperative.changes, [
      {
        type: "addgraph",
        metadata: { title: "Title" },
        main: "main",
        graphId: "",
      },
      {
        type: "addmodule",
        id: "main",
        module: {
          code: "code",
        },
      },
    ] satisfies SnapshotChangeSpec[]);
  });

  await it("correctly produces initial port updates", async () => {
    const oneNode = new Snapshot(
      mutable({
        title: "Title",
        nodes: [{ id: "first", type: "type", configuration: { foo: "foo" } }],
        edges: [],
      })
    );
    deepStrictEqual(oneNode.changes, [
      {
        type: "addgraph",
        metadata: { title: "Title" },
        graphId: "",
      },
      {
        type: "addnode",
        node: { id: "first", type: "type", configuration: { foo: "foo" } },
        graphId: "",
      },
    ] satisfies SnapshotChangeSpec[]);
    deepStrictEqual(oneNode.pending, [
      {
        type: "updateports",
        graphId: "",
        nodeId: "first",
      },
    ] satisfies SnapshotPendingUpdate[]);
    await oneNode.update();
    deepStrictEqual(oneNode.pending, []);
    deepStrictEqual(oneNode.changes, [
      {
        type: "addgraph",
        metadata: { title: "Title" },
        graphId: "",
      },
      {
        type: "addnode",
        node: { id: "first", type: "type", configuration: { foo: "foo" } },
        graphId: "",
      },
      {
        type: "updateports",
        graphId: "",
        nodeId: "first",
        input: {
          added: [
            {
              configured: false,
              kind: "input",
              name: "",
              schema: {
                type: "string",
              },
              star: true,
              status: "ready",
              title: "",
              value: undefined,
            },
            {
              configured: false,
              kind: "input",
              name: "*",
              schema: {
                type: "string",
              },
              star: true,
              status: "ready",
              title: "*",
              value: undefined,
            },
            {
              configured: true,
              kind: "input",
              name: "foo",
              schema: {
                type: "string",
              },
              star: false,
              status: "connected",
              title: "foo",
              value: "foo",
            },
          ],
          deleted: [],
          fixedChanged: false,
          updated: [],
        },
        output: {
          added: [
            {
              configured: false,
              kind: "output",
              name: "",
              schema: {
                type: "string",
              },
              star: true,
              status: "ready",
              title: "",
              value: undefined,
            },
            {
              configured: false,
              kind: "output",
              name: "$error",
              schema: {
                type: "string",
              },
              star: false,
              status: "ready",
              title: "$error",
              value: undefined,
            },
            {
              configured: false,
              kind: "output",
              name: "*",
              schema: {
                type: "string",
              },
              star: true,
              status: "ready",
              title: "*",
              value: undefined,
            },
          ],
          deleted: [],
          fixedChanged: false,
          updated: [],
        },
        side: {
          added: [],
          deleted: [],
          fixedChanged: true,
          updated: [],
        },
      },
    ] satisfies SnapshotChangeSpec[]);
  });
});
