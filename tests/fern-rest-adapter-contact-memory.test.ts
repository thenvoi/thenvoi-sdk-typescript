import { describe, expect, it } from "vitest";

import { FernRestAdapter, RestFacade } from "../src/client/rest/RestFacade";

describe("FernRestAdapter contact and memory parity", () => {
  it("normalizes duck-typed agent contact, memory, and peer resources", async () => {
    const rest = new RestFacade({
      api: new FernRestAdapter({
        agentPeers: {
          listAgentPeers: async () => ({
            data: [{ id: "peer-1", name: "Weather", type: "Agent", handle: "@sam/weather" }],
            metadata: { page: 1, page_size: 5, total_count: 1, total_pages: 1 },
          }),
        },
        agentContacts: {
          listAgentContacts: async () => ({
            data: [{ id: "contact-1", handle: "@jane", name: "Jane", type: "User" }],
            metadata: { page: 2, page_size: 25, total_count: 1, total_pages: 1 },
          }),
          addAgentContact: async () => ({ data: { id: "request-1", status: "pending" } }),
          removeAgentContact: async () => ({ data: { status: "removed" } }),
          listAgentContactRequests: async () => ({
            data: {
              received: [{ id: "request-1", from_handle: "@jane", status: "pending" }],
              sent: [{ id: "request-2", to_handle: "@weather", status: "approved" }],
            },
            metadata: {
              page: 1,
              page_size: 10,
              received: { total: 1, total_pages: 1 },
              sent: { total: 1, total_pages: 1 },
            },
          }),
          respondToAgentContactRequest: async () => ({ data: { id: "request-1", status: "approved" } }),
        },
        agentMemories: {
          listAgentMemories: async () => ({
            data: [{
              id: "memory-1",
              content: "Jane likes tea",
              system: "long_term",
              type: "semantic",
              segment: "user",
              status: "active",
            }],
            meta: { page_size: 5, total_count: 1 },
          }),
          createAgentMemory: async () => ({
            data: {
              id: "memory-2",
              content: "Jane prefers tea",
              system: "long_term",
              type: "semantic",
              segment: "user",
              status: "active",
            },
          }),
          getAgentMemory: async (memoryId: string) => ({
            data: {
              id: memoryId,
              content: "Jane likes tea",
              system: "long_term",
              type: "semantic",
              segment: "user",
              status: "active",
            },
          }),
          supersedeAgentMemory: async (memoryId: string) => ({ data: { id: memoryId, status: "superseded" } }),
          archiveAgentMemory: async (memoryId: string) => ({ data: { id: memoryId, status: "archived" } }),
        },
      }),
    });

    await expect(rest.listPeers({ page: 1, pageSize: 5, notInChat: "room-1" })).resolves.toEqual({
      data: [{ id: "peer-1", name: "Weather", type: "Agent", handle: "@sam/weather" }],
      metadata: { page: 1, pageSize: 5, totalCount: 1, totalPages: 1 },
    });
    await expect(rest.listContacts({ page: 2, pageSize: 25 })).resolves.toEqual({
      data: [{ id: "contact-1", handle: "@jane", name: "Jane", type: "User" }],
      metadata: { page: 2, pageSize: 25, totalCount: 1, totalPages: 1 },
    });
    await expect(rest.addContact("@jane", "hello")).resolves.toEqual({
      id: "request-1",
      status: "pending",
    });
    await expect(rest.removeContact({ contactId: "contact-1" })).resolves.toEqual({
      status: "removed",
    });
    await expect(rest.listContactRequests({ page: 1, pageSize: 10, sentStatus: "approved" })).resolves.toMatchObject({
      received: [{ id: "request-1", from_handle: "@jane", status: "pending" }],
      sent: [{ id: "request-2", to_handle: "@weather", status: "approved" }],
      metadata: {
        page: 1,
        pageSize: 10,
        received: { total: 1, totalPages: 1 },
        sent: { total: 1, totalPages: 1 },
      },
    });
    await expect(rest.respondContactRequest({ action: "approve", requestId: "request-1" })).resolves.toEqual({
      id: "request-1",
      status: "approved",
    });
    await expect(rest.listMemories({ subject_id: "user-1", page_size: 5 })).resolves.toEqual({
      data: [{
        id: "memory-1",
        content: "Jane likes tea",
        system: "long_term",
        type: "semantic",
        segment: "user",
        status: "active",
      }],
      metadata: { pageSize: 5, totalCount: 1 },
    });
    await expect(
      rest.storeMemory({
        content: "Jane prefers tea",
        system: "long_term",
        type: "semantic",
        segment: "user",
        thought: "Useful preference",
      }),
    ).resolves.toEqual({
      id: "memory-2",
      content: "Jane prefers tea",
      system: "long_term",
      type: "semantic",
      segment: "user",
      status: "active",
    });
    await expect(rest.getMemory("memory-1")).resolves.toEqual({
      id: "memory-1",
      content: "Jane likes tea",
      system: "long_term",
      type: "semantic",
      segment: "user",
      status: "active",
    });
    await expect(rest.supersedeMemory("memory-1")).resolves.toEqual({
      id: "memory-1",
      status: "superseded",
    });
    await expect(rest.archiveMemory("memory-1")).resolves.toEqual({
      id: "memory-1",
      status: "archived",
    });
  });
});
