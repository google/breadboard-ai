/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from "fs";
import {
  ABSOLUTE_PACKAGE_JSON_PATH,
  GITHUB_OWNER,
  GITHUB_REPO,
  PACKAGE_NAME,
  REPO_PACKAGE_PATH,
  SCHEMA_FILE_NAME,
} from "./constants";

/**
 *
 * @param mode "head" | "tag" - "head" for the main branch, "tag" for the tag associated with the current package version
 * @returns The schema ID for the Breadboard Manifest schema.
 */
export function generateSchemaId({
  owner = GITHUB_OWNER,
  repo = GITHUB_REPO,
  ref = "main",
  schemaPath = `${REPO_PACKAGE_PATH}/${SCHEMA_FILE_NAME}`,
}: {
  owner?: string;
  repo?: string;
  ref?: "main" | string
  schemaPath?: string;
} = {}): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${schemaPath}`;
}

export function getTagRef(): string {
  const packageVersion = loadPackageJson().version;
  if (!packageVersion) {
    throw new Error("Package version not found in package.json");
  }
  return `${PACKAGE_NAME}@${packageVersion}`;
}

function loadPackageJson() {
  return JSON.parse(fs.readFileSync(ABSOLUTE_PACKAGE_JSON_PATH, "utf-8"));
}
