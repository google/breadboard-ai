#!/usr/bin/env -S npx -y tsx --no-cache

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import path, { dirname } from "path";
import { type Config } from "ts-json-schema-generator";
import { fileURLToPath } from "url";
import { ABSOLUTE_PACKAGE_ROOT, ABSOLUTE_SCHEMA_PATH } from "./util/constants";
import { generateSchemaFile } from "./util/generate-schema-file";
import { generateSchemaId, getTagRef } from "./util/generate-schema-id";

function getLocalBglSchemaPath(): string {
  const relativePath: string = "../schema/breadboard.schema.json";
  if (!fs.existsSync(relativePath)) {
    throw new Error(`File not found: ${relativePath}`);
  }
  return relativePath;
}

function main() {
  console.log("Beginning Breadboard Manifest schema generation...");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const sourceFile = path.join(ABSOLUTE_PACKAGE_ROOT, "src", "index.ts");

  if (fs.existsSync(sourceFile)) {
    console.log(`Using file: ${sourceFile}`);
  } else {
    throw new Error(
      `File not found: ${JSON.stringify({ ABSOLUTE_PACKAGE_ROOT, origin: __filename, __dirname, filePath: sourceFile }, null, 2)}`
    );
  }

  const tsconfigPath = path.join(ABSOLUTE_PACKAGE_ROOT, "tsconfig.json");
  if (fs.existsSync(tsconfigPath)) {
    console.log(`Using tsconfig: ${tsconfigPath}`);
  } else {
    throw new Error(`File not found: ${tsconfigPath}`);
  }

  const baseConfig: Partial<Config> = {
    additionalProperties: false,
    expose: "all",
    schemaId: generateSchemaId({ owner: "tag" }),
    sortProps: true,
    topRef: true,
    jsDoc: "extended",
    type: "BreadboardManifest",
    path: sourceFile,
    tsconfig: tsconfigPath,
  };

  const modes: {
    destination: string;
    config: Partial<Config>;
    bglSchemaRef?: string;
  }[] = [
    {
      destination: ABSOLUTE_SCHEMA_PATH,
      config: {
        ...baseConfig,
        schemaId: generateSchemaId({ ref: getTagRef() }),
      },
    },
    {
      destination: path.join(ABSOLUTE_PACKAGE_ROOT, "head.bbm.schema.json"),
      config: {
        ...baseConfig,
        schemaId: generateSchemaId({ ref: "main" }),
      },
      bglSchemaRef: generateSchemaId({
        ref: "main",
        schemaPath: "schema/breadboard.schema.json",
      }),
    },
    {
      destination: path.join(ABSOLUTE_PACKAGE_ROOT, "local.bbm.schema.json"),
      config: {
        ...baseConfig,
        schemaId: "./local.bbm.schema.json",
      },
      bglSchemaRef: getLocalBglSchemaPath(),
    },
  ];

  modes.forEach(({ destination, config, bglSchemaRef }) => {
    console.log(`Generating schema for ${destination}...`);
    // Running with skipTypeCheck: true is necessary to generate the initial unchecked schema file. Otherwise, the script will fail with a type error.
    [true, false].forEach((skipTypeCheck) => {
      generateSchemaFile({
        destination,
        conf: { ...config, skipTypeCheck },
        bglSchemaRef,
      });
    })
  });
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return "[object Object]" === Object.prototype.toString.call(v);
}

main();
