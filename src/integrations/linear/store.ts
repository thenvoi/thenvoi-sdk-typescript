import type { SessionRoomRecord, SessionRoomStore } from "./types";

type DatabaseSync = import("node:sqlite").DatabaseSync;

interface SessionRoomRow {
  linear_session_id: string;
  linear_issue_id: string | null;
  thenvoi_room_id: string;
  status: SessionRoomRecord["status"];
  created_at: string;
  updated_at: string;
}

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
          created_at,
          updated_at
        FROM linear_thenvoi_session_rooms
        WHERE linear_issue_id = ? AND status = 'active'
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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(linear_session_id)
        DO UPDATE SET
          linear_issue_id = excluded.linear_issue_id,
          thenvoi_room_id = excluded.thenvoi_room_id,
          status = excluded.status,
          updated_at = excluded.updated_at
        `,
      )
      .run(
        record.linearSessionId,
        record.linearIssueId,
        record.thenvoiRoomId,
        record.status,
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
      throw new Error(
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
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_linear_thenvoi_session_rooms_issue_active
      ON linear_thenvoi_session_rooms (linear_issue_id, status, updated_at);
    `);

    return db;
  }

  private toRecord(row: SessionRoomRow): SessionRoomRecord {
    return {
      linearSessionId: row.linear_session_id,
      linearIssueId: row.linear_issue_id,
      thenvoiRoomId: row.thenvoi_room_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function createSqliteSessionRoomStore(dbPath: string): SessionRoomStore {
  return new SqliteSessionRoomStore(dbPath);
}
