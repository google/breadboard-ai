import { base, recipe, code } from "@google-labs/breadboard";
import { core } from "@google-labs/core-kit";

const metaData = {
  title: "Query the XKCD API via an Open API Spec board",
  description: "Converts an Open API spec to a board.",
  version: "0.0.3",
};

export default await recipe(() => {
  const input = base.input({ $id: "input" });

  const getBoard = code(({ api }) => {
    return { graph: api.board };
  });

  const apiBoard = input.to(
    core.invoke({ $id: "xkcdInvoke", path: "../index.json", url: input.url })
  );

  return core
    .invoke({})
    .in({ graph: getBoard({ api: apiBoard.getInfo0json }), url: input.url });
}).serialize(metaData);
