/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GraphDescriptor } from "@google-labs/breadboard";

/**
 * A Breadboard Manifest.
 *
 * Contains references to boards and other manifests.
 *
 * @examples [
 *   {
 *     "title": "Empty Manifest"
 *   },
 *   {
 *     "title": "Manifest with empty lists",
 *     "boards": [],
 *     "manifests": []
 *   },
 *   {
 *     "boards": [
 *       {
 *         "title": "My First Board",
 *         "url": "https://gist.githubusercontent.com/user/SOME_ID/raw/board.bgl.json",
 *         "version": "1.0.0"
 *       },
 *       {
 *         "title": "My Second Board",
 *         "url": "./boards/board.bgl.json"
 *       }
 *     ],
 *     "manifests": [
 *       {
 *         "title": "Gist Manifest",
 *         "url": "https://gist.githubusercontent.com/user/SOME_ID/raw/manifest.bbm.json"
 *       }
 *     ]
 *   },
 *   {
 *     "title": "Manifest with concrete boards",
 *     "boards": [
 *       {
 *         "title": "My First Board",
 *         "nodes": [],
 *         "edges": []
 *       }
 *     ]
 *   }
 * ]
 */
export interface BreadboardManifest extends Resource {
  $schema?: Reference;
  boards?: BoardReference[];
  manifests?: ManifestReference[];
  reference?: Reference;
  title?: Title;
  tags?: Tags;
}

export class BreadboardManifestBuilder implements BreadboardManifest {
  readonly $schema?: Reference;
  boards?: BoardReference[];
  readonly reference?: Reference;
  manifests?: ManifestReference[];
  title?: Title;
  tags?: Tags;

  constructor(manifest: BreadboardManifest = {}) {
    this.$schema = manifest.$schema;
    this.boards = manifest.boards;
    this.manifests = manifest.manifests;
    this.reference = manifest.reference;
    this.title = manifest.title;
    this.tags = manifest.tags;
  }

  addBoard(board: BoardReference): void {
    if (!this.boards) {
      this.boards = [];
    }
    this.boards.push(board);
  }

  addboards(boards: BoardReference[]): void {
    boards.forEach(this.addBoard);
  }

  addManifest(manifest: ManifestReference): void {
    if (!this.manifests) {
      this.manifests = [];
    }
    this.manifests.push(manifest);
  }

  addManifests(manifests: ManifestReference[]): void {
    manifests.forEach(this.addManifest);
  }
}

export { isReference } from "./isReference";

/**
 * A URI reference.
 *
 * @format uri-reference
 *
 * @examples [
 * "https://example.com/board.bgl.json",
 * "https://example.com/manifest.bbm.json",
 * "https://example.com/manifests/manifest.bbm.json",
 * "file:///path/to/board.bgl.json",
 * "file:///path/to/manifest.bbm.json"
 * ]
 */
export type UriReference = string;

/**
 * A reference to a resource relative to the Uri of the parent resource.
 *
 * @pattern ^(\.\/|\.\.\/|[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$
 *
 * @examples [
 * "board.bgl.json",
 * "manifest.bbm.json",
 * "../boards/board.bgl.json",
 * "../manifests/manifest.bbm.json",
 * "./board.bgl.json",
 * "./manifest.bbm.json"
 * ]
 */
export type RelativeReference = string;

/**
 * A reference to a resource.
 */
export type Reference = UriReference | RelativeReference;

/**
 * A resource that definitely has a reference.
 *
 * Also has a title.
 */
export interface ResourceReference extends Resource, Partial<GraphDescriptor> {
  readonly reference: Reference;
  readonly title?: Title;
  readonly tags?: Tags;
}

/**
 * A referenceable resource.
 */
export interface Resource {
  reference?: Reference;
}

/**
 * Allow additional properties.
 */
export type AdditionalProperties = {
  [x: string | number | symbol]: unknown;
};

/**
 * A Resource that allows additional properties.
 */
export interface ResourceWithAdditionalProperties
  extends Resource,
    AdditionalProperties {}

/**
 * A reference to the BGL schema GraphDescriptor type.
 */
export type Board = GraphDescriptor;

/**
 * Union of {@link ResourceReference} and {@link Board}
 */
export type BoardReference = ResourceReference | Board;

/**
 * Union of {@link ResourceReference} and {@link BreadboardManifest}
 */
export type ManifestReference = ResourceReference | BreadboardManifest;

/**
 *
 *
 * @examples [
 * "My First Board",
 * "Gist Manifest"
 * ]
 */
export type Title = string;

/**
 * The tags for this board
 */
export type Tags = string[];
