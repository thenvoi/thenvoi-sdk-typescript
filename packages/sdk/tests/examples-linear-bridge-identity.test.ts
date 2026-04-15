import { describe, expect, it } from "vitest";

import {
  createLinearThenvoiBridgeAgent,
  buildLinearThenvoiBridgePrompt,
} from "../examples/linear-thenvoi/linear-thenvoi-bridge-agent";

describe("linear bridge agent identity", () => {
  it("defaults to Band Linear PM identity", () => {
    const prompt = buildLinearThenvoiBridgePrompt();
    expect(prompt).toContain("You are Band Linear PM.");
  });

  it("system prompt does not reference old name", () => {
    const prompt = buildLinearThenvoiBridgePrompt();
    expect(prompt).not.toContain("Thenvoi Linear Bridge");
    expect(prompt).not.toContain("Thenvoi Linear bridge agent");
    expect(prompt).not.toContain("bridge agent");
  });
});
