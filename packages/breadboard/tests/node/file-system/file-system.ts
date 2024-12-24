/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it } from "node:test";
import { FileSystemImpl } from "../../../src/data/file-system/index.js";
import { deepStrictEqual, ok } from "node:assert";
import { FileSystemReadWritePath, Outcome } from "../../../src/index.js";

function good<T>(o: Outcome<T>): o is T {
  const error = o && typeof o === "object" && "$error" in o;
  ok(!error, "outcome must not be an error");
  return !error;
}

function bad<T>(o: Outcome<T>) {
  ok(o && typeof o === "object" && "$error" in o, "outcome must be an error");
}

describe("File System", () => {
  it("reads and writes files", async () => {
    const fs = new FileSystemImpl();
    const writeResult = await fs.write({
      path: "/session/test",
      type: "text",
      data: "test",
    });
    ok(!writeResult);
    const readResult = await fs.read({
      path: "/session/test",
    });
    deepStrictEqual(readResult, { type: "text", data: "test" });
  });

  it("can delete files", async () => {
    const fs = new FileSystemImpl();
    const writeResult = await fs.write({
      path: "/session/test",
      type: "text",
      data: "test",
    });
    ok(!writeResult);
    const readResult = await fs.read({
      path: "/session/test",
    });
    deepStrictEqual(readResult, { type: "text", data: "test" });
    const deleteResult = await fs.write({
      path: "/session/test",
      type: "text",
      data: null,
    });
    ok(!deleteResult);
    const repeatReadResult = await fs.read({
      path: "/session/test",
    });
    ok("$error" in repeatReadResult);
  });

  it("has runtime check for readonly/invalid paths", async () => {
    const fs = new FileSystemImpl();
    const writeResult = await fs.write({
      // Force invalid value
      path: "/env/test" as unknown as FileSystemReadWritePath,
      type: "text",
      data: "test",
    });
    ok(writeResult && "$error" in writeResult);
  });

  it("can delete entire directories", async () => {
    const fs = new FileSystemImpl();
    good(
      await fs.write({
        path: "/session/test/foo",
        type: "text",
        data: "foo contents",
      })
    );
    good(
      await fs.write({
        path: "/session/test/bar",
        type: "text",
        data: "bar contents",
      })
    );
    const readingFoo = await fs.read({ path: "/session/test/foo" });
    if (good(readingFoo)) {
      deepStrictEqual(readingFoo.data, "foo contents");
    }
    const readingBar = await fs.read({ path: "/session/test/bar" });
    if (good(readingBar)) {
      deepStrictEqual(readingBar.data, "bar contents");
    }
    good(await fs.write({ path: "/session/test/", data: null }));
    bad(await fs.read({ path: "/session/test/foo" }));
    bad(await fs.read({ path: "/session/test/bar" }));
  });

  it("does not allow writing data to dirs", async () => {
    const fs = new FileSystemImpl();
    bad(
      await fs.write({
        path: "/session/test/",
        type: "text",
        data: "hello",
      })
    );
  });

  it("cleans up /tmp/", async () => {
    const fs = new FileSystemImpl();
    good(
      await fs.write({
        path: "/tmp/foo",
        type: "text",
        data: "foo contents",
      })
    );
    good(
      await fs.write({
        path: "/run/bar",
        type: "text",
        data: "bar contents",
      })
    );
    good(
      await fs.write({
        path: "/session/baz",
        type: "text",
        data: "baz contents",
      })
    );
    fs.startModule();
    bad(await fs.read({ path: "/tmp/foo" }));
    good(await fs.read({ path: "/run/bar" }));
    good(await fs.read({ path: "/session/baz" }));
  });

  it("cleans up /run/", async () => {
    const fs = new FileSystemImpl();
    good(
      await fs.write({
        path: "/tmp/foo",
        type: "text",
        data: "foo contents",
      })
    );
    good(
      await fs.write({
        path: "/run/bar",
        type: "text",
        data: "bar contents",
      })
    );
    good(
      await fs.write({
        path: "/session/baz",
        type: "text",
        data: "baz contents",
      })
    );
    fs.startRun();
    bad(await fs.read({ path: "/tmp/foo" }));
    bad(await fs.read({ path: "/run/bar" }));
    good(await fs.read({ path: "/session/baz" }));
  });
});
