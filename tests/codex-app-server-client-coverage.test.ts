import { describe, expect, it, vi } from "vitest";

import {
  CodexAppServerStdioClient,
  type CodexRpcEvent,
} from "../src/adapters/codex/appServerClient";

interface ClientInternals {
  handleLine(line: string): Promise<void>;
  sendJson(payload: Record<string, unknown>): Promise<void>;
  events: CodexRpcEvent[];
  pending: Map<number | string, { resolve(value: unknown): void; reject(error: Error): void }>;
}

function getInternals(client: CodexAppServerStdioClient): ClientInternals {
  return client as unknown as ClientInternals;
}

describe("CodexAppServerStdioClient coverage", () => {
  it("logs and ignores invalid JSON lines", async () => {
    const logger = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
    const client = new CodexAppServerStdioClient({ logger: logger as never });

    await getInternals(client).handleLine("{not-json");

    expect(logger.warn).toHaveBeenCalledWith(
      "codex_app_server.invalid_json",
      expect.objectContaining({ line: "{not-json" }),
    );
    expect(getInternals(client).events).toEqual([]);
  });

  it("queues notifications and resolves pending request results", async () => {
    const client = new CodexAppServerStdioClient();
    const internals = getInternals(client);
    const resolve = vi.fn();
    const reject = vi.fn();
    internals.pending.set(5, { resolve, reject });

    await internals.handleLine(JSON.stringify({
      method: "session/updated",
      params: { state: "ready" },
    }));
    await internals.handleLine(JSON.stringify({
      id: 5,
      result: { ok: true },
    }));

    expect(internals.events).toEqual([
      { kind: "notification", method: "session/updated", params: { state: "ready" } },
    ]);
    expect(resolve).toHaveBeenCalledWith({ ok: true });
    expect(reject).not.toHaveBeenCalled();
  });

  it("times out recvEvent calls when no event arrives", async () => {
    const client = new CodexAppServerStdioClient();
    await expect(client.recvEvent(5)).rejects.toThrow("Timed out waiting for Codex app-server event");
  });

  it("rejects sendJson when the client is not connected", async () => {
    const client = new CodexAppServerStdioClient();
    await expect(getInternals(client).sendJson({ method: "ping" })).rejects.toThrow(
      "Codex app-server is not connected",
    );
  });
});
