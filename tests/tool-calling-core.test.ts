import { describe, expect, it } from "vitest";

import { runSingleToolRound } from "../src/adapters/tool-calling/ToolCallingAdapter";
import type { ToolCallingModel, ToolCallingModelRequest, ToolCallingResponse } from "../src/adapters/tool-calling/types";

describe("runSingleToolRound", () => {
  it("delegates requests directly to the model", async () => {
    const model: ToolCallingModel = {
      async complete(request: ToolCallingModelRequest): Promise<ToolCallingResponse> {
        return {
          text: `ok:${String(request.systemPrompt ?? "")}`,
        };
      },
    };

    const response = await runSingleToolRound(model, {
      systemPrompt: "test",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });

    expect(response.text).toBe("ok:test");
  });

  it("preserves original error as cause when model round fails", async () => {
    const original = new Error("model unavailable");
    const model: ToolCallingModel = {
      async complete(): Promise<ToolCallingResponse> {
        throw original;
      },
    };

    await expect(
      runSingleToolRound(model, {
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    ).rejects.toMatchObject({
      message: "Tool round failed: model unavailable",
      cause: original,
    });
  });

  it("preserves non-Error throws as cause values", async () => {
    const model: ToolCallingModel = {
      async complete(): Promise<ToolCallingResponse> {
        throw "boom";
      },
    };

    await expect(
      runSingleToolRound(model, {
        messages: [{ role: "user", content: "hello" }],
        tools: [],
      }),
    ).rejects.toMatchObject({
      message: "Tool round failed: boom",
      cause: "boom",
    });
  });
});
