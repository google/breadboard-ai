/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Asset,
  AssetMetadata,
  AssetPath,
  LLMContent,
  NodeValue,
} from "@breadboard-ai/types";
import { EditSpec, Outcome } from "@google-labs/breadboard";

export type ChatStatus = "running" | "paused" | "stopped";

export type ChatUserTurnState = {
  role: "user";
  content: ChatContent[];
};

export type ChatTextContent = {
  title: string;
  format?: "text" | "markdown";
  text: string;
};

export type ChatLLMContent = {
  title: string;
  context: LLMContent[];
};

export type ChatObjectContent = {
  title: string;
  object: NodeValue;
};

export type ChatError = {
  title: string;
  error: string;
};

export type ChatContent =
  | ChatTextContent
  | ChatLLMContent
  | ChatObjectContent
  | ChatError;

/**
 * Represents the system entry in the chat conversation between the
 * user and the system (Breadboard).
 * Typically, the role = "model", but here, we're defining it more broadly
 * so we'll name it "system."
 */
export type ChatSystemTurnState = {
  role: "system";
  /**
   * The icon representing the participant.
   */
  icon?: string;
  /**
   * The friendly name of the participant.
   */
  name?: string;
  /**
   * The content of the turn. May contain multiple messages.
   */
  content: ChatContent[];
};

export type ChatConversationState = ChatUserTurnState | ChatSystemTurnState;

export type ChatState = {
  conversation: ChatConversationState[];
  status: ChatStatus;
};

/**
 * Represents the Model+Controller for the Asset Organizer.
 */
export type Organizer = {
  /**
   * Current graph's assets.
   */
  graphAssets: Map<AssetPath, Asset>;

  addGraphAsset(path: AssetPath, asset: Asset): Promise<Outcome<void>>;
  removeGraphAsset(path: AssetPath): Promise<Outcome<void>>;
  changeGraphAssetMetadata(
    path: AssetPath,
    metadata: AssetMetadata
  ): Promise<Outcome<void>>;
};

// TODO: Make this a real object with props.
export type GeneratedAsset = string;

export type Tool = {
  url: string;
  title?: string;
  description?: string;
};

// TODO: Make this a real object with props.
export type Component = string;

/**
 * Represents the Model+Controller for the "@" Menu.
 */
export type AtMenu = {
  graphAssets: Map<AssetPath, Asset>;
  generatedAssets: GeneratedAsset[];
  tools: Map<string, Tool>;
  components: Component[];
};

/**
 * Represents the Model+Controller for the entire Project.
 * Contains all the state for the project.
 */
export type Project = {
  graphAssets: Map<AssetPath, Asset>;
  organizer: Organizer;
  atMenu: AtMenu;
};

export type ProjectInternal = Project & {
  edit(spec: EditSpec[], label: string): Promise<Outcome<void>>;
};
