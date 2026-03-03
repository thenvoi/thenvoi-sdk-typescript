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
});
