import { base, recipe, code } from "@google-labs/breadboard";
import { core } from "@google-labs/core-kit";

const metaData = {
  title: "Create a board from an Open API spec",
  description: "Converts an Open API spec to a board.",
  version: "0.0.3",
};

export default await recipe(() => {
  const input = base.input({ $id: "input" });

  const getBoard = code(({ api }) => {
    return { graph: api.board };
  });

  const apiBoard = input.to(
    core.invoke({ path: "../index.json", url: input.url })
  );

  return core
    .invoke()
    .in({ graph: getBoard({ api: apiBoard.listAPIs }), url: input.url });
}).serialize(metaData);
