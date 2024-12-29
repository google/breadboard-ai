/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LLMContent } from "@breadboard-ai/types";
import {
  FileSystemFile,
  FileSystemPath,
  FileSystemQueryEntry,
  FileSystemReadResult,
  FileSystemWriteResult,
  Outcome,
  PersistentBackend,
} from "../types.js";
import { err, ok } from "./utils.js";

export { PersistentFile };

// TODO: Move to common
function readFromStart(
  path: FileSystemPath,
  data: LLMContent[] | undefined,
  start: number
): FileSystemReadResult {
  if (!data) {
    return err(`File at "${path}" is empty`);
  }

  if (start >= data.length) {
    return err(`Length of file is lesser than start "${start}"`);
  }
  return {
    context: data.slice(start),
    last: data.length - 1,
  };
}

function noStreams(done: boolean, receipt?: boolean): FileSystemWriteResult {
  if (done || receipt) {
    return err("Can't close the file that isn't a stream");
  }
}

class PersistentFile implements FileSystemFile {
  constructor(
    public readonly path: FileSystemPath,
    public readonly backend: PersistentBackend
  ) {}

  async read(start: number = 0): Promise<FileSystemReadResult> {
    const reading = await this.backend.read(this.path);
    if (!ok(reading)) {
      return reading;
    }
    return readFromStart(this.path, reading, start);
  }

  async append(
    data: LLMContent[],
    done: boolean,
    receipt?: boolean
  ): Promise<FileSystemWriteResult> {
    const checkForStreams = noStreams(done, receipt);
    if (!ok(checkForStreams)) {
      return checkForStreams;
    }
    return this.backend.append(this.path, data);
  }

  copy(): Outcome<FileSystemFile> {
    throw new Error("Method not implemented.");
  }

  queryEntry(path: FileSystemPath): FileSystemQueryEntry {
    throw new Error("Method not implemented.");
  }

  delete(): Promise<void> {
    throw new Error("Method not implemented.");
  }

  context: LLMContent[] = [];
}
