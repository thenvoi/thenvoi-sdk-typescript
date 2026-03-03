import { describe, expect, it } from "vitest";

import { ThenvoiLink } from "../src/platform/ThenvoiLink";
import type { PlatformEvent } from "../src/platform/events";
import type { StreamingTransport } from "../src/platform/streaming/transport";
import { UnsupportedFeatureError } from "../src/core/errors";
import { FakeRestApi } from "./testUtils";

class FakeTransport implements StreamingTransport {
  public readonly joinedTopics: string[] = [];

  public async connect() {}
  public async disconnect() {}
  public async join(topic: string) {
    this.joinedTopics.push(topic);
  }
  public async leave() {}
  public async runForever() {}
  public isConnected() {
    return true;
  }
}

describe("ThenvoiLink event waiting", () => {
  it("removes abort listeners when waiter resolves from queued events", async () => {
    const link = new ThenvoiLink({
      agentId: "agent-1",
      apiKey: "key",
      restApi: new FakeRestApi(),
      transport: new FakeTransport(),
    });

    let addCalls = 0;
    let removeCalls = 0;
    const listeners = new Set<EventListenerOrEventListenerObject>();

    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        addCalls += 1;
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        removeCalls += 1;
        listeners.delete(listener);
      },
    } as unknown as AbortSignal;

    const pending = link.nextEvent(signal);
    expect(addCalls).toBe(1);

    const event = {
      type: "message_created",
      roomId: "room-1",
      payload: {},
      raw: {},
    } as unknown as PlatformEvent;

    link.queueEvent(event);

    await expect(pending).resolves.toBe(event);
    expect(removeCalls).toBe(1);
    expect(listeners.size).toBe(0);
  });

  it("rejects contact subscriptions when contact capability is disabled", async () => {
    const link = new ThenvoiLink({
      agentId: "agent-1",
      apiKey: "key",
      restApi: new FakeRestApi(),
      transport: new FakeTransport(),
      capabilities: { contacts: false },
    });

    await expect(link.subscribeAgentContacts()).rejects.toBeInstanceOf(UnsupportedFeatureError);
  });

  it("allows contact subscriptions when contact capability is enabled", async () => {
    const transport = new FakeTransport();
    const link = new ThenvoiLink({
      agentId: "agent-1",
      apiKey: "key",
      restApi: new FakeRestApi(),
      transport,
      capabilities: { contacts: true },
    });

    await expect(link.subscribeAgentContacts()).resolves.toBeUndefined();
    expect(transport.joinedTopics).toContain("agent_contacts:agent-1");
  });
});
