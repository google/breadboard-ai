/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rollup } from "rollup";
import virtualDefault from "@rollup/plugin-virtual";
import nodeResolveDefault from "@rollup/plugin-node-resolve";
import commonjsDefault from "@rollup/plugin-commonjs";

import jsonDefault from "@rollup/plugin-json";

export type KitData = {
  file: string;
  code: string;
};

const virtual = virtualDefault as unknown as typeof virtualDefault.default;
const nodeResolve =
  nodeResolveDefault as unknown as typeof nodeResolveDefault.default;
const json = jsonDefault as unknown as typeof jsonDefault.default;
const commonjs = commonjsDefault as unknown as typeof commonjsDefault.default;

/*
  This function compiles and bundles known 'node_module' into a single string.

  If the compilation fails, it will throw an error and halt the entire application.
*/
export const compile = async (file: string) => {
  console.log(`Compiling ${file}`);
  const bundle = await rollup({
    input: "entry",
    // Hide our sins like circular dependencies.
    logLevel: "silent",
    plugins: [
      virtual({
        entry: `import * as kit from "${file}"; export default kit.default;`,
      }),
      json(),
      commonjs(),
      nodeResolve(),
    ],
  });

  const { output } = await bundle.generate({ format: "es" });

  return output[0].code;
};

export const getKits = async (
  kitNames: string[]
): Promise<Record<string, KitData>> => {
  const kits: Record<string, KitData> = {};

  for (const kit of kitNames) {
    kits[kit] = {
      file: kit,
      code: await compile(kit),
    };
  }

  return kits;
};
