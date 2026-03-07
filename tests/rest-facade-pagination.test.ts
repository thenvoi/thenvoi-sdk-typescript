import { describe, expect, it } from "vitest";

import { RestFacade } from "../src/client/rest/RestFacade";
import { normalizePaginationMetadata } from "../src/client/rest/pagination";
import type { PaginatedResponse, RestApi } from "../src/client/rest/types";

class PaginatedChatsApi implements RestApi {
  public async getAgentMe() {
    return { id: "a1", name: "Agent", description: null };
  }

  public async createChatMessage() {
    return { ok: true };
  }

  public async createChatEvent() {
    return { ok: true };
  }

  public async createChat() {
    return { id: "room-1" };
  }

  public async listChatParticipants() {
    return [];
  }

  public async addChatParticipant() {
    return { ok: true };
  }

  public async removeChatParticipant() {
    return { ok: true };
  }

  public async markMessageProcessing() {
    return { ok: true };
  }

  public async markMessageProcessed() {
    return { ok: true };
  }

  public async markMessageFailed() {
    return { ok: true };
  }

  public async listPeers() {
    return { data: [], metadata: { page: 1, pageSize: 50, totalPages: 1, totalCount: 0 } };
  }

  public async listChats(request: { page: number; pageSize: number }): Promise<PaginatedResponse<Record<string, unknown>>> {
    if (request.page === 1) {
      return {
        data: [{ id: "room-1" }, { id: "room-2" }],
        metadata: { page: 1, pageSize: 2, totalPages: 2, totalCount: 3 },
      };
    }

    return {
      data: [{ id: "room-3" }],
      metadata: { page: 2, pageSize: 2, totalPages: 2, totalCount: 3 },
    };
  }
}

class MissingMetadataChatsApi extends PaginatedChatsApi {
  public override async listChats(
    request: { page: number; pageSize: number },
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    if (request.page === 1) {
      return { data: [{ id: "room-a" }] };
    }

    if (request.page === 2) {
      return { data: [{ id: "room-b" }] };
    }

    return { data: [] };
  }
}

class EmptyMiddlePageChatsApi extends PaginatedChatsApi {
  public override async listChats(
    request: { page: number; pageSize: number },
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    if (request.page === 1) {
      return {
        data: [{ id: "room-1" }],
        metadata: { page: 1, pageSize: 1, totalPages: 3, totalCount: 2 },
      };
    }

    if (request.page === 2) {
      return {
        data: [],
        metadata: { page: 2, pageSize: 1, totalPages: 3, totalCount: 2 },
      };
    }

    return {
      data: [{ id: "room-3" }],
      metadata: { page: 3, pageSize: 1, totalPages: 3, totalCount: 2 },
    };
  }
}

class NonTerminatingChatsApi extends PaginatedChatsApi {
  public override async listChats(
    request: { page: number; pageSize: number },
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    return {
      data: [{ id: `room-${request.page}` }],
    };
  }
}

class InvalidDataChatsApi extends PaginatedChatsApi {
  public override async listChats(): Promise<PaginatedResponse<Record<string, unknown>>> {
    return {
      data: undefined as unknown as Array<Record<string, unknown>>,
    };
  }
}

class MalformedMetadataChatsApi extends PaginatedChatsApi {
  public override async listChats(
    request: { page: number; pageSize: number },
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    if (request.page === 1) {
      const malformedMetadata =
        { page: "bad", totalPages: "bad" } as unknown as NonNullable<
          PaginatedResponse<Record<string, unknown>>["metadata"]
        >;

      return {
        data: [{ id: "room-m1" }],
        metadata: malformedMetadata,
      };
    }

    return { data: [] };
  }
}

describe("RestFacade pagination helpers", () => {
  it("aggregates listAllChats across pages", async () => {
    const rest = new RestFacade({
      api: new PaginatedChatsApi(),
    });

    const rooms = await rest.listAllChats({ pageSize: 2 });
    expect(rooms.map((room) => room.id)).toEqual(["room-1", "room-2", "room-3"]);
  });

  it("continues pagination without metadata until an empty page is returned", async () => {
    const rest = new RestFacade({
      api: new MissingMetadataChatsApi(),
    });

    const rooms = await rest.listAllChats({ pageSize: 50, maxPages: 10 });
    expect(rooms.map((room) => room.id)).toEqual(["room-a", "room-b"]);
  });

  it("uses totalPages contract for auto strategy even when an intermediate page is empty", async () => {
    const rest = new RestFacade({
      api: new EmptyMiddlePageChatsApi(),
    });

    const rooms = await rest.listAllChats({ pageSize: 1, strategy: "auto" });
    expect(rooms.map((room) => room.id)).toEqual(["room-1", "room-3"]);
  });

  it("uses until_empty strategy to stop at first empty page even with totalPages metadata", async () => {
    const rest = new RestFacade({
      api: new EmptyMiddlePageChatsApi(),
    });

    const rooms = await rest.listAllChats({ pageSize: 1, strategy: "until_empty" });
    expect(rooms.map((room) => room.id)).toEqual(["room-1"]);
  });

  it("validates pagination options as positive integers", async () => {
    const rest = new RestFacade({
      api: new PaginatedChatsApi(),
    });

    await expect(rest.listAllChats({ pageSize: 0 })).rejects.toThrow("pageSize");
    await expect(rest.listAllChats({ maxPages: 1.5 })).rejects.toThrow("maxPages");
  });

  it("validates pagination strategy at runtime for invalid values", async () => {
    const rest = new RestFacade({
      api: new PaginatedChatsApi(),
    });

    await expect(rest.listAllChats({ strategy: "invalid" as unknown as "auto" })).rejects.toThrow(
      "strategy",
    );
  });

  it("validates total_pages strategy contract", async () => {
    const rest = new RestFacade({
      api: new MissingMetadataChatsApi(),
    });

    await expect(rest.listAllChats({ strategy: "total_pages" })).rejects.toThrow("totalPages");
  });

  it("throws when maxPages is exhausted before a terminal condition", async () => {
    const rest = new RestFacade({
      api: new NonTerminatingChatsApi(),
    });

    await expect(rest.listAllChats({ maxPages: 2 })).rejects.toThrow("maxPages");
  });

  it("throws when paginated response omits data array", async () => {
    const rest = new RestFacade({
      api: new InvalidDataChatsApi(),
    });

    await expect(rest.listAllChats()).rejects.toThrow("response.data");
  });

  it("throws in strict mode when pagination metadata is malformed", () => {
    expect(() =>
      normalizePaginationMetadata({
        page: "2.5",
        pageSize: "10.2",
        totalPages: "3.7",
        totalCount: "11.9",
      })
    ).toThrow("Invalid pagination metadata");
  });

  it("supports lossy compatibility normalization when explicitly requested", () => {
    const normalized = normalizePaginationMetadata(
      {
        page: "2.5",
        pageSize: "10.2",
        totalPages: "3.7",
        totalCount: "11.9",
        passthrough: true,
      },
      { mode: "lossy" },
    );

    expect(normalized.page).toBeUndefined();
    expect(normalized.pageSize).toBeUndefined();
    expect(normalized.totalPages).toBeUndefined();
    expect(normalized.totalCount).toBeUndefined();
    expect(normalized.passthrough).toBe(true);
  });

  it("accepts totalPages=0 metadata for empty result sets", () => {
    const normalized = normalizePaginationMetadata({
      page: 1,
      pageSize: 20,
      totalPages: 0,
      totalCount: 0,
    });

    expect(normalized.page).toBe(1);
    expect(normalized.pageSize).toBe(20);
    expect(normalized.totalPages).toBe(0);
    expect(normalized.totalCount).toBe(0);
  });

  it("uses strategy-aware metadata validation by default", async () => {
    const rest = new RestFacade({
      api: new MalformedMetadataChatsApi(),
    });

    await expect(rest.listAllChats({ strategy: "until_empty" })).resolves.toEqual([
      { id: "room-m1" },
    ]);
    await expect(rest.listAllChats({ strategy: "auto" })).rejects.toThrow("Invalid pagination metadata");
  });

  it("allows explicit strict metadata validation override", async () => {
    const rest = new RestFacade({
      api: new MalformedMetadataChatsApi(),
    });

    await expect(
      rest.listAllChats({ strategy: "until_empty", metadataValidation: "strict" }),
    ).rejects.toThrow("Invalid pagination metadata");
  });
});
