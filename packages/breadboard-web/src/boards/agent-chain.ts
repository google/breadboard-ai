import { Schema, code, recipe } from "@google-labs/breadboard";
import { core } from "@google-labs/core-kit";

type ChainDescription = {
  prompt: string;
  schema: Schema;
};

type ChainSpec = ChainDescription[];

const sampleChainSpec = JSON.stringify(
  [
    {
      prompt: `Given the following specs, extract requirements for writing an ad copy:
    
    This ad is for my lawn care company that will fit into an inch of newspaper copy. It's called "Max's Lawn Care" and it should use the slogan "I care about your lawn." Emphasize the folksiness of it being a local, sole proprietorship that I started after graduating from high school.`,
      schema: {
        type: "object",
        properties: {
          requirements: {
            type: "array",
            items: {
              type: "string",
              description: "an ad requirement",
            },
          },
        },
      },
    },
    {
      prompt: `Write ad copy that conforms to the requirements above`,
      schema: {
        type: "object",
        properties: {
          ad: {
            type: "string",
            description: "the ad copy",
          },
        },
      },
    },
  ] as ChainSpec,
  null,
  2
);

export default await recipe(({ context, spec }) => {
  context.title("Context").isArray().examples("[]");
  spec
    .title("Chain spec")
    .isArray()
    .format("multiline")
    .examples(sampleChainSpec);

  const reducer = core.reduce({
    $id: "reducer",
    list: spec.isArray(),
    board: code(({ accumulator, item }) => {
      const acc = (accumulator as unknown[]) || [];
      return { accumulator: [...acc, item] };
    }),
  });

  return { context, spec, list: reducer.accumulator };
}).serialize({
  title: "Agent Chain",
  description:
    "A configurable chain of agents. Each agent passes their work to the next agent in the chain. Useful for simulating waterfall processes.",
  version: "0.0.1",
});
