import { describe, expect, it } from "vitest";

import { DefaultPreprocessor } from "../src/runtime/preprocessing/DefaultPreprocessor";
import { ExecutionContext } from "../src/runtime/ExecutionContext";
import { ThenvoiLink } from "../src/platform/ThenvoiLink";
import type { StreamingTransport } from "../src/platform/streaming/transport";
import { FakeRestApi } from "./testUtils";

class FakeTransport implements StreamingTransport {
  public async connect() {}
  public async disconnect() {}
  public async join() {}
  public async leave() {}
  public async runForever() {}
  public isConnected() {
    return true;
  }
}

describe("DefaultPreprocessor", () => {
  it("converts message_created events into AgentInput", async () => {
    const link = new ThenvoiLink({
      agentId: "a1",
      apiKey: "k",
      restApi: new FakeRestApi(),
      transport: new FakeTransport(),
    });

    const context = new ExecutionContext({
      roomId: "room-1",
      link,
      maxContextMessages: 50,
    });

    const preprocessor = new DefaultPreprocessor();
    const input = await preprocessor.process(
      context,
      {
        type: "message_created",
        roomId: "room-1",
        payload: {
          id: "m1",
          content: "hello",
          message_type: "text",
          sender_id: "user-1",
          sender_type: "User",
          sender_name: "Jane",
          inserted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      "a1",
    );

    expect(input).not.toBeNull();
    expect(input?.message.content).toBe("hello");
    expect(input?.isSessionBootstrap).toBe(true);
  });

  it("skips self-authored messages", async () => {
    const link = new ThenvoiLink({
      agentId: "a1",
      apiKey: "k",
      restApi: new FakeRestApi(),
      transport: new FakeTransport(),
    });

    const context = new ExecutionContext({ roomId: "room-1", link, maxContextMessages: 50 });

    const preprocessor = new DefaultPreprocessor();
    const result = await preprocessor.process(
      context,
      {
        type: "message_created",
        roomId: "room-1",
        payload: {
          id: "m1",
          content: "hello",
          message_type: "text",
          sender_id: "a1",
          sender_type: "Agent",
          sender_name: "Agent",
          inserted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      "a1",
    );

    expect(result).toBeNull();
  });
});
