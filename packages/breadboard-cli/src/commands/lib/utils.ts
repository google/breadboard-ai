/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BoardRunner, GraphDescriptor } from "@google-labs/breadboard";
import { Dirent, watch as fsWatch } from "fs";
import { opendir, readFile, stat, writeFile } from "fs/promises";
import { join } from "node:path";
import { stdin as input } from "node:process";
import * as readline from "node:readline/promises";
import path, { extname } from "path";
import { relative } from "path/posix";
import { URL, pathToFileURL } from "url";
import { Options } from "./loader.js";
import { Loaders } from "./loaders/index.js";

export type BoardMetaData = {
  title: string;
  url?: string;
  version: string;
  edges: Array<unknown>;
  nodes: Array<unknown>;
  kits: Array<unknown>;
};

export type WatchOptions = {
  onChange: (filename: string) => void;
  onRename?: (filename: string) => void;
  controller?: AbortController;
};

export const watch = (file: string, options: WatchOptions) => {
  let { controller, onChange, onRename } = options;

  onChange = onChange ?? (() => "");
  onRename =
    onRename ??
    ((filename) =>
      console.error(
        `File ${filename} has been renamed. We can't manage this yet. Sorry!`
      ));

  controller = controller ?? new AbortController();

  fsWatch(
    file,
    { signal: controller.signal, recursive: true },
    async (eventType: string, filename: string | Buffer | null) => {
      if (typeof filename != "string") return;

      if (eventType === "change") {
        onChange(filename);
      } else if (eventType === "rename") {
        if (onRename != undefined) {
          onRename(filename);
        }
      }
    }
  );
};

export const resolveFilePath = (file: string) => {
  return path.resolve(
    process.cwd(),
    path.join(path.dirname(file), path.basename(file))
  );
};

export const loadBoard = async (
  file: string,
  options: Options
): Promise<BoardRunner> => {
  const loaderType = extname(file).slice(1) as "js" | "ts" | "json";
  const save = "save" in options ? options["save"] : true;

  const loader = new Loaders(loaderType);
  const board = await loader.load(file, options);
  if (save && loaderType !== "json") {
    const pathInfo = path.parse(file);
    const boardClone = JSON.parse(JSON.stringify(board));
    const outputFilePath = path.join(options.output, `${pathInfo.name}.json`);
    delete boardClone.url; // Boards shouldn't have URLs serialized.
    const boardJson = JSON.stringify(boardClone, null, 2);
    await writeFile(outputFilePath, boardJson);
  }
  return board;
};

export const parseStdin = async (): Promise<string> => {
  let lines = "";
  const rl = readline.createInterface({ input });
  for await (const line of rl) {
    lines += line;
  }
  rl.close();
  return lines;
};

const showError = (e: unknown, path?: string) => {
  const error = e as Error;
  console.error(`Failed to load board at "${path}": ${error.message}`);
};

export const loadBoards = async (
  path: string,
  options: Options
): Promise<Array<BoardMetaData>> => {
  const fileStat = await stat(path);
  const fileUrl = pathToFileURL(path);

  if (fileStat && fileStat.isFile() && path.endsWith(".json")) {
    try {
      const data = await readFile(path, { encoding: "utf-8" });
      const board = JSON.parse(data) as GraphDescriptor; // assume conversion would fail if it wasn't a graph descriptor.

      return [
        {
          edges: board.edges ?? [],
          nodes: board.nodes ?? [],
          kits: board.kits ?? [],
          title: board.title ?? path,
          url: join("/", relative(process.cwd(), path)),
          version: board.version ?? "0.0.1",
        },
      ];
    } catch (e) {
      showError(e, path);
    }
  }

  if (
    fileStat &&
    fileStat.isFile() &&
    (path.endsWith(".js") || path.endsWith(".ts"))
  ) {
    try {
      // Compile the JS or TS.
      const board = await loadBoard(path, options);

      return [
        {
          ...board,
          title: board.title ?? path,
          url: join("/", relative(process.cwd(), path)),
          version: board.version ?? "0.0.1",
        },
      ];
    } catch (e) {
      showError(e, path);
    }
  }

  if (fileStat && fileStat.isDirectory()) {
    return await loadBoardsFromDirectory(fileUrl, path, options);
  }

  return [];
};

const getFilename = (dirent: Dirent) => {
  const { path: maybePath, name } = dirent;
  // In Node v20.5.0 and earlier, the name is included in path
  // In Node v20.6.0 and later, the name is not included in path
  return maybePath.endsWith(name) ? maybePath : join(maybePath, name);
};

async function loadBoardsFromDirectory(
  fileUrl: URL,
  path: string,
  options: Options
) {
  const dir = await opendir(fileUrl);
  const boards: Array<BoardMetaData> = [];
  for await (const dirent of dir) {
    if (dirent.isFile() && dirent.name.endsWith(".json")) {
      const filename = getFilename(dirent);
      try {
        const data = await readFile(filename, {
          encoding: "utf-8",
        });
        const board = JSON.parse(data);
        boards.push({
          ...board,
          title: board.title ?? join("/", getFilename(dirent)),
          url: join("/", getFilename(dirent)),
          version: board.version ?? "0.0.1",
        });
      } catch (e) {
        showError(e, filename);
      }
    }

    if (
      dirent.isFile() &&
      (dirent.name.endsWith(".js") || dirent.name.endsWith(".ts"))
    ) {
      const filename = getFilename(dirent);
      try {
        const board = await loadBoard(filename, options);
        boards.push({
          ...board,
          title: board.title ?? join("/", filename),
          url: join("/", filename),
          version: board.version ?? "0.0.1",
        });
      } catch (e) {
        showError(e, filename);
      }
    }

    if (dirent.isDirectory()) {
      const baseFolder = fileUrl.pathname.endsWith("/")
        ? fileUrl.pathname
        : `${fileUrl.pathname}/`;
      const boardsInDir = await loadBoardsFromDirectory(
        new URL(dirent.name, pathToFileURL(baseFolder)),
        join(path, dirent.name),
        options
      );
      boards.push(...boardsInDir);
    }
  }
  return boards;
}
