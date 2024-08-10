/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from "http";
import type {
  GraphDescriptor,
  InputValues,
  Kit,
  NodeDescriptor,
  NodeValue,
  OutputValues,
  ReanimationState,
} from "@google-labs/breadboard";
import type path from "path";
import type {
  EndResponseMessage,
  LastNode,
} from "@google-labs/breadboard/remote";

export type GeneralRequestType = "list" | "create";

export type UserRequestType =
  | "list"
  | "create"
  | "get"
  | "update"
  | "app"
  | "api"
  | "invoke"
  | "describe"
  | "run";

export type RequestType = GeneralRequestType | UserRequestType;

export type GeneralParseResult = {
  success: true;
  type: GeneralRequestType;
};

export type BoardParseResult = {
  success: true;
  type: UserRequestType;
  board: string;
  url: string;
  user: string;
  name: string;
};

export type ParseResult =
  | GeneralParseResult
  | BoardParseResult
  | { success: false; error: string; code: number };

export type ApiHandler = <T extends ParseResult>(
  parsed: T,
  req: IncomingMessage,
  res: ServerResponse,
  body?: unknown
) => Promise<boolean>;

export type SecretInputs = {
  keys: string[];
};

export type BoardServerLoadFunction = (
  path: string
) => Promise<GraphDescriptor | null>;

export type InvokeBoardArguments = {
  url: string;
  path: string;
  loader: BoardServerLoadFunction;
  inputs: Record<string, any>;
  kitOverrides?: Kit[];
};

export type RunBoardArguments = {
  /**
   * The full URL or the requested board, like
   * `https://board.server/boards/@user/board.bgl.json`.
   */
  url: string;
  /**
   * The path to the board, like `@user/board.bgl.json`.
   */
  path: string;
  /**
   * The user who is running the board.
   */
  user: string;
  /**
   * The function that supplies the actual board given the path.
   */
  loader: BoardServerLoadFunction;
  /**
   * The state store for graph reanimation.
   */
  runStateStore: RunBoardStateStore;
  /**
   * The writer for the results of the board run.
   */
  writer: RunBoardResultWriter;
  inputs?: InputValues;
  kitOverrides?: Kit[];
  next?: string;
  diagnostics?: boolean;
};

export type RunBoardStateStore = {
  loadReanimationState(
    user: string,
    ticket: string
  ): Promise<ReanimationState | undefined>;
  saveReanimationState(user: string, state: ReanimationState): Promise<string>;
};

export type RunBoardResultWriter = WritableStreamDefaultWriter<RunBoardResult>;

export type RunBoardResultGraphStart = [
  "graphstart",
  path: number[],
  timestamp: number,
];

export type RunBoardResultGraphEnd = [
  "graphend",
  path: number[],
  timestamp: number,
];

export type RunBoardResultNodeStart = [
  "nodestart",
  path: number[],
  timestamp: number,
  node: NodeDescriptor,
];

export type RunBoardResultNodeEnd = [
  "nodeend",
  path: number[],
  timestamp: number,
  node: NodeDescriptor,
];

export type RunBoardResultSkip = [
  "skip",
  path: number[],
  timestamp: number,
  node: NodeDescriptor,
  missingInputs: string[],
];

export type RunBoardResultError = ["error", error: string];

export type RunBoardResultOutput = ["output", outputs: OutputValues];

export type RunBoardResultInput = [
  "input",
  data: {
    schema: NodeValue;
    next: string;
  },
];

export type RunBoardResultEnd = EndResponseMessage;

export type RunBoardResult =
  | RunBoardResultError
  | RunBoardResultOutput
  | RunBoardResultInput
  | RunBoardResultGraphStart
  | RunBoardResultGraphEnd
  | RunBoardResultNodeStart
  | RunBoardResultNodeEnd
  | RunBoardResultSkip
  | RunBoardResultEnd;
