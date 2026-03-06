import { describe, expect, it, vi } from "vitest";

import { createLinearTools, type LinearActivityClient } from "../src/linear";
import { executeCustomTool } from "../src/runtime/tools/customTools";

function makeMockClient(): LinearActivityClient {
  return {
    createAgentActivity: vi.fn(async () => ({ ok: true })),
  };
}

describe("createLinearTools", () => {
  it("returns 6 tools", () => {
    const tools = createLinearTools({ client: makeMockClient() });
    expect(tools).toHaveLength(6);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "linear_ask_user",
      "linear_post_action",
      "linear_post_error",
      "linear_post_response",
      "linear_post_thought",
      "linear_update_plan",
    ]);
  });

  it("each tool has a description", () => {
    const tools = createLinearTools({ client: makeMockClient() });
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it("linear_post_thought validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((t) => t.name === "linear_post_thought")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Analyzing the issue",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "thought", body: "Analyzing the issue" },
    });
  });

  it("linear_post_action validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((t) => t.name === "linear_post_action")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Searching codebase",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "action", action: "Searching codebase", parameter: "" },
    });
  });

  it("linear_ask_user validates and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((t) => t.name === "linear_ask_user")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      body: "Which approach do you prefer?",
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledWith({
      agentSessionId: "sess-1",
      content: { type: "elicitation", body: "Which approach do you prefer?" },
    });
  });

  it("linear_update_plan validates steps and calls the activity layer", async () => {
    const client = makeMockClient();
    const tools = createLinearTools({ client });
    const tool = tools.find((t) => t.name === "linear_update_plan")!;

    const result = await executeCustomTool(tool, {
      session_id: "sess-1",
      steps: [
        { title: "Step 1", status: "completed" },
        { title: "Step 2", status: "in_progress" },
      ],
    });

    expect(result).toEqual({ ok: true });
    expect(client.createAgentActivity).toHaveBeenCalledOnce();
  });

  it("rejects invalid input with Zod validation error", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((t) => t.name === "linear_post_thought")!;

    await expect(
      executeCustomTool(tool, { session_id: 123 as unknown as string }),
    ).rejects.toThrow("Invalid arguments");
  });

  it("rejects invalid plan step status", async () => {
    const tools = createLinearTools({ client: makeMockClient() });
    const tool = tools.find((t) => t.name === "linear_update_plan")!;

    await expect(
      executeCustomTool(tool, {
        session_id: "sess-1",
        steps: [{ title: "Step 1", status: "invalid_status" }],
      }),
    ).rejects.toThrow("Invalid arguments");
  });
});
