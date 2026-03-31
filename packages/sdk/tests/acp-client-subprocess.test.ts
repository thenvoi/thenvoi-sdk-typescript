import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

describe("createSubprocessConnection", () => {
  it("resolves stop when the ACP subprocess has already exited", async () => {
    vi.resetModules()

    class FakeChild extends EventEmitter {
      public readonly stdin = new PassThrough()
      public readonly stdout = new PassThrough()
      public readonly stderr = new PassThrough()
      public killed = false
      public exitCode: number | null = 1
      public signalCode: NodeJS.Signals | null = null

      public kill(): boolean {
        this.killed = true
        return false
      }
    }

    const child = new FakeChild()

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => child),
    }))
    vi.doMock("@agentclientprotocol/sdk", () => ({
      ClientSideConnection: class {
        public constructor() {}
      },
      PROTOCOL_VERSION: 1,
      ndJsonStream: vi.fn(() => ({})),
    }))

    const { createSubprocessConnection } = await import("../src/adapters/acp/ACPClientAdapter")

    const handle = await createSubprocessConnection({} as never, {
      command: ["acp-agent"],
    })

    await expect(handle.stop()).resolves.toBeUndefined()
    expect(child.killed).toBe(false)

    vi.doUnmock("node:child_process")
    vi.doUnmock("@agentclientprotocol/sdk")
  })
})
