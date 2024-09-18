/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { board, input, output } from "@breadboard-ai/build";
import { fetch } from "@google-labs/core-kit";
import { urlTemplate } from "@google-labs/template-kit";

const requestUri = input({
  type: "string",
  title: "Request URI",
  default: "works/random",
});

const url = urlTemplate({
  $id: "urlTemplate",
  template: "https://api.openalex.org/{requestUri}",
  requestUri: requestUri,
});

const fetchResult = fetch({
  $id: "fetch",
  method: "GET",
  url: url.outputs.url,
});

export default board({
  title: "Open Alex API Query",
  description: "Query the Open Alex API",
  version: "0.0.1",
  inputs: { requestUri },
  outputs: { result: output(fetchResult.outputs.response)}
});