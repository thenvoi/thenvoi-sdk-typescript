import { UnsupportedFeatureError } from "../../core/errors";
import type { PendingBootstrapRequest, SessionRoomRecord, SessionRoomStore } from "./types";

type DatabaseSync = import("node:sqlite").DatabaseSync;

interface SessionRoomRow {
  linear_session_id: string;
  linear_issue_id: string | null;
  thenvoi_room_id: string;
  status: SessionRoomRecord["status"];
  last_event_key: string | null;
  created_at: string;
  updated_at: string;
}

interface BootstrapRequestRow {
  event_key: string;
  linear_session_id: string;
  thenvoi_room_id: string;
  expected_content: string;
  message_type: string;
  metadata_json: string | null;
  created_at: string;
  expires_at: string;
  processed_at: string | null;
}

/** SQLite-backed session room store. Uses `node:sqlite` (lazily imported). */
class SqliteSessionRoomStore implements SessionRoomStore {
  private readonly dbPath: string;
  private dbPromise: Promise<DatabaseSync> | null = null;

  public constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  public async getBySessionId(sessionId: string): Promise<SessionRoomRecord | null> {
    const db = await this.getDb();
    const row = db
      .prepare(
        `
        SELECT
          linear_session_id,
          linear_issue_id,
          thenvoi_room_id,
          status,
          last_event_key,
          created_at,
          updated_at
        FROM linear_thenvoi_session_rooms
        WHERE linear_session_id = ?
        LIMIT 1
        `,
      )
      .get(sessionId) as SessionRoomRow | undefined;

    return row ? this.toRecord(row) : null;
  }

  public async getByIssueId(issueId: string): Promise<SessionRoomRecord | null> {
    const db = await this.getDb();
    const row = db
      .prepare(
        `
        SELECT
          linear_session_id,
          linear_issue_id,
          thenvoi_room_id,
          status,
          last_event_key,
          created_at,
          updated_at
        FROM linear_thenvoi_session_rooms
        WHERE linear_issue_id = ? AND status != 'canceled'
        ORDER BY updated_at DESC
        LIMIT 1
        `,
      )
      .get(issueId) as SessionRoomRow | undefined;

    return row ? this.toRecord(row) : null;
  }

  public async upsert(record: SessionRoomRecord): Promise<void> {
    const db = await this.getDb();
    db
      .prepare(
        `
        INSERT INTO linear_thenvoi_session_rooms (
          linear_session_id,
          linear_issue_id,
          thenvoi_room_id,
          status,
          last_event_key,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(linear_session_id)
        DO UPDATE SET
          linear_issue_id = excluded.linear_issue_id,
          thenvoi_room_id = excluded.thenvoi_room_id,
          status = excluded.status,
          last_event_key = excluded.last_event_key,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        record.linearSessionId,
        record.linearIssueId,
        record.thenvoiRoomId,
        record.status,
        record.lastEventKey ?? null,
        record.createdAt,
        record.updatedAt,
      );
  }

  public async markCanceled(sessionId: string): Promise<void> {
    const db = await this.getDb();
    db
      .prepare(
        `
        UPDATE linear_thenvoi_session_rooms
        SET status = 'canceled', updated_at = ?
        WHERE linear_session_id = ?
        `,
      )
      .run(new Date().toISOString(), sessionId);
  }

  public async enqueueBootstrapRequest(request: PendingBootstrapRequest): Promise<void> {
    const db = await this.getDb();
    db
      .prepare(
        `
        INSERT INTO linear_thenvoi_bootstrap_requests (
          event_key,
          linear_session_id,
          thenvoi_room_id,
          expected_content,
          message_type,
          metadata_json,
          created_at,
          expires_at,
          processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(event_key)
        DO UPDATE SET
          linear_session_id = excluded.linear_session_id,
          thenvoi_room_id = excluded.thenvoi_room_id,
          expected_content = excluded.expected_content,
          message_type = excluded.message_type,
          metadata_json = excluded.metadata_json,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          processed_at = NULL
        `,
      )
      .run(
        request.eventKey,
        request.linearSessionId,
        request.thenvoiRoomId,
        request.expectedContent,
        request.messageType,
        request.metadata ? JSON.stringify(request.metadata) : null,
        request.createdAt,
        request.expiresAt,
      );
  }

  public async listPendingBootstrapRequests(limit = 20): Promise<PendingBootstrapRequest[]> {
    const db = await this.getDb();
    const rows = db
      .prepare(
        `
        SELECT
          event_key,
          linear_session_id,
          thenvoi_room_id,
          expected_content,
          message_type,
          metadata_json,
          created_at,
          expires_at,
          processed_at
        FROM linear_thenvoi_bootstrap_requests
        WHERE processed_at IS NULL AND expires_at > ?
        ORDER BY created_at ASC
        LIMIT ?
        `,
      )
      .all(new Date().toISOString(), limit) as unknown as BootstrapRequestRow[];

    return rows.map((row) => ({
      eventKey: row.event_key,
      linearSessionId: row.linear_session_id,
      thenvoiRoomId: row.thenvoi_room_id,
      expectedContent: row.expected_content,
      messageType: row.message_type,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  public async markBootstrapRequestProcessed(eventKey: string): Promise<void> {
    const db = await this.getDb();
    db
      .prepare(
        `
        UPDATE linear_thenvoi_bootstrap_requests
        SET processed_at = ?
        WHERE event_key = ?
        `,
      )
      .run(new Date().toISOString(), eventKey);
  }

  public async close(): Promise<void> {
    if (!this.dbPromise) {
      return;
    }

    const db = await this.dbPromise;
    db.close();
    this.dbPromise = null;
  }

  private async getDb(): Promise<DatabaseSync> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = this.initialize();
    return this.dbPromise;
  }

  private async initialize(): Promise<DatabaseSync> {
    const module = await import("node:sqlite").catch((error: unknown) => {
      throw new UnsupportedFeatureError(
        `SQLite store requires node:sqlite (Node.js 22+). Original error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    const db = new module.DatabaseSync(this.dbPath);
    db.exec(`
        CREATE TABLE IF NOT EXISTS linear_thenvoi_session_rooms (
          linear_session_id TEXT PRIMARY KEY,
          linear_issue_id TEXT,
          thenvoi_room_id TEXT NOT NULL,
          status TEXT NOT NULL,
          last_event_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

      CREATE INDEX IF NOT EXISTS idx_linear_thenvoi_session_rooms_issue_active
      ON linear_thenvoi_session_rooms (linear_issue_id, status, updated_at);

      CREATE TABLE IF NOT EXISTS linear_thenvoi_bootstrap_requests (
        event_key TEXT PRIMARY KEY,
        linear_session_id TEXT NOT NULL,
        thenvoi_room_id TEXT NOT NULL,
        expected_content TEXT NOT NULL,
        message_type TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        processed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_linear_thenvoi_bootstrap_requests_pending
      ON linear_thenvoi_bootstrap_requests (processed_at, expires_at, created_at);
    `);

    try {
      db.exec(`
        ALTER TABLE linear_thenvoi_session_rooms
        ADD COLUMN last_event_key TEXT
      `);
    } catch {
      // Column already exists on newer databases.
    }

    try {
      db.exec(`
        ALTER TABLE linear_thenvoi_bootstrap_requests
        ADD COLUMN message_type TEXT NOT NULL DEFAULT 'task'
      `);
    } catch {
      // Column already exists on newer databases.
    }

    try {
      db.exec(`
        ALTER TABLE linear_thenvoi_bootstrap_requests
        ADD COLUMN metadata_json TEXT
      `);
    } catch {
      // Column already exists on newer databases.
    }

    return db;
  }

  private toRecord(row: SessionRoomRow): SessionRoomRecord {
    return {
      linearSessionId: row.linear_session_id,
      linearIssueId: row.linear_issue_id,
      thenvoiRoomId: row.thenvoi_room_id,
      status: row.status,
      lastEventKey: row.last_event_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createSqliteSessionRoomStore(dbPath: string): SessionRoomStore {
  return new SqliteSessionRoomStore(dbPath);
}
