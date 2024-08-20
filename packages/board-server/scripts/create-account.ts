/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getStore } from "../src/server/store"

if (process.argv.length !== 3) {
  console.error("Usage: create-account <username>");
  process.exit(1);
}

const username = process.argv[2];

const createAPIKey = async () => {
  const uuid = crypto.randomUUID();
  const data = new TextEncoder().encode(uuid);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(digest));
  const hashHex = hashArray.map((b) => b.toString(36)).join("");
  return `bb-${hashHex.slice(0, 50)}`;
};

const store = getStore()

const key = await createAPIKey();

await store!.createUser(username, key)

console.log(`Created account for ${username} with API key:\n${key}`);
