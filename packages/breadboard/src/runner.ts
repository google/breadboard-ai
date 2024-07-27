/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Edge,
  NodeDescriptor,
  NodeHandlers,
  InputValues,
  GraphDescriptor,
  OutputValues,
  GraphInlineMetadata,
  SubGraphs,
  BreadboardRunner,
  BreadboardSlotSpec,
  Kit,
  BreadboardValidator,
  NodeHandlerContext,
  BreadboardCapability,
  LambdaNodeInputs,
  LambdaNodeOutputs,
  RunArguments,
  NodeValue,
} from "./types.js";

import { TraversalMachine } from "./traversal/machine.js";
import { InputStageResult, OutputStageResult, RunResult } from "./run.js";
import { callHandler, handlersFromKits } from "./handler.js";
import { toMermaid } from "./mermaid.js";
import { SchemaBuilder } from "./schema.js";
import {
  RequestedInputsManager,
  bubbleUpInputsIfNeeded,
  createOutputProvider,
  bubbleUpOutputsIfNeeded,
} from "./bubble.js";
import { asyncGen } from "./utils/async-gen.js";
import { StackManager } from "./stack.js";
import { timestamp } from "./timestamp.js";
import breadboardSchema from "@google-labs/breadboard-schema/breadboard.schema.json" with { type: "json" };
import { GraphLoader, GraphProvider } from "./loader/types.js";
import { SENTINEL_BASE_URL, createLoader } from "./loader/index.js";
import {
  isBreadboardCapability,
  isGraphDescriptorCapability,
  isResolvedURLBoardCapability,
  isUnresolvedPathBoardCapability,
  resolveBoardCapabilities,
  resolveBoardCapabilitiesInInputs,
} from "./capability.js";
import { inspect } from "./inspector/index.js";

/**
 * This class is the main entry point for running a board.
 *
 * It contains everything that is needed to run a board, either loaded from a
 * serialized board or created via the {Board} class.
 *
 * See the {Board} class for a way to build a board that can also be serialized.
 */
export class BoardRunner implements BreadboardRunner {
  // GraphDescriptor implementation.
  url?: string;
  title?: string;
  description?: string;
  $schema?: string;
  version?: string;
  edges: Edge[] = [];
  nodes: NodeDescriptor[] = [];
  kits: Kit[] = [];
  graphs?: SubGraphs;
  args?: InputValues;

  #slots: BreadboardSlotSpec = {};
  #validators: BreadboardValidator[] = [];

  /**
   *
   * @param metadata - optional metadata for the board. Use this parameter
   * to provide title, description, version, and URL for the board.
   */
  constructor(
    { url, title, description, version, $schema }: GraphInlineMetadata = {
      $schema: breadboardSchema.$id,
    }
  ) {
    Object.assign(this, {
      $schema: $schema ?? breadboardSchema.$id,
      url,
      title,
      description,
      version,
    });
  }

  /**
   * Runs the board. This method is an async generator that
   * yields the results of each stage of the run.
   *
   * Conceptually, when we ask the board to run, it will occasionally pause
   * and give us a chance to interact with it.
   *
   * It's typically used like this:
   *
   * ```js
   * for await (const stop of board.run()) {
   * // do something with `stop`
   * }
   * ```
   *
   * The `stop` iterator result will be a `RunResult` and provide ability
   * to influence running of the board.
   *
   * The two key use cases are providing input and receiving output.
   *
   * If `stop.type` is `input`, the board is waiting for input values.
   * When that is the case, use `stop.inputs` to provide input values.
   *
   * If `stop.type` is `output`, the board is providing output values.
   * When that is the case, use `stop.outputs` to receive output values.
   *
   * See [Chapter 8: Continuous runs](https://github.com/breadboard-ai/breadboard/tree/main/packages/breadboard/docs/tutorial#chapter-8-continuous-runs) of Breadboard tutorial for an example of how to use this method.
   *
   * @param probe - an optional probe. If provided, the board will dispatch
   * events to it. See [Chapter 7: Probes](https://github.com/breadboard-ai/breadboard/tree/main/packages/breadboard/docs/tutorial#chapter-7-probes) of the Breadboard tutorial for more information.
   * @param slots - an optional map of slotted graphs. See [Chapter 6: Boards with slots](https://github.com/breadboard-ai/breadboard/tree/main/packages/breadboard/docs/tutorial#chapter-6-boards-with-slots) of the Breadboard tutorial for more information.
   * @param result - an optional result of a previous run. If provided, the
   * board will resume from the state of the previous run.
   * @param kits - an optional map of kits to use when running the board.
   */
  async *run(
    args: RunArguments = {},
    result?: RunResult
  ): AsyncGenerator<RunResult> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inputs, ...context } = args;
    const base = context.base || SENTINEL_BASE_URL;
    yield* asyncGen<RunResult>(async (next) => {
      const { probe } = context;
      const handlers = await BoardRunner.handlersFromBoard(this, context.kits);
      const slots = { ...this.#slots, ...context.slots };
      this.#validators.forEach((validator) => validator.addGraph(this));

      const machine = new TraversalMachine(this, result?.state);

      const requestedInputs = new RequestedInputsManager(args);

      const invocationPath = context.invocationPath || [];

      const stack = new StackManager(context.state);

      await probe?.report?.({
        type: "graphstart",
        data: { graph: this, path: invocationPath, timestamp: timestamp() },
      });

      let invocationId = 0;
      stack.onGraphStart();
      const path = () => [...invocationPath, invocationId];

      for await (const result of machine) {
        context?.signal?.throwIfAborted();

        invocationId++;
        const { inputs, descriptor, missingInputs } = result;

        if (result.skip) {
          await probe?.report?.({
            type: "skip",
            data: {
              node: descriptor,
              inputs,
              missingInputs,
              path: path(),
              timestamp: timestamp(),
            },
          });
          continue;
        }

        stack.onNodeStart(result);

        await probe?.report?.({
          type: "nodestart",
          data: {
            node: descriptor,
            inputs,
            path: path(),
            timestamp: timestamp(),
          },
          state: await stack.state(),
        });

        let outputsPromise: Promise<OutputValues> | undefined = undefined;

        if (descriptor.type === "input") {
          await next(
            new InputStageResult(
              result,
              await stack.state(),
              invocationId,
              path()
            )
          );
          await bubbleUpInputsIfNeeded(
            this,
            context,
            descriptor,
            result,
            path()
          );
          outputsPromise = result.outputsPromise
            ? resolveBoardCapabilities(result.outputsPromise, context, this.url)
            : undefined;
        } else if (descriptor.type === "output") {
          if (
            !(await bubbleUpOutputsIfNeeded(
              inputs,
              descriptor,
              context,
              path()
            ))
          ) {
            await next(new OutputStageResult(result, invocationId, path()));
          }
          outputsPromise = result.outputsPromise;
        } else {
          const handler = handlers[descriptor.type];
          if (!handler)
            throw new Error(`No handler for node type "${descriptor.type}"`);

          const newContext: NodeHandlerContext = {
            ...context,
            descriptor,
            board: this,
            // TODO: Remove this, since it is now the same as `board`.
            outerGraph: this,
            base,
            slots,
            kits: [...(context.kits || []), ...this.kits],
            requestInput: requestedInputs.createHandler(next, result),
            provideOutput: createOutputProvider(next, result, context),
            invocationPath: path(),
            state: await stack.state(),
          };

          outputsPromise = callHandler(
            handler,
            resolveBoardCapabilitiesInInputs(inputs, context, this.url),
            newContext
          ) as Promise<OutputValues>;
        }

        stack.onNodeEnd();

        await probe?.report?.({
          type: "nodeend",
          data: {
            node: descriptor,
            inputs,
            outputs: (await outputsPromise) as OutputValues,
            validatorMetadata: this.#validators.map((validator) =>
              validator.getValidatorMetadata(descriptor)
            ),
            path: path(),
            timestamp: timestamp(),
          },
        });

        result.outputsPromise = outputsPromise;
      }

      stack.onGraphEnd();

      await probe?.report?.({
        type: "graphend",
        data: { path: invocationPath, timestamp: timestamp() },
      });
    });
  }

  get validators() {
    return this.#validators;
  }

  /**
   * A simplified version of `run` that runs the board until the board provides
   * an output, and returns that output.
   *
   * This is useful for running boards that don't have multiple outputs
   * or the the outputs are only expected to be visited once.
   */
  async runOnce(
    inputs: InputValues,
    context: NodeHandlerContext = {}
  ): Promise<OutputValues> {
    const args = {
      get ["-wires"]() {
        if (!context?.board) return {};
        const inspectableGraph = inspect(context?.board);
        const id = context?.descriptor?.id;
        if (!id) return {};
        const inspectableNode = inspectableGraph.nodeById(id);
        if (!inspectableNode) return {};
        return {
          incoming: inspectableNode.incoming().map((edge) => ({
            in: edge.in,
            out: edge.out,
            type: edge.type,
          })),
          outgoing: inspectableNode.outgoing().map((edge) => ({
            in: edge.in,
            out: edge.out,
            type: edge.type,
          })),
        } as unknown as NodeValue;
      },
      ...inputs,
      ...this.args,
    };
    const { probe } = context;

    if (context.board && context.descriptor) {
      // If called from another node in a parent board, add the parent board's
      // validators to the board, with the current arguments.
      for (const validator of (context.board as this).validators)
        this.addValidator(
          validator.getSubgraphValidator(context.descriptor, Object.keys(args))
        );
    }

    try {
      let outputs: OutputValues = {};

      const path = context.invocationPath || [];

      for await (const result of this.run(context)) {
        if (result.type === "input") {
          // Pass the inputs to the board. If there are inputs bound to the
          // board (e.g. from a lambda node that had incoming wires), they will
          // overwrite supplied inputs.
          result.inputs = args;
        } else if (result.type === "output") {
          outputs = result.outputs;
          // Exit once we receive the first output.
          await probe?.report?.({
            type: "nodeend",
            data: {
              node: result.node,
              inputs: result.inputs,
              outputs,
              path: [...path, result.invocationId],
              timestamp: timestamp(),
            },
          });
          await probe?.report?.({
            type: "graphend",
            data: { path, timestamp: timestamp() },
          });
          break;
        }
      }
      return outputs;
    } catch (e) {
      // Unwrap unhandled error (handled errors are just outputs of the board!)
      if ((e as Error).cause)
        return { $error: (e as Error).cause } as OutputValues;
      else throw e;
    }
  }

  /**
   * Add validator to the board.
   * Will call .addGraph() on the validator before executing a graph.
   *
   * @param validator - a validator to add to the board.
   */
  addValidator(validator: BreadboardValidator) {
    this.#validators.push(validator);
  }

  /**
   * Returns a [Mermaid](https://mermaid-js.github.io/mermaid/#/) representation
   * of the board.
   *
   * This is useful for visualizing the board.
   *
   * @returns - a string containing the Mermaid representation of the board.
   */
  mermaid(direction = "TD", unstyled = false, ignoreSubgraphs = false): string {
    return toMermaid(this, direction, unstyled, ignoreSubgraphs);
  }

  /**
   * Creates a new board from JSON. If you have a serialized board, you can
   * use this method to turn it into into a new Board instance.
   *
   * @param graph - the JSON representation of the board.
   * @returns - a new `Board` instance.
   */
  static async fromGraphDescriptor(
    graph: GraphDescriptor
  ): Promise<BoardRunner> {
    const breadboard = new BoardRunner(graph);
    breadboard.edges = graph.edges;
    breadboard.nodes = graph.nodes;
    breadboard.graphs = graph.graphs;
    breadboard.args = graph.args;
    return breadboard;
  }

  /**
   * Loads a board from a URL or a file path.
   *
   * @param url - the URL or a file path to the board.
   * @param slots - optional slots to provide to the board.
   * @returns - a new `Board` instance.
   * @deprecated Use `createLoader` directly within this package or use
   * `loader` from the `NodeHandlerContext`.
   */
  static async load(
    path: string,
    options: {
      base: URL;
      slotted?: BreadboardSlotSpec;
      outerGraph?: GraphDescriptor;
      graphProviders?: GraphProvider[];
    }
  ): Promise<BoardRunner> {
    const { base, slotted, outerGraph } = options || {};
    const loader = createLoader(options.graphProviders);
    const graph = await loader.load(path, { base, outerGraph });
    if (!graph) throw new Error(`Unable to load graph from "${path}"`);
    const board = await BoardRunner.fromGraphDescriptor(graph);
    board.#slots = slotted || {};
    return board;
  }

  /**
   * Creates a runnable board from a BreadboardCapability,
   * @param board {BreadboardCapability} A BreadboardCapability including a board
   * @returns {Board} A runnable board.
   */
  static async fromBreadboardCapability(
    capability: BreadboardCapability,
    loader?: GraphLoader,
    context?: NodeHandlerContext
  ): Promise<BoardRunner> {
    if (!isBreadboardCapability(capability)) {
      throw new Error(
        `Expected a "board" Capability, but got "${JSON.stringify(capability)}`
      );
    }

    // TODO: Deduplicate, replace with `getGraphDescriptor`.
    if (isGraphDescriptorCapability(capability)) {
      // If all we got is a GraphDescriptor, build a runnable board from it.
      // TODO: Use JSON schema to validate rather than this hack.
      const board = capability.board;
      const runnableBoard = board as BoardRunner;
      if (!runnableBoard.runOnce) {
        return await BoardRunner.fromGraphDescriptor(board);
      }
      return runnableBoard;
    } else if (isResolvedURLBoardCapability(capability)) {
      if (!loader || !context) {
        throw new Error(
          `The "board" Capability is a URL, but no loader and/or context was supplied.`
        );
      }
      const graph = await loader.load(capability.url, context);
      if (!graph) {
        throw new Error(
          `Unable to load "board" Capability with the URL of ${capability.url}.`
        );
      }
      return BoardRunner.fromGraphDescriptor(graph);
    } else if (isUnresolvedPathBoardCapability(capability)) {
      throw new Error(
        `Integrity error: somehow, the unresolved path "board" Capability snuck through the processing of inputs`
      );
    }
    throw new Error(
      `Unsupported type of "board" Capability. Perhaps the supplied board isn't actually a GraphDescriptor?`
    );
  }

  static async handlersFromBoard(
    board: BoardRunner,
    upstreamKits: Kit[] = []
  ): Promise<NodeHandlers> {
    const core = new Core();
    const kits = [core as Kit, ...upstreamKits, ...board.kits];

    return handlersFromKits(kits);
  }
}

// HACK: Move the Core and Lambda logic into the same file as the BoardRunner to remove the cyclic module dependency (Lambda needs BoardRunner, BoardRunner needs Core).
class Core {
  handlers: NodeHandlers;

  constructor() {
    this.handlers = {
      lambda: {
        describe: async (inputs?: InputValues) => ({
          inputSchema: new SchemaBuilder()
            .setAdditionalProperties(true)
            .addInputs(inputs)
            .addProperty("board", {
              title: "board",
              description: "The board to run.",
              type: "object",
            })
            .build(),
          outputSchema: new SchemaBuilder()
            .addProperty("board", {
              title: "board",
              description: "The now-runnable board.",
              type: "object",
            })
            .build(),
        }),
        invoke: async (inputs: InputValues): Promise<LambdaNodeOutputs> => {
          const { board, ...args } = inputs as LambdaNodeInputs;
          if (!board || board.kind !== "board" || !board.board)
            throw new Error(
              `Lambda node requires a BoardCapability as "board" input`
            );
          const runnableBoard = {
            ...(await BoardRunner.fromBreadboardCapability(board)),
            args,
          };

          return {
            board: { ...board, board: runnableBoard as GraphDescriptor },
          };
        },
      },
    };
  }
}
