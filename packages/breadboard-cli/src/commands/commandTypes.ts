import { Options } from "./lib/loader.js";

export type RunOptions = Options & {
  kit?: string[];
  input?: string;
  inputFile?: string;
  base?: string; // The optional base URL for the board
  verbose?: boolean;
};

export type DebugOptions = Options;
export type ImportOptions = Options & {
  api?: string; // API URL for import
};
export type MakeOptions = Options;
export type MermaidOptions = Options;
