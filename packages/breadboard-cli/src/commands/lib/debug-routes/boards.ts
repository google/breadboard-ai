import http from "http";
import { loadBoards } from "../utils.js";
import { ServerGlobals } from "../debug-server.js";

export async function boardList(
  _request: http.IncomingMessage,
  response: http.ServerResponse,
  _match: URLPatternResult,
  globals: ServerGlobals
) {
  const { file, options } = globals;
  const boards = await loadBoards(file, options);
  globals.boards = boards;

  const boardsData = JSON.stringify(
    boards
      .map((board) => ({
        url: board.url,
        version: board.version,
        title: board.title,
      }))
      .sort((aBoard, bBoard) => {
        const a = aBoard.title.toUpperCase();
        const b = bBoard.title.toUpperCase();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      })
  );

  response.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": boardsData.length,
  });

  return response.end(boardsData);
}

export async function boards(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  match: URLPatternResult,
  globals: ServerGlobals
) {
  const { file, options } = globals;
  const boards = await loadBoards(file, options);
  globals.boards = boards;

  const boardsData = JSON.stringify(
    boards.map((board) => ({
      url: board.url,
      version: board.version,
      title: board.title,
    }))
  );

  const responseText = `const r = ${boardsData}; export default { Boards: r };`;

  response.writeHead(200, {
    "Content-Type": "application/javascript",
    "Content-Length": responseText.length,
  });

  return response.end(responseText);
}
