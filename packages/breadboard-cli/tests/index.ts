/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Board } from "@google-labs/breadboard";
import test from "ava";
import { ExecException, exec } from "child_process";
import * as fs from "fs";
import path from "path";
import { importGraph } from "../src/commands/import.js";
import { mkdirSync } from "fs";

const packageDir = getPackageDir("@google-labs/breadboard-cli");
console.debug("packageDir", packageDir);

const dist = path.resolve(path.join(packageDir, "dist"));

const cliPathJs = path.resolve(path.join(dist, "src", "index.js"));
console.assert(fs.existsSync(cliPathJs));

type ChildProcessCallback = {
  error?: ExecException | null;
  stdout: string;
  stderr: string;
};

function getPackageDir(packageName: string) {
  let packageDir = "";
  let found = false;
  while (!found) {
    const packagePath = path.join(packageDir, "package.json");
    if (fs.existsSync(packagePath)) {
      const packageData = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
      if (packageData.name === packageName) {
        found = true;
        break;
      }
    }
    packageDir = path.resolve(path.join(packageDir, ".."));

    if (packageDir === "/") {
      throw new Error(
        "Could not find package.json for @google-labs/breadboard-cli"
      );
    }
  }
  return packageDir;
}

function execCli(args = ""): Promise<ChildProcessCallback> {
  return new Promise((resolve, reject) => {
    exec(`node "${cliPathJs}" ${args}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function makeBoard(): Board {
  const board: Board = new Board({
    title: "Echo",
    description: "Echo cho cho cho ho o",
    version: "0.0.3",
  });
  const input = board.input({
    schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          title: "Echo",
          description: "What shall I say back to you?",
        },
      },
    },
  });
  const output = board.output();
  input.wire("text", output);
  return board;
}

const testBoardData = JSON.parse(JSON.stringify(makeBoard()));

const typescriptTestBoardContent = [
  'import { Board } from "@google-labs/breadboard";',
  // it appears toString on a function ommits types
  makeBoard
    .toString()
    .replace(
      `function ${makeBoard.name}() {`,
      `function ${makeBoard.name}(): Board {`
    )
    .replace(`const board = new Board({`, `const board: Board = new Board({`),
  `const board: Board = ${makeBoard.name}();`,
  `export default board;`,
].join("\n\n");
console.debug(
  [`${"```"}typescript board.ts`, typescriptTestBoardContent, `${"```"}`].join(
    "\n"
  )
);

const jsTestBoardContent = [
  'import { Board } from "@google-labs/breadboard";',
  makeBoard.toString(),
  `const board = ${makeBoard.name}();`,
  `export default board;`,
].join("\n\n");

console.debug(
  [`${"```"}javascript board.js`, jsTestBoardContent, `${"```"}`].join("\n")
);

const tempDir = path.join(path.join(packageDir, "temp"));
const testDataDir = path.resolve(path.join(tempDir, "data"));
const originalBoardPath = path.join(testDataDir, "echo.json");

const relativeBoardPath = path.relative(process.cwd(), originalBoardPath);
const absoluteBoardPath = path.resolve(relativeBoardPath);

const filenameWithSpaces = path.resolve(
  path.join(testDataDir, "test board.json")
);

const filenameWithURLencodingSpaces = path.resolve(
  path.join(testDataDir, "test%20board.json")
);

const directoryWithSpaces = path.resolve(
  path.join(testDataDir, "test folder", "board.json")
);

const typescriptBoardPath = path.resolve(path.join(testDataDir, "ts_board.ts"));
const jsBoardPath = path.resolve(path.join(testDataDir, "js_board.js"));
const testBoardDataContent = JSON.stringify(testBoardData, null, 2);

const testFiles: {
  path: string;
  content: string;
}[] = [
  ...[
    originalBoardPath,
    filenameWithSpaces,
    filenameWithURLencodingSpaces,
    directoryWithSpaces,
  ].map((p) => {
    return {
      path: p,
      content: testBoardDataContent,
    };
  }),
  {
    path: path.resolve(typescriptBoardPath),
    content: typescriptTestBoardContent,
  },
  {
    path: path.resolve(jsBoardPath),
    content: jsTestBoardContent,
  },
];

//////////////////////////////////////////////////

test.before(() => {
  testFiles.forEach((p) => {
    console.debug(
      ["Writing", `${p.content.length} characters to`, p.path].join("\t")
    );
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
    fs.writeFileSync(p.path, p.content);
  });
});

test.after.always(() => {
  console.debug("Cleaning up test files");
  testFiles.forEach((p) => {
    console.debug();
    const filename = path.basename(p.path);
    const dirname = path.dirname(p.path);
    const filenameWithoutExtension = filename.split(".")[0];

    console.debug([`Searching for`, p.path].join("\t"));

    ["json", "ts", "js"]
      .map((ext) => [
        path.resolve(path.join(dirname, `${filenameWithoutExtension}.${ext}`)),
        path.resolve(
          path.join(packageDir, `${filenameWithoutExtension}.${ext}`)
        ),
      ])
      .flat()
      .forEach((testDirPath) => {
        if (fs.existsSync(testDirPath)) {
          console.debug(["Removing", testDirPath].join("\t"));
          fs.rmSync(testDirPath);
        }
      });
  });
  fs.rmSync(testDataDir, { recursive: true });
});

test("import can import an openapi spec from URL", async (t) => {
  const outputDir = path.join(testDataDir, "import_all_from_url")
  mkdirSync(outputDir)

  await importGraph("https://raw.githubusercontent.com/OAI/OpenAPI-Specification/3.1.0/examples/v3.0/petstore.yaml", {
    api: undefined,
    output: outputDir,
    root: "",
    save: false,
    watch: false
  })

  const routes: string[] = ["createPets.json", "listPets.json", "showPetById.json"]
    .map(f =>
      path.resolve(outputDir, f)
    )

  routes.forEach(f => {
    t.true(fs.existsSync(f))
  })
})

test("import can import an openapi spec from file", async (t) => {
  const outputDir = path.join(testDataDir, "import_all_from_file")
  mkdirSync(outputDir)

  await importGraph(`file://${path.relative(process.cwd(), "tests/data/")}/petstore.yaml`, {
    api: undefined,
    output: outputDir,
    root: "",
    save: false,
    watch: false
  })

  const routes: string[] = ["createPets.json", "listPets.json", "showPetById.json"]
    .map(f =>
      path.resolve(outputDir, f)
    )

  routes.forEach(f => {
    t.true(fs.existsSync(f))
  })
})

test("import can import a specific API from an openapi spec", async (t) => {
  const outputDir = path.join(testDataDir, "import_one")
  mkdirSync(outputDir)

  await importGraph("https://raw.githubusercontent.com/OAI/OpenAPI-Specification/3.1.0/examples/v3.0/petstore.yaml", {
    api: "createPets",
    output: outputDir,
    root: "",
    save: false,
    watch: false
  })

  const routes: string[] = ["createPets.json"]
    .map(f =>
      path.resolve(outputDir, f)
    )

  routes.forEach(f => {
    t.true(fs.existsSync(f))
  })
})

//////////////////////////////////////////////////
test("all test files exist", (t) => {
  testFiles.forEach((p) => {
    t.true(fs.existsSync(p.path));
    t.true(fs.readFileSync(p.path).length > 0);
  });
});

//////////////////////////////////////////////////
test("relative path is relative and valid", (t) => {
  console.debug("relativeBoardPath", relativeBoardPath);
  t.false(relativeBoardPath == path.resolve(relativeBoardPath));
  t.true(fs.existsSync(relativeBoardPath));
});

test("calling CLI with no parameters shows usage text", async (t) => {
  const expected = "Usage: index [options] [command]";
  try {
    await execCli();
  } catch (error: unknown) {
    const output = error as ChildProcessCallback;
    t.assert(output.stderr);
    if (output.stderr) {
      t.true(output.stderr.length > expected.length);
      t.true(output.stderr.includes(expected));
    }
  }
});

test("'mermaid' command produces mermaid diagram from relative path to board.json", async (t) => {
  const commandString = ["mermaid", `"${relativeBoardPath}"`].join(" ");
  const output = await execCli(commandString);
  t.assert(output.stdout);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

test("'mermaid' command produces mermaid diagram from absolute path to board.json", async (t) => {
  t.false(absoluteBoardPath.startsWith("tests"));
  t.true(fs.existsSync(absoluteBoardPath));

  const commandString = ["mermaid", `"${absoluteBoardPath}"`].join(" ");
  const output = await execCli(commandString);
  t.assert(output.stdout);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

//////////////////////////////////////////////////

test("filename does contain spaces", (t) => {
  t.true(path.basename(filenameWithSpaces).includes(" "));
});

test("can handle a relative file with spaces in the file name", async (t) => {
  const relativePath = path.relative(process.cwd(), filenameWithSpaces);
  t.true(relativePath.includes(" "));
  t.true(fs.existsSync(filenameWithSpaces));

  const commandString = ["mermaid", `"${relativePath}"`].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

test("can handle an absolute file with spaces in the name", async (t) => {
  const commandString = ["mermaid", `"${filenameWithSpaces}"`].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

test("can handle an absolute file with text that decodeURIComponent might resolve in the name", async (t) => {
  const commandString = ["mermaid", `"${filenameWithURLencodingSpaces}"`].join(
    " "
  );
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

//////////////////////////////////////////////////

test("directory name with spaces does contain spaces", (t) => {
  t.true(path.dirname(directoryWithSpaces).includes(" "));
});

test("board file exists in dictory with spaces in the name", (t) => {
  t.true(fs.existsSync(directoryWithSpaces));
});

test("can handle a relative path with spaces in the directory name", async (t) => {
  const relativePath = path.relative(process.cwd(), directoryWithSpaces);
  t.true(relativePath.includes(" "));
  t.true(fs.existsSync(directoryWithSpaces));

  const commandString = ["mermaid", `"${relativePath}"`].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

test("can handle an absolute path with spaces in the directory name", async (t) => {
  const commandString = ["mermaid", `"${directoryWithSpaces}"`].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
  t.true(output.stdout.includes("graph TD"));
});

//////////////////////////////////////////////////

test("can make a graph from a typescript file", async (t) => {
  const tscCommand = [
    "npx",
    "-y",
    "tsc",
    "--target ES2022",
    "--module NodeNext",
    // TODO(aomarks) There's a glob typing mismatch error.
    "--skipLibCheck",
    `--outDir "${path.dirname(typescriptBoardPath)}"`,
    `"${typescriptBoardPath}"`,
  ].join(" ");
  await new Promise((resolve, reject) => {
    exec(tscCommand, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });

  const jsPath = typescriptBoardPath.replace(".ts", ".js");
  t.true(fs.existsSync(jsPath));

  const commandString = ["make", `"${jsPath}"`, "-n"].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
});

//////////////////////////////////////////////////

test("can make a graph from a javascript file", async (t) => {
  const commandString = ["make", `"${jsBoardPath}"`, "-n"].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);
});

test("can run a json board", async (t) => {
  const inputData = {
    text: "Hi",
  };
  const commandString = [
    "run",
    `"${absoluteBoardPath}"`,
    `--input "${JSON.stringify(inputData).replaceAll('"', '\\"')}"`,
  ].join(" ");
  const output = await execCli(commandString);
  t.true(output.stdout.length > 0);

  let resultString = output.stdout;

  // remove ANSI escape codes
  // eslint-disable-next-line no-control-regex
  resultString = resultString.replace(/\u001b\[[0-9]{1,2}m/g, "");

  // replace single quotes with double quotes
  resultString = resultString
    .replace(/(\w+)(?=:)/g, '"$1"')
    .replace(/:\s*'([^']+)'/g, ': "$1"');

  t.deepEqual(JSON.parse(resultString), inputData);
});