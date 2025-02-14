/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { stat, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { ImportOptions } from "./commandTypes.js";
import { OpenAPIBoardBuilder } from "@breadboard-ai/import";

export const importGraph = async (url: string, options: ImportOptions) => {
  if (URL.canParse(url) == false) {
    const fileStat = await stat(path.resolve(process.cwd(), url));
    if (fileStat != undefined && fileStat.isFile()) {
      // We think it's a file.
      url = pathToFileURL(url).toString();
    } else {
      throw new Error("Invalid URL");
    }
  }

  const apiPathFilter = options.api;
  const outputPath = options.output;

  if (apiPathFilter == undefined && outputPath == undefined) {
    console.error(
      "You must specify either -a (an API) or a directory to output all of the APIs to."
    );
    return;
  }

  const builder = new OpenAPIBoardBuilder(url);

  for await (const { board, apiSpec } of builder.build()) {
    console.log(board);
    if (apiSpec.operationId != undefined && outputPath != undefined) {
      await outputBoard(board, apiSpec.operationId, outputPath);
    }
  }
};

const outputBoard = async (
  board: unknown,
  apiPath: string,
  outputPath: string
) => {
  const boardJSON = JSON.stringify(board);
  const boardName = apiPath;
  const boardPath = path.join(
    path.resolve(process.cwd(), outputPath),
    `${boardName}.json`
  );
  await writeFile(boardPath, boardJSON, { encoding: "utf-8" });
};
