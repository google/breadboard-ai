/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Encodes a text string as a valid component of a Uniform Resource Identifier (URI).
 * @param uriComponent A value representing an unencoded URI component.
 */
declare function encodeURIComponent(
  uriComponent: string | number | boolean
): string;

interface Console {
  log(...data: any[]);
  error(...data: any[]);
  warn(...data: any[]);
}

declare var console: Console;

declare module "@fetch" {
  export type FetchInputs = {
    $metadata?: {
      title?: string;
      description?: string;
    };
    /**
     * The URL to fetch
     */
    url: string;
    /**
     * The HTTP method to use. "GET is default.
     */
    method?: "GET" | "POST" | "PUT" | "DELETE";
    /**
     * Headers to send with request
     */
    headers?: Record<string, string>;
    /**
     * The body of the request
     */
    body?: unknown;
  };

  export type FetchOutputs = {
    /**
     * The error object.
     */
    $error?: unknown;
    /**
     * The response from the fetch request
     */
    response: unknown;
    /**
     * The HTTP status code of the response
     */
    status: number;
    /**
     * The status text of the response
     */
    statusText: string;
    /**
     * The content type of the response
     */
    contentType: string;
    /**
     * The headers of the response
     */
    responseHeaders: Record<string, string>;
  };

  /**
   * A built-in capability of Breadboard to fetch data.
   */
  export default function fetch(url: FetchInputs): Promise<FetchOutputs>;
}

declare module "@secrets" {
  /**
   * A built-in capability of Breadboard to obtain secrets.
   */
  export default function secrets<S extends string>(inputs: {
    $metadata?: {
      title?: string;
      description?: string;
    };
    keys: S[];
  }): Promise<{ [K in S]: string }>;
}

declare module "@invoke" {
  export type InvokeInputs = {
    $metadata?: {
      title?: string;
      description?: string;
    };
    $board: string;
  } & Record<string, unknown>;

  export type InvokeOutputs = Record<string, unknown> & {
    $error?: unknown;
  };

  /**
   * A built-in capability of Breadboard to invoke boards.
   */
  export default function invoke(inputs: InvokeInputs): Promise<InvokeOutputs>;
}

declare type FunctionCallCapabilityPart = {
  functionCall: {
    name: string;
    args: object;
  };
};

declare type FunctionResponseCapabilityPart = {
  functionResponse: {
    name: string;
    response: object;
  };
};

declare type TextCapabilityPart = {
  text: string;
};

declare type DataStoreHandle = string;

/**
 * Represents data that is stored by a DataStoreProvider.
 */
declare type StoredDataCapabilityPart = {
  storedData: {
    handle: DataStoreHandle;
    mimeType: string;
  };
};

declare type DataPart =
  | InlineDataCapabilityPart
  | StoredDataCapabilityPart
  | FunctionCallCapabilityPart
  | FunctionResponseCapabilityPart
  | TextCapabilityPart;

declare type LLMContent = {
  role?: string;
  parts: DataPart[];
};

/**
 * Represents inline data, encoded as a base64 string.
 */
declare type InlineDataCapabilityPart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};
