import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleLogger } from "../src/core/logger";

describe("ConsoleLogger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts sensitive keys before writing error context", () => {
    const logger = new ConsoleLogger();
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    logger.error("boom", {
      apiKey: "secret",
      nested: {
        authorization: "Bearer abc",
        safe: "ok",
      },
    });

    expect(writeSpy).toHaveBeenCalledOnce();
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain("\"apiKey\":\"[REDACTED]\"");
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain("\"authorization\":\"[REDACTED]\"");
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain("\"safe\":\"ok\"");
  });

  it("handles circular error context safely", () => {
    const logger = new ConsoleLogger();
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const context: Record<string, unknown> = {};
    context.self = context;

    logger.error("boom", context);

    expect(writeSpy).toHaveBeenCalledOnce();
    expect(String(writeSpy.mock.calls[0]?.[0])).toContain("[Circular]");
  });
});
