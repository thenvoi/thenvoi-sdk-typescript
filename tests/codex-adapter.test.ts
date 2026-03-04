import { describe, expect, it } from "vitest";

import { CodexAdapter } from "../src/adapters/codex/CodexAdapter";
import { HistoryProvider } from "../src/runtime/types";
import { FakeTools, makeMessage } from "./testUtils";

describe("CodexAdapter", () => {
  it("uses the official Codex thread API and reports execution items", async () => {
    const startThreadCalls: Array<Record<string, unknown>> = [];
    const runPrompts: string[] = [];

    const thread = {
      id: "thread-1",
      async run(input: string) {
        runPrompts.push(input);
        return {
          finalResponse: "final codex response",
          items: [
            {
              id: "reasoning-1",
              type: "reasoning",
              text: "thinking",
            },
            {
              id: "command-1",
              type: "command_execution",
              command: "echo ok",
              aggregated_output: "ok",
              status: "completed",
            },
            {
              id: "patch-1",
              type: "file_change",
              status: "completed",
              changes: [{ path: "src/index.ts", kind: "update" }],
            },
            {
              id: "mcp-1",
              type: "mcp_tool_call",
              server: "thenvoi",
              tool: "thenvoi_send_message",
              arguments: { content: "hi" },
              status: "completed",
            },
          ],
        };
      },
    };

    const fakeClient = {
      startThread(options?: Record<string, unknown>) {
        startThreadCalls.push(options ?? {});
        return thread;
      },
      resumeThread() {
        return thread;
      },
    };

    const adapter = new CodexAdapter({
      config: {
        model: "gpt-5.3-codex",
        cwd: "/tmp/workdir",
        approvalPolicy: "never",
        sandboxMode: "workspace-write",
        reasoningEffort: "medium",
        networkAccessEnabled: true,
        webSearchMode: "live",
        skipGitRepoCheck: true,
        enableExecutionReporting: true,
        emitThoughtEvents: true,
      },
      factory: async () => fakeClient as never,
    });
    await adapter.onStarted("Codex Agent", "Codex parity adapter");

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("diagnose and fix"),
      tools,
      new HistoryProvider([
        { sender_name: "Alice", sender_type: "User", content: "historical message" },
      ]),
      "Participants changed",
      "Contacts updated",
      { isSessionBootstrap: true, roomId: "room-1" },
    );

    expect(startThreadCalls).toHaveLength(1);
    expect(startThreadCalls[0]).toMatchObject({
      model: "gpt-5.3-codex",
      workingDirectory: "/tmp/workdir",
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      modelReasoningEffort: "medium",
      networkAccessEnabled: true,
      webSearchMode: "live",
      skipGitRepoCheck: true,
    });
    expect(runPrompts[0]).toContain("[Conversation History]");
    expect(runPrompts[0]).toContain("[System]: Participants changed");
    expect(runPrompts[0]).toContain("[System]: Contacts updated");
    expect(tools.messages).toEqual(["final codex response"]);
    expect(tools.events.some((event) => event.messageType === "thought")).toBe(true);
    expect(tools.events.filter((event) => event.messageType === "task")).toHaveLength(3);
  });

  it("creates a new thread after cleanup for the same room", async () => {
    let startCount = 0;
    const startThreadCalls: Array<Record<string, unknown>> = [];

    const thread = {
      id: "thread-1",
      async run() {
        return { finalResponse: "ok", items: [] };
      },
    };

    const fakeClient = {
      startThread(options?: Record<string, unknown>) {
        startCount += 1;
        startThreadCalls.push(options ?? {});
        return thread;
      },
      resumeThread() {
        return thread;
      },
    };

    const adapter = new CodexAdapter({
      factory: async () => fakeClient as never,
    });

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("first"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );
    await adapter.onCleanup("room-1");
    await adapter.onMessage(
      makeMessage("second"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-1" },
    );

    expect(startCount).toBe(2);
    expect(startThreadCalls[0]).toMatchObject({
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      networkAccessEnabled: false,
      webSearchMode: "disabled",
    });
  });

  it("resumes a thread from bootstrap history metadata when available", async () => {
    const resumed: string[] = [];
    const started: number[] = [];

    const thread = {
      id: "thread-hydrated",
      async run() {
        return { finalResponse: "resumed", items: [] };
      },
    };

    const fakeClient = {
      startThread() {
        started.push(1);
        return thread;
      },
      resumeThread(id: string) {
        resumed.push(id);
        return thread;
      },
    };

    const adapter = new CodexAdapter({
      factory: async () => fakeClient as never,
    });

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("continue"),
      tools,
      new HistoryProvider([
        {
          message_type: "task",
          metadata: {
            codex_thread_id: "thread-hydrated",
          },
        },
      ]),
      null,
      null,
      { isSessionBootstrap: true, roomId: "room-42" },
    );

    expect(resumed).toEqual(["thread-hydrated"]);
    expect(started).toHaveLength(0);
    expect(tools.messages).toEqual(["resumed"]);
  });

  it("handles local slash commands without starting a codex turn", async () => {
    let startCount = 0;

    const fakeClient = {
      startThread() {
        startCount += 1;
        return {
          id: "thread-1",
          async run() {
            return { finalResponse: "should-not-run", items: [] };
          },
        };
      },
      resumeThread() {
        throw new Error("not used");
      },
    };

    const adapter = new CodexAdapter({
      config: {
        model: "gpt-5.3-codex",
      },
      factory: async () => fakeClient as never,
    });

    const tools = new FakeTools();
    await adapter.onMessage(
      makeMessage("/status"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-cmd" },
    );
    await adapter.onMessage(
      makeMessage("/model gpt-5.2"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-cmd" },
    );

    expect(startCount).toBe(0);
    expect(tools.messages[0]).toContain("Codex status");
    expect(tools.messages[1]).toContain("Model override set to");
  });

  it("reuses in-flight thread initialization across concurrent room messages", async () => {
    let startCount = 0;
    let releaseRuns: (() => void) | null = null;
    const runGate = new Promise<void>((resolve) => {
      releaseRuns = resolve;
    });

    const thread = {
      id: "thread-concurrent",
      async run() {
        await runGate;
        return { finalResponse: "ok", items: [] };
      },
    };

    const fakeClient = {
      startThread() {
        startCount += 1;
        return thread;
      },
      resumeThread() {
        return thread;
      },
    };

    const adapter = new CodexAdapter({
      factory: async () => fakeClient as never,
    });

    const tools = new FakeTools();
    const first = adapter.onMessage(
      makeMessage("first", "room-race"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-race" },
    );
    const second = adapter.onMessage(
      makeMessage("second", "room-race"),
      tools,
      new HistoryProvider([]),
      null,
      null,
      { isSessionBootstrap: false, roomId: "room-race" },
    );

    releaseRuns?.();
    await Promise.all([first, second]);

    expect(startCount).toBe(1);
    expect(tools.messages).toEqual(["ok", "ok"]);
  });
});
