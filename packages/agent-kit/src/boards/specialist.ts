/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  annotate,
  anyOf,
  array,
  board,
  enumeration,
  input,
  inputNode,
  object,
  output,
  outputNode,
  starInputs,
  string,
  Value,
} from "@breadboard-ai/build";
import { code, coreKit } from "@google-labs/core-kit";
import geminiKit from "@google-labs/gemini-kit";
import {
  addUserParts,
  checkAreWeDoneFunction,
  combineContextsFunction,
  contextType,
  functionCallType,
  type LlmContent,
  llmContentType,
  looperProgressType,
  looperTaskAdderFn,
  readProgress as readProgressFn,
  splitStartAdderFunction,
} from "../context.js";
import {
  boardInvocationArgsType,
  boardInvocationAssemblerFunction,
  functionDeclarationsFormatterFn,
  functionOrTextRouterFunction,
  type FunctionSignatureItem,
  responseCollatorFunction,
  type ToolResponse,
  urlMapType,
} from "../function-calling.js";
import boardToFunction from "./internal/board-to-function.js";
import invokeBoardWithArgs from "./internal/invoke-board-with-args.js";
import specialistDescriber from "./internal/specialist-describer.js";
import { GenericBoardDefinition } from "@breadboard-ai/build/internal/board/board.js";
import { substitute } from "../templating.js";

const inputs = starInputs({ type: object({}, "unknown") });

const tools = input({
  title: "Tools",
  description:
    "(Optional) Add tools to this list for the worker to use when needed",
  type: annotate(
    array(annotate(object({}, "unknown"), { behavior: ["board"] })),
    { behavior: ["config"] }
  ),
  default: [],
});

const model = input({
  title: "Model",
  description: "Choose the model to use for this specialist.",
  type: annotate(
    enumeration(
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro-latest",
      "gemini-1.5-pro-exp-0801",
      "gemini-1.5-pro-exp-0827",
      "gemini-1.5-flash-8b-exp-0827",
      "gemini-1.5-flash-exp-0827"
    ),
    {
      behavior: ["config"],
    }
  ),
  default: "gemini-1.5-flash-latest",
  examples: ["gemini-1.5-flash-latest"],
});

const substituteParams = code(
  {
    $metadata: {
      title: "Substitute Parameters",
      description: "Performing parameter substitution, if needed.",
    },
    "*": inputs,
  },
  {
    in: array(contextType),
    persona: anyOf(llmContentType, string({})),
    task: anyOf(llmContentType, string({})),
  },
  substitute
);

const addTask = code(
  {
    $metadata: {
      title: "Add Task",
      description: "Adding task to the prompt.",
    },
    context: substituteParams.outputs.in,
    toAdd: substituteParams.outputs.task,
  },
  { context: array(contextType) },
  addUserParts
);

const readProgress = code(
  {
    $metadata: { title: "Read Progress so far" },
    context: substituteParams.outputs.in,
    forkOutputs: false,
  },
  {
    progress: array(looperProgressType),
    context: array(contextType),
  },
  readProgressFn
);

const addLooperTask = code(
  {
    $metadata: {
      title: "Add Looper Task",
      description: "If there is a pending Looper task, add it.",
    },
    context: addTask.outputs.context,
    progress: readProgress.outputs.progress,
  },
  {
    context: array(contextType),
  },
  looperTaskAdderFn
);

const addSplitStart = code(
  {
    $metadata: {
      title: "Add Split Start",
      description: "Marking the start of parallel processing in the context",
    },
    context: addLooperTask.outputs.context,
  },
  {
    id: "string",
    context: array(contextType),
  },
  splitStartAdderFunction
);

const boardToFunctionWithContext = coreKit.curry({
  $metadata: {
    title: "Add Context",
    description: "Adding context to the board to function converter",
  },
  $board: boardToFunction,
  context: addSplitStart.outputs.context,
});

const turnBoardsToFunctions = coreKit.map({
  $id: "turnBoardsToFunctions",
  $metadata: {
    title: "Turn Boards into Functions",
    description: "Turning provided boards into functions",
  },
  board: boardToFunctionWithContext.outputs.board,
  list: tools,
});

const formatFunctionDeclarations = code(
  {
    $id: "formatFunctionDeclarations",
    $metadata: {
      title: "Format Function Declarations",
      description: "Formatting the function declarations",
    },
    // TODO(aomarks) Cast needed because coreKit.map doesn't know the schema of
    // the board that was passed to it (interfaces would fix this).
    list: turnBoardsToFunctions.outputs.list as Value<FunctionSignatureItem[]>,
  },
  {
    tools: array("unknown"),
    urlMap: urlMapType,
  },
  functionDeclarationsFormatterFn
);

const generator = geminiKit.text({
  $metadata: {
    title: "Gemini API Call",
    description: "Applying Gemini to do work",
  },
  systemInstruction: substituteParams.outputs.persona,
  tools: formatFunctionDeclarations.outputs.tools,
  context: addLooperTask.outputs.context,
  model,
});

const routeToFunctionsOrText = code(
  {
    $id: "router",
    $metadata: {
      title: "Router",
      description: "Routing to either function call invocation or text reply",
    },
    // TODO(aomarks) Our types and gemini's types seem not aligned.
    context: generator.outputs.context as Value<LlmContent>,
  },
  {
    context: llmContentType,
    text: "string",
    functionCalls: array(functionCallType),
  },
  functionOrTextRouterFunction
);

const assembleInvocations = code(
  {
    $id: "assembleBoardInvoke",
    $metadata: {
      title: "Assemble Tool Invoke",
      description: "Assembling tool invocation based on Gemini response",
    },
    urlMap: formatFunctionDeclarations.outputs.urlMap,
    context: routeToFunctionsOrText.outputs.context,
    functionCalls: routeToFunctionsOrText.outputs.functionCalls,
  },
  { list: array(boardInvocationArgsType) },
  boardInvocationAssemblerFunction
);

const mapInvocations = coreKit.map({
  $metadata: {
    title: "Invoke Tools in Parallel",
    description: "Invoking tools in parallel",
  },
  list: assembleInvocations.outputs.list,
  board: invokeBoardWithArgs,
});

const formatToolResponse = code(
  {
    $metadata: {
      title: "Format Tool Response",
      description: "Formatting tool response",
    },
    // TODO(aomarks) There's inconsistency between use of LlmContent and Context
    // across these nodes. Sometimes we need to cast to the other type because
    // of that.
    context: addSplitStart.outputs.context as Value<LlmContent[]>,
    response: mapInvocations.outputs.list as Value<ToolResponse[]>,
    generated: generator.outputs.context as Value<LlmContent>,
  },
  {},
  responseCollatorFunction
);

const addToolResponseToContext = code(
  {
    $metadata: {
      title: "Add Tool Response",
      description: "Adding tool response to context",
    },
    // TODO(aomarks) A nicer way to do star wiring. Also, why does the input port have
    // to be "" instead of "*" (it doesn't work with "*").
    "": formatToolResponse.unsafeOutput("*"),
  },
  {
    context: array(contextType),
  },
  combineContextsFunction
);

const toolOutput = outputNode({
  $metadata: {
    title: "Tool Output",
    description: "Return tool results as output",
  },
  out: output(addToolResponseToContext.outputs.context, {
    title: "Context out",
  }),
});

const areWeDoneChecker = code(
  {
    $metadata: {
      title: "Done Check",
      description: "Checking for the 'Done' marker",
    },
    context: addLooperTask.outputs.context,
    generated: routeToFunctionsOrText.outputs.context,
    text: routeToFunctionsOrText.outputs.text,
  },
  {
    context: array(contextType),
  },
  checkAreWeDoneFunction
);

const mainOutput = outputNode({
  out: output(areWeDoneChecker.outputs.context, { title: "Context out" }),
});

export default board({
  title: "Specialist",
  metadata: {
    icon: "smart-toy",
    help: {
      url: "https://breadboard-ai.github.io/breadboard/docs/kits/agents/#specialist",
    },
  },
  version: "2.0.0",
  description:
    "Given instructions on how to act, makes a single LLM call, optionally invoking tools.",
  inputs: [
    inputNode({
      "*": inputs,
    }),
    inputNode(
      { tools },
      {
        title: "Tools Input",
        description: "Specify the tools to use",
      }
    ),
    inputNode(
      { model },
      {
        title: "Model Input",
        description: "Ask which model to use",
      }
    ),
  ],
  outputs: [toolOutput, mainOutput],
  describer: specialistDescriber as GenericBoardDefinition,
});
