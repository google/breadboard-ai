/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import bglSchema from "@google-labs/breadboard-schema/breadboard.schema.json" with { type: "json" };
import fs from "fs";
import { Schema, createGenerator, type Config } from "ts-json-schema-generator";
import { sortObject } from "./sort-objects";
export function generateSchemaFile({
  destination,
  conf,
  bglSchemaRef = bglSchema.$id,
  postProcessor = (s: Schema): Schema => {
    const graphDescriptorRef = `${bglSchemaRef}#/definitions/GraphDescriptor`;

    s.definitions!["Board"] = {
      ...(s.definitions!["Board"] as Schema),
      type: "object",
      $ref: graphDescriptorRef,
      // additionalProperties: false, // left to be applied once schema package is updated
    } satisfies Schema;

    return sortObject(s);
  },
}: {
  destination: string;
  conf: Partial<Config>;
  bglSchemaRef?: string;
  postProcessor?: (s: Schema) => Schema;
}) {
  console.debug(
    "Generating schema with config:",
    JSON.stringify(conf, null, 2)
  );

  const schema: Schema = postProcessor(
    createGenerator(conf).createSchema(conf.type)
  );

  const schemaString = JSON.stringify(schema, null, "\t");
  fs.writeFileSync(destination, schemaString);

  return schema;
}
