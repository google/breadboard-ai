import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  external: ["@google-cloud", "import.meta", "vite", "better-sqlite3"],
  format: "esm",
  outfile: "dist/src/server/main.js",
  sourcemap: true,
});
