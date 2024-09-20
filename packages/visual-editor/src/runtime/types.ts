/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProjectStore } from "@breadboard-ai/project-store";
import {
  DataStore,
  GraphDescriptor,
  GraphLoader,
  GraphProvider,
  Kit,
  RunStore,
} from "@google-labs/breadboard";

export enum TabType {
  URL,
  DESCRIPTOR,
  RUN,
}

export type TabId = `${string}-${string}-${string}-${string}-${string}`;
export type TabURL = string;
export type TabName = string;
export interface Tab {
  id: TabId;
  kits: Kit[];
  name: TabName;
  graph: GraphDescriptor;
  subGraphId: string | null;
  version: number;
  readOnly: boolean;
  type: TabType;
}

export interface RuntimeConfig {
  providers: GraphProvider[];
  dataStore: DataStore;
  runStore: RunStore;
  experiments: {
    projectStores: boolean;
  };
}

export interface RuntimeConfigProjectStores {
  stores: ProjectStore[];
  loader: GraphLoader;
}
