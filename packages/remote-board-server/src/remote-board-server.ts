/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  blank,
  NodeIdentifier,
  type BoardServer,
  type BoardServerCapabilities,
  type BoardServerConfiguration,
  type BoardServerExtension,
  type BoardServerProject,
  type ChangeNotificationCallback,
  type GraphDescriptor,
  type GraphProviderCapabilities,
  type GraphProviderExtendedCapabilities,
  type GraphProviderItem,
  type GraphProviderStore,
  type Kit,
  type Permission,
  type User,
} from "@google-labs/breadboard";

/**
 * For now, make a flag that controls whether to use simple requests or not.
 * Simple requests use "API_KEY" query parameter for authentication.
 */
const USE_SIMPLE_REQUESTS = true;
const CONTENT_TYPE = { "Content-Type": "application/json" };

const authHeader = (apiKey: string, headers?: HeadersInit) => {
  const h = new Headers(headers);
  h.set("Authorization", `Bearer ${apiKey}`);
  return h;
};

const createRequest = (
  url: URL | string,
  apiKey: string | null,
  method: string,
  body?: unknown
) => {
  if (typeof url === "string") {
    url = new URL(url, window.location.href);
  } else {
    url = new URL(url);
  }
  if (USE_SIMPLE_REQUESTS) {
    if (apiKey) {
      url.searchParams.set("API_KEY", apiKey);
    }
    return new Request(url.href, {
      method,
      credentials: "include",
      body: JSON.stringify(body),
    });
  }

  return new Request(url, {
    method,
    credentials: "include",
    headers: apiKey ? authHeader(apiKey, CONTENT_TYPE) : CONTENT_TYPE,
    body: JSON.stringify(body),
  });
};

export class RemoteBoardServer extends EventTarget implements BoardServer {
  public readonly url: URL;
  public readonly users: User[];
  public readonly secrets = new Map<string, string>();
  public readonly extensions: BoardServerExtension[] = [];
  public readonly capabilities: BoardServerCapabilities;

  projects: Promise<BoardServerProject[]>;
  kits: Kit[];

  static readonly PROTOCOL = "https://";
  static readonly LOCALHOST = "http://localhost";

  static async connect(url: string, apiKey?: string) {
    if (url.endsWith("/")) {
      url = url.replace(/\/$/, "");
    }

    const userRequest = createRequest(`${url}/me`, apiKey ?? null, "GET");
    const infoRequest = createRequest(`${url}/info`, null, "GET");

    try {
      const [infoRes, userRes] = await Promise.all([
        fetch(infoRequest),
        fetch(userRequest),
      ]);

      const [info, user] = await Promise.all([infoRes.json(), userRes.json()]);
      return { title: info.title, username: user.username };
    } catch (err) {
      console.warn(err);
      return false;
    }
  }

  static async from(url: string, title: string, user: User) {
    // Add a slash at the end of the URL string, because all URL future
    // construction will depend on it.
    const endsWithSlash = url.endsWith("/");
    if (!endsWithSlash) url = `${url}/`;
    try {
      const configuration = {
        url: new URL(url),
        projects: Promise.resolve([]),
        kits: [],
        users: [],
        secrets: new Map(),
        extensions: [],
        capabilities: {
          connect: true,
          disconnect: true,
          refresh: true,
          watch: false,
          preview: true,
        },
      };

      return new RemoteBoardServer(title, configuration, user);
    } catch (err) {
      console.warn(err);
      return null;
    }
  }

  constructor(
    public readonly name: string,
    public readonly configuration: BoardServerConfiguration,
    public readonly user: User
  ) {
    super();

    this.url = configuration.url;
    this.projects = this.#refreshProjects();
    this.kits = configuration.kits;
    this.users = configuration.users;
    this.secrets = configuration.secrets;
    this.extensions = configuration.extensions;
    this.capabilities = configuration.capabilities;
  }

  // This is a workaround for items() being sync. Since we expect ready() to be
  // awaited we know #projects will be populated by the time items() is called.
  #projects: BoardServerProject[] = [];
  async ready(): Promise<void> {
    this.#projects = await this.projects;
  }

  async getAccess(url: URL, user: User): Promise<Permission> {
    const project = this.#projects.find((project) => {
      return url.pathname.startsWith(project.url.pathname);
    });

    const defaultPermission = {
      create: false,
      retrieve: false,
      update: false,
      delete: false,
    };

    if (!project) {
      return defaultPermission;
    }

    return project.metadata.access.get(user.username) ?? defaultPermission;
  }

  isSupported(): boolean {
    return true;
  }

  canProvide(url: URL): false | GraphProviderCapabilities {
    if (!url.href.startsWith(this.url.href)) {
      return false;
    }

    const project = this.#projects.find((project) => {
      return url.pathname.startsWith(project.url.pathname);
    });

    // We recognize it as something that can be loaded from this Board Server,
    // but we can't assess the access for it, so assume loading alone is
    // acceptable.
    if (!project) {
      return {
        load: true,
        save: false,
        delete: false,
      };
    }

    const access = project.metadata.access.get(this.user.username) ?? {
      create: false,
      retrieve: true,
      update: false,
      delete: false,
    };

    return {
      load: true,
      save: access.update,
      delete: access.delete,
    };
  }

  extendedCapabilities(): GraphProviderExtendedCapabilities {
    return {
      modify: true,
      connect: true,
      disconnect: true,
      refresh: true,
      watch: false,
      preview: true,
    };
  }

  async load(url: URL): Promise<GraphDescriptor | null> {
    const projects = await this.projects;
    const project = projects.find((project) => {
      return url.pathname.startsWith(project.url.pathname);
    });
    if (!project) {
      return null;
    }

    if (project.url.href === url.href) {
      const request = createRequest(url, this.user.apiKey, "GET");
      const response = await fetch(request);
      const graph = await response.json();
      return graph;
    }

    return null;
  }

  async save(
    url: URL,
    descriptor: GraphDescriptor
  ): Promise<{ result: boolean; error?: string }> {
    if (!this.canProvide(url)) {
      return { result: false };
    }

    const data = await this.#sendToRemote(new URL(url), descriptor);
    if (data.error) {
      return { result: false, error: data.error };
    }

    this.projects = this.#refreshProjects();
    return { result: true };
  }

  createBlank(url: URL): Promise<{ result: boolean; error?: string }> {
    return this.save(url, blank());
  }

  async create(
    url: URL,
    descriptor: GraphDescriptor
  ): Promise<{ result: boolean; error?: string }> {
    return this.save(url, descriptor);
  }

  async delete(url: URL): Promise<{ result: boolean; error?: string }> {
    if (!this.canProvide(url)) {
      return { result: false };
    }

    try {
      const request = createRequest(url, this.user.apiKey, "POST", {
        delete: true,
      });
      const response = await fetch(request);
      const data = await response.json();
      this.projects = this.#refreshProjects();

      if (data.error) {
        return { result: false };
      }
      return { result: true };
    } catch (err) {
      return { result: true };
    }
  }

  connect(_location?: string, _auth?: unknown): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  disconnect(_location: string): Promise<boolean> {
    throw new Error("Method not implemented.");
  }

  async refresh(_location: string): Promise<boolean> {
    await this.projects;
    return true;
  }

  async createURL(location: string, fileName: string): Promise<string | null> {
    // Ensure we don't have a trailing slash on the location so that the URLs
    // we create below work out.
    location = location.replace(/\/$/, "");

    const request = createRequest(
      `${location}/boards`,
      this.user.apiKey,
      "POST",
      {
        name: fileName,
      }
    );
    const response = await fetch(request);
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return `${location}/boards/${data.path}`;
  }

  parseURL(_url: URL): { location: string; fileName: string } {
    throw new Error("Method not implemented.");
  }

  async restore(): Promise<void> {
    await this.projects;
  }

  items(): Map<string, GraphProviderStore> {
    const items = new Map<string, GraphProviderStore>();
    const projects: [string, GraphProviderItem][] = [];

    const projectNames = new Set<string>();
    for (const project of this.#projects) {
      let title = project.metadata.title ?? "Untitled Board";
      if (projectNames.has(title) && project.url) {
        const suffix = new URL(project.url).pathname.split("/").at(-1);
        title = `${project.metadata.title ?? "Untitled Board"} [${suffix}]`;
      }

      projectNames.add(title);
      projects.push([
        title,
        {
          url: project.url.href,
          mine: project.metadata.owner === this.user.username,
          version: project.board?.descriptor.version,
          description: project.metadata.description,
          readonly: false,
          handle: null,
          tags: project.metadata?.tags,
          username: project.metadata.owner,
        },
      ]);
    }

    items.set(this.url.href, {
      items: new Map(projects),
      permission: "granted",
      title: this.name,
      url: this.url.href,
    });

    return items;
  }

  startingURL(): URL | null {
    return null;
  }

  watch(_callback: ChangeNotificationCallback): void {
    throw new Error("Method not implemented.");
  }

  async preview(url: URL): Promise<URL> {
    return new URL(url.href.replace(/json$/, "app"));
  }

  async #sendToRemote(url: URL, descriptor: GraphDescriptor) {
    if (!this.user.apiKey) {
      return { error: "No API Key" };
    }
    const request = createRequest(url, this.user.apiKey, "POST", descriptor);
    try {
      const response = await fetch(request);
      return await response.json();
    } catch (e) {
      return { error: `Error updating board: ${(e as Error).message}` };
    }
  }

  async #refreshProjects(): Promise<BoardServerProject[]> {
    type BoardServerListingItem = GraphProviderItem & {
      path: string;
    };

    const projects: BoardServerProject[] = [];
    try {
      const request = this.#requestWithKey("boards", "GET");

      const response = await fetch(request);
      const files: BoardServerListingItem[] = await response.json();

      for (const item of files) {
        // Workaround for the fact that we don't yet store the username as part
        // of the Board Server configuration. Here we use the `mine` property to
        // set the username.
        if (item.mine && item.username) {
          this.user.username = item.username;
        }

        const canAccess = item.username === this.user.username;
        const access = new Map([
          [
            this.user.username,
            {
              create: canAccess,
              retrieve: canAccess,
              update: canAccess,
              delete: canAccess,
            },
          ],
        ]);

        const project: BoardServerProject = {
          url: new URL(`boards/${item.path}`, this.url),
          metadata: {
            owner: item.username ?? "Unknown",
            tags: item.tags,
            title: item.title,
            description: item.description,
            access,
          },
        };

        projects.push(project);
      }
    } catch (err) {
      console.warn(
        `[Remote Board Server]: Unable to connect to "${this.url}"`,
        err
      );
    }

    this.#refreshBoardServerKits(projects);
    return projects;
  }

  async #refreshBoardServerKits(projects: BoardServerProject[]) {
    if (!projects.length) {
      return;
    }

    const kits = new Map<string, NodeIdentifier[]>();

    for (let idx = 0; idx < projects.length; idx++) {
      const project = projects[idx];
      if (!project.url) {
        continue;
      }

      // const id = `node-${globalThis.crypto.randomUUID()}`;
      const type = project.url.href;
      const owner = project.metadata.owner;
      if (
        !project.metadata?.tags ||
        !project.metadata?.tags.includes("component")
      ) {
        continue;
      }

      let nodes: NodeIdentifier[] | undefined = kits.get(owner);
      if (!nodes) {
        nodes = [];
        kits.set(owner, nodes);
      }
      nodes.push(type);
    }

    for (const [owner, nodes] of kits.entries()) {
      const title = `@${owner}'s Components`;
      const url = new URL(`kits/@${owner}/all`, this.url).href;
      this.kits = this.kits.filter((kit) => kit.title !== title);
      this.kits.push({
        title,
        url,
        handlers: Object.fromEntries(
          nodes.map((node) => [
            node,
            () => {
              throw new Error(
                `Integrity error: "${title}" kit's node handlers should never be called`
              );
            },
          ])
        ),
      });
    }
  }

  async canProxy(url: URL): Promise<string | false> {
    if (!this.canProvide(url)) {
      return false;
    }

    return this.#withKey("proxy").href;
  }

  #withKey(path: string): URL {
    const result = new URL(path, this.url);
    result.searchParams.set("API_KEY", this.user.apiKey);
    return result;
  }

  #requestWithKey(path: string, method: string, body?: unknown): Request {
    const url = this.#withKey(path);
    const init: RequestInit = {
      method,
      credentials: "include",
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    return new Request(url.href, init);
  }
}
