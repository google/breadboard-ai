import Database from "better-sqlite3";
import type { CreateInviteResult, CreateUserResult, ListInviteResult, RunBoardStateStore, BoardServerStore } from "../types.js";
import type { BoardListEntry, GetUserStoreResult, OperationResult, ServerInfo } from "../store.js";
import { asInfo, asPath, EXPIRATION_TIME_MS, INVITE_EXPIRATION_TIME_MS, sanitize } from "../store.js";
import type { GraphDescriptor, ReanimationState } from "@google-labs/breadboard";
import { v4 as uuidv4 } from 'uuid';

export class SQLiteStorageProvider implements RunBoardStateStore, BoardServerStore {
    private db: Database.Database;
  
    constructor(dbPath: string) {
      this.db = new Database(dbPath);
    }
  
    async saveReanimationState(user: string, state: ReanimationState): Promise<string> {
      const timestamp = Date.now();
      const expireAt = timestamp + EXPIRATION_TIME_MS;
      const id = uuidv4(); // Generate a UUID
  
      const stmt = this.db.prepare(`
        INSERT INTO reanimation_states (id, user, state, timestamp, expire_at)
        VALUES (?, ?, ?, ?, ?)
      `);
  
      stmt.run(id, user, JSON.stringify(state), timestamp, expireAt);
  
      return id;
    }
  
    async loadReanimationState(user: string, ticket: string): Promise<ReanimationState | undefined> {
      const stmt = this.db.prepare(`
        SELECT state FROM reanimation_states
        WHERE user = ? AND id = ? AND expire_at > ?
      `);
  
      const row: any = stmt.get(user, ticket, Date.now());
      if (!row) {
        return undefined;
      }
  
      const state = JSON.parse(row.state);
      if (!state.states) {
        return undefined;
      }
  
      return state;
    }
  
    async getServerInfo(): Promise<ServerInfo | undefined> {
      const stmt = this.db.prepare(`
        SELECT value FROM configuration
        WHERE key = ?
      `);
  
      const row: any = stmt.get('metadata');
      if (!row) {
        return undefined;
      }
  
      try {
        return JSON.parse(row.value);
      } catch (error) {
        console.error('Error parsing server info:', error);
        return undefined;
      }
    }
  
    async getUserStore(userKey: string | null): Promise<GetUserStoreResult> {
      if (!userKey) {
        return { success: false, error: "No user key supplied" };
      }
      const stmt = this.db.prepare(`
        SELECT id FROM users
        WHERE api_key = ?
      `);
      const row: any = stmt.get(userKey);
      if (!row) {
        return { success: false, error: "User not found" };
      }
      return { success: true, store: row.id };
    }
  
    async list(userKey: string | null): Promise<BoardListEntry[]> {
      const userStoreResult = await this.getUserStore(userKey);
      const userStore = userStoreResult.success ? userStoreResult.store : null;
  
      const allStoresStmt = this.db.prepare(`
        SELECT id FROM workspaces
      `);
      const allStores: any[] = allStoresStmt.all();
  
      const boards: BoardListEntry[] = [];
      for (const store of allStores) {
        const docsStmt = this.db.prepare(`
          SELECT board_id, title, tags FROM boards
          WHERE workspace_id = ?
        `);
        const docs: any[] = docsStmt.all(store.id);
  
        for (const doc of docs) {
          const path = `${store.id}/${doc.board_id}`;
          const title = doc.title || path;
          const tags = doc.tags as string[] || [];
          const published = tags.includes("published");
          const readonly = userStore !== store.id;
          const mine = userStore === store.id;
          const username = store.id;
          if (!published && !mine) {
            continue;
          }
          boards.push({ title, path, username, readonly, mine, tags });
        }
      }
      return boards;
    }
  
    async get(userStore: string, boardName: string): Promise<string> {
      // Prepare and execute the SQL query to get the board details
      const stmt = this.db.prepare(`
        SELECT graph FROM boards
        WHERE workspace_id = ? AND board_id = ?
      `);
      const row: any = stmt.get(userStore, boardName);
  
      // Return the 'graph' column data if it exists, or undefined if not found
      return row.graph;
    }
  
    async update(
      userStore: string,
      path: string,
      graph: GraphDescriptor
    ): Promise<OperationResult> {
      const { userStore: pathUserStore, boardName } = asInfo(path);
      if (pathUserStore !== userStore) {
        return { success: false, error: "Unauthorized" };
      }
  
      const { title: maybeTitle, metadata } = graph;
      const tags = metadata?.tags || [];
      const title = maybeTitle || boardName;
  
      // Convert tags array to a comma-separated string for storage
      const tagsString = tags.join(',');
  
      try {
        const stmt = this.db.prepare(`
          INSERT INTO boards (workspace_id, board_id, title, tags, graph)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, board_id)
          DO UPDATE SET title = excluded.title, tags = excluded.tags, graph = excluded.graph
        `);
        stmt.run(userStore, boardName, title, tagsString, JSON.stringify(graph));
  
        return { success: true };
      } catch (error) {
        console.error('Error updating board:', error);
        return { success: false, error: 'Update failed' };
      }
    }
  
    async create(userKey: string, name: string, dryRun = false): Promise<{success: boolean, path: string | undefined, error: string | undefined}> {
      const userStoreResult = await this.getUserStore(userKey);
      if (!userStoreResult.success) {
        return { success: false, path: undefined, error: userStoreResult.error };
      }
      const userStore = userStoreResult.store!;
  
      // The format for finding the unique name is {name}-copy[-number].
      let proposal = sanitize(name);
      let copyNumber = 0;
  
      // Check for existing board names
      while (true) {
        const stmt = this.db.prepare("SELECT 1 FROM boards WHERE workspace_id = ? AND board_id = ?");
        const exists = stmt.get(userStore, proposal);
  
        if (!exists) {
          break;
        }
  
        if (copyNumber === 0) {
          proposal = `${proposal}-copy`;
        } else if (copyNumber === 1) {
          proposal = `${proposal}-${copyNumber + 1}`;
        } else {
          proposal = proposal.slice(0, -2); // Remove last "-number"
          proposal = `${proposal}-${copyNumber + 1}`;
        }
  
        copyNumber++;
      }
  
      if (!dryRun) {
        // Create a blank board with the proposed name
        const stmt = this.db.prepare(`
          INSERT INTO boards (workspace_id, board_id, title, tags, graph)
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(userStore, proposal, proposal, '', JSON.stringify({})); // Empty title, tags, and graph
      }
  
      const path = asPath(userStore, `${proposal}.bgl.json`);
      return { success: true, path, error: undefined };
    }
  
    async delete(userStore: string, path: string): Promise<{ success: boolean; error?: string }> {
      const { userStore: pathUserStore, boardName } = asInfo(path);
  
      // Check authorization
      if (pathUserStore !== userStore) {
        return { success: false, error: "Unauthorized" };
      }
  
      // Delete the board
      const stmt = this.db.prepare(`
        DELETE FROM boards
        WHERE workspace_id = ? AND board_id = ?
      `);
      const result = stmt.run(userStore, boardName);
  
      // Check if the deletion was successful
      if (result.changes > 0) {
        return { success: true };
      } else {
        return { success: false, error: "Board not found" };
      }
    }
  
    async findInvite(
      userStore: string,
      boardName: string,
      invite: string
    ): Promise<{ success: boolean; error?: string }> {
      // Prepare and execute SQL query
      const stmt = this.db.prepare(`
        SELECT 1
        FROM invites
        WHERE workspace_id = ? AND board_id = ? AND invite = ?
      `);
      const row: any = stmt.get(userStore, boardName, invite);
  
      // Check if invite exists
      if (row) {
        return { success: true };
      } else {
        return { success: false, error: "Board or invite not found" };
      }
    }
  
    async createInvite(
      userStore: string,
      path: string
    ): Promise<CreateInviteResult> {
      const { userStore: pathUserStore, boardName } = asInfo(path);
      if (pathUserStore !== userStore) {
        return {
          success: false,
          error: "This user can't create invite for this board.",
        };
      }
  
      const invite = Math.random().toString(36).slice(2, 10);
      const expireAt = Date.now() + INVITE_EXPIRATION_TIME_MS;
  
      // Check if invite already exists
      const existingInvite = await this.findInvite(userStore, boardName!, invite)
  
      if (existingInvite.success) {
        return { success: false, error: "Invite already exists." };
      }
  
      // Insert new invite
      const stmt = this.db.prepare(`
        INSERT INTO invites (workspace_id, board_id, invite, expire_at)
        VALUES (?, ?, ?, ?)
      `);
      try {
        stmt.run(userStore, boardName, invite, expireAt);
        return { success: true, invite };
      } catch (error) {
        return { success: false, error: "Failed to create invite." };
      }
    }
  
    async deleteInvite(
      userStore: string,
      path: string,
      invite: string
    ): Promise<OperationResult> {
      const { userStore: pathUserStore, boardName } = asInfo(path);
      if (pathUserStore !== userStore) {
        return {
          success: false,
          error: "This user can't delete invite for this board.",
        };
      }
  
      const stmt = this.db.prepare(`
        DELETE FROM invites
        WHERE workspace_id = ? AND board_id = ? AND invite = ?
      `);
  
      try {
        const result = stmt.run(userStore, boardName, invite);
        // Check if any rows were affected
        if (result.changes === 0) {
          return { success: false, error: "Invite not found or already deleted." };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: "Failed to delete invite." };
      }
    }
  
    async listInvites(
      userStore: string,
      path: string
    ): Promise<ListInviteResult> {
      const { userStore: pathUserStore, boardName } = asInfo(path);
      if (pathUserStore !== userStore) {
        return {
          success: false,
          error: "This user can't list invites for this board.",
        };
      }
  
      const stmt = this.db.prepare(`
        SELECT invite FROM invites
        WHERE workspace_id = ? AND board_id = ?
      `);
  
      try {
        const rows: any[] = stmt.all(userStore, boardName);
        const invites = rows.map(row => row.invite);
        return { success: true, invites };
      } catch (error) {
        return { success: false, error: "Failed to list invites." };
      }
    }
  
    async createUser(username: string, apiKey: string): Promise<CreateUserResult> {
      return new Promise((resolve) => {
        try {
          // Check if the user already exists
          const checkStmt = this.db.prepare('SELECT api_key FROM users WHERE id = ?');
          const existingUser = checkStmt.get(username);
  
          if (existingUser) {
            resolve({
              success: false,
              message: `Account ${username} already exists with API key:\n${existingUser}`
            });
            return;
          }
  
          // Insert new user
          const userInsertStmt = this.db.prepare('INSERT INTO users (id, api_key) VALUES (?, ?)');
          userInsertStmt.run(username, apiKey);
  
          // Insert workspace
          const wsInsertStmt = this.db.prepare('INSERT INTO workspaces (id) VALUES (?)');
          wsInsertStmt.run(username);
  
          resolve({ success: true, apiKey });
        } catch (error: any) {
          resolve({ success: false, message: error.message });
        }
      });
    }
  }
  