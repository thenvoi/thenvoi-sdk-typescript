import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRestAdapter } from "../src/client/rest/AgentRestAdapter";

function createAdapter(): AgentRestAdapter {
  return new AgentRestAdapter({
    baseUrl: "https://example.thenvoi.test/",
    apiKey: "thnv_a_test",
  });
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
    ...init,
  });
}

describe("AgentRestAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not retry non-retryable 4xx responses and omits response bodies from errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"token":"sk-live-secret"}', {
        status: 404,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    let message = "";
    try {
      await adapter.getAgentMe({ maxRetries: 3 });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(message).toContain("GET /api/v1/agent/me failed (404; response body omitted");
    expect(message).not.toContain("sk-live-secret");
  });

  it("retries retryable server errors with exponential backoff and jitter", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("temporary failure", {
          status: 503,
          headers: {
            "content-type": "text/plain",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "agent-1",
            name: "Agent One",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();
    const promise = adapter.getAgentMe({ maxRetries: 1 });

    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      id: "agent-1",
      name: "Agent One",
      description: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries request timeouts with a fresh controller per attempt", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true },
          );
        }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: "agent-2",
            name: "Agent Two",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();
    const promise = adapter.getAgentMe({
      maxRetries: 1,
      timeoutInSeconds: 0.001,
    });

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({
      id: "agent-2",
      name: "Agent Two",
      description: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails fast when request bodies cannot be serialized", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    await expect(adapter.createChatEvent("chat-1", {
      content: "bad metadata",
      messageType: "task",
      metadata: {
        value: 1n,
      },
    })).rejects.toThrow("Failed to serialize POST /api/v1/agent/chats/chat-1/events request body");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails fast on invalid JSON responses without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{ invalid json", {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    await expect(adapter.getAgentMe({ maxRetries: 2 })).rejects.toThrow(
      "GET /api/v1/agent/me returned invalid JSON",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("routes contact and memory operations to the agent REST endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "contact-1", handle: "jane" }], metadata: { page: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "request-1", status: "pending" } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "memory-1", content: "prefers tea" }], meta: { total_count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "memory-2", status: "active" } }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    await expect(adapter.listContacts({ page: 2, pageSize: 25 })).resolves.toEqual({
      data: [{ id: "contact-1", handle: "jane" }],
      metadata: { page: 2 },
    });
    await expect(adapter.addContact("@jane", "hello")).resolves.toEqual({
      id: "request-1",
      status: "pending",
    });
    await expect(
      adapter.listMemories({ subject_id: "user-1", scope: "subject", page_size: 10 }),
    ).resolves.toEqual({
      data: [{ id: "memory-1", content: "prefers tea" }],
      metadata: { total_count: 1 },
    });
    await expect(
      adapter.storeMemory({
        content: "prefers tea",
        system: "long_term",
        type: "semantic",
        segment: "user",
        thought: "important preference",
      }),
    ).resolves.toEqual({
      id: "memory-2",
      status: "active",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.thenvoi.test/api/v1/agent/contacts?page=2&page_size=25");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://example.thenvoi.test/api/v1/agent/contacts/add");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      handle: "@jane",
      message: "hello",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://example.thenvoi.test/api/v1/agent/memories?subject_id=user-1&scope=subject&page_size=10",
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://example.thenvoi.test/api/v1/agent/memories");
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))).toEqual({
      memory: {
        content: "prefers tea",
        system: "long_term",
        type: "semantic",
        segment: "user",
        thought: "important preference",
      },
    });
  });

  it("supports context hydration and message queue endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "msg-1", content: "hello" }], meta: { total_count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "msg-2", content: "next" }], metadata: { total_count: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: "msg-3", content: "first" } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    await expect(adapter.getChatContext({ chatId: "room-1", page: 1, pageSize: 50 })).resolves.toEqual({
      data: [{ id: "msg-1", content: "hello" }],
      metadata: { total_count: 1 },
    });
    await expect(
      adapter.listMessages({ chatId: "room-1", page: 1, pageSize: 20, status: "processing" }),
    ).resolves.toEqual({
      data: [{ id: "msg-2", content: "next" }],
      metadata: { total_count: 1 },
    });
    await expect(adapter.getNextMessage({ chatId: "room-1" })).resolves.toEqual({
      id: "msg-3",
      content: "first",
    });
    await expect(adapter.getNextMessage({ chatId: "room-1" })).resolves.toBeNull();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.thenvoi.test/api/v1/agent/chats/room-1/context?page=1&page_size=50",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://example.thenvoi.test/api/v1/agent/chats/room-1/messages?page=1&page_size=20&status=processing",
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://example.thenvoi.test/api/v1/agent/chats/room-1/messages/next",
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://example.thenvoi.test/api/v1/agent/chats/room-1/messages/next",
    );
  });

  it("returns handle from getAgentMe and maps mention username to name", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: "agent-3",
          name: "Agent Three",
          handle: "darvell.long/agent-three",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    const adapter = createAdapter();

    await expect(adapter.getAgentMe()).resolves.toEqual({
      id: "agent-3",
      name: "Agent Three",
      description: null,
      handle: "darvell.long/agent-three",
    });

    await expect(adapter.createChatMessage("room-1", {
      content: "@darvell.long/agent-three please respond",
      mentions: [
        {
          id: "agent-3",
          handle: "darvell.long/agent-three",
          username: "Agent Three",
        },
      ],
    })).resolves.toEqual({ ok: true });

    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      message: {
        content: "@darvell.long/agent-three please respond",
        mentions: [
          {
            id: "agent-3",
            handle: "darvell.long/agent-three",
            name: "Agent Three",
          },
        ],
      },
    });
  });
});
