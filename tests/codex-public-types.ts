import type {
  CodexReasoningSummary,
  CodexWebSearchMode,
} from "../src/index";
import type {
  DynamicToolSpec,
  TurnStartParams,
} from "../src/adapters";

const reasoningSummary: CodexReasoningSummary = "detailed";
const webSearchMode: CodexWebSearchMode = "live";

const dynamicTool: DynamicToolSpec = {
  name: "post_action",
  description: "Post a structured progress update.",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
    },
    required: ["text"],
  },
};

const turnStart: TurnStartParams = {
  threadId: "thread-1",
  input: [{ type: "text", text: "hello" }],
  summary: reasoningSummary,
};

void webSearchMode;
void dynamicTool;
void turnStart;
