-- V1__initial_schema.sql
CREATE TABLE IF NOT EXISTS reanimation_states (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  state TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  expire_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,        
  api_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS boards (
  workspace_id TEXT,
  board_id TEXT,
  title TEXT,
  tags TEXT,
  graph TEXT,
  PRIMARY KEY (workspace_id, board_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

CREATE TABLE IF NOT EXISTS invites (
  workspace_id TEXT,
  board_id TEXT,
  invite TEXT,
  expire_at INTEGER,
  PRIMARY KEY (workspace_id, board_id, invite),
  FOREIGN KEY (workspace_id, board_id) REFERENCES boards(workspace_id, board_id)
);

CREATE TABLE IF NOT EXISTS configuration (
  key TEXT PRIMARY KEY,
  value TEXT
);
