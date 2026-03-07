import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createSqliteSessionRoomStore, type SessionRoomStore } from "../src/linear";

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

  it("returns the latest reusable room for an issue", async () => {
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

  it("keeps completed rooms available for issue lookup", async () => {
    const { store, cleanup } = await createStore();
    cleanups.push(cleanup);

    await store.upsert({
      linearSessionId: "session-1",
      linearIssueId: "issue-1",
      thenvoiRoomId: "room-1",
      status: "completed",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });

    await expect(store.getByIssueId("issue-1")).resolves.toMatchObject({
      linearSessionId: "session-1",
      thenvoiRoomId: "room-1",
      status: "completed",
    });
    await expect(store.getBySessionId("session-1")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("stores, lists, and marks bootstrap requests processed", async () => {
    const { store, cleanup } = await createStore();
    cleanups.push(cleanup);

    await store.enqueueBootstrapRequest({
      eventKey: "event-1",
      linearSessionId: "session-1",
      thenvoiRoomId: "room-1",
      expectedContent: "Bootstrap me",
      messageType: "task",
      metadata: { linear_bridge: "thenvoi" },
      createdAt: "2026-03-03T00:00:00.000Z",
      expiresAt: "2099-03-03T00:10:00.000Z",
    });

    await expect(store.listPendingBootstrapRequests()).resolves.toEqual([
      {
        eventKey: "event-1",
        linearSessionId: "session-1",
        thenvoiRoomId: "room-1",
        expectedContent: "Bootstrap me",
        messageType: "task",
        metadata: { linear_bridge: "thenvoi" },
        createdAt: "2026-03-03T00:00:00.000Z",
        expiresAt: "2099-03-03T00:10:00.000Z",
      },
    ]);

    await store.markBootstrapRequestProcessed("event-1");

    await expect(store.listPendingBootstrapRequests()).resolves.toEqual([]);
  });
});
