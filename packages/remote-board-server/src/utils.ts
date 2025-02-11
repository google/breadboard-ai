/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConnectionArgs } from "./types";

export { createRequest };

const CONTENT_TYPE = { "Content-Type": "application/json" };

function authHeader(token: string, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Authorization", `Bearer ${token}`);
  return h;
}

function createRequest(
  url: URL | string,
  args: ConnectionArgs | null,
  method: string,
  body?: unknown
): Request {
  if (typeof url === "string") {
    url = new URL(url, window.location.href);
  } else {
    url = new URL(url);
  }
  if (args) {
    if ("key" in args) {
      if (args.key) {
        url.searchParams.set("API_KEY", args.key);
      }
      return new Request(url.href, {
        method,
        credentials: "include",
        body: JSON.stringify(body),
      });
    } else if ("token" in args) {
      let headers;
      if (args.token) {
        headers = authHeader(args.token, CONTENT_TYPE);
      }
      return new Request(url, {
        method,
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });
    }
  }
  return new Request(url.href, {
    method,
    credentials: "include",
    body: JSON.stringify(body),
  });
}
