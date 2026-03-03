import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteSessionRoomStore, type SessionRoomStore } from "../src/index";

async function createStore(): Promise<{ store: SessionRoomStore; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "thenvoi-linear-store-"));
  const store = createSqliteSessionRoomStore(join(dir, "session-map.sqlite"));

  return {
    store,
    cleanup: async () => {
      if (store.close) {
        await store.close();
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("sqlite session room store", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0, cleanups.length)) {
      await cleanup();
    }
  });

  it("persists and loads records by session id", async () => {
    const { store, cleanup } = await createStore();
    cleanups.push(cleanup);

    await store.upsert({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "active",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });

    await expect(store.getBySessionId("session-1")).resolves.toMatchObject({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "active",
    });
  });

  it("returns the latest active room for an issue", async () => {
    const { store, cleanup } = await createStore();
    cleanups.push(cleanup);

    await store.upsert({
      linearSessionId: "session-old",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-old",
      status: "active",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });

    await store.upsert({
      linearSessionId: "session-new",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-new",
      status: "active",
      createdAt: "2026-03-03T00:01:00.000Z",
      updatedAt: "2026-03-03T00:01:00.000Z",
    });

    await expect(store.getByIssueId("issue-1")).resolves.toMatchObject({
      thenvoiRoomId: "room-new",
      linearSessionId: "session-new",
    });
  });

  it("excludes canceled rooms from issue lookup", async () => {
    const { store, cleanup } = await createStore();
    cleanups.push(cleanup);

    await store.upsert({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "active",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });

    await store.markCanceled("session-1");

    await expect(store.getByIssueId("issue-1")).resolves.toBeNull();
    await expect(store.getBySessionId("session-1")).resolves.toMatchObject({
      status: "canceled",
    });
  });
});
