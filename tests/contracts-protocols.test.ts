import { execSync } from "node:child_process";

import { describe, expect, expectTypeOf, it } from "vitest";

import { DEFAULT_AGENT_TOOLS_CAPABILITIES } from "../src/contracts/protocols";
import type {
  AgentToolsCapabilities,
  FrameworkAdapterInput,
  PlatformMessageLike,
  PreprocessorContext,
} from "../src/contracts/protocols";

describe("contracts/protocols", () => {
  it("keeps shared protocol contracts strongly typed", () => {
    const capabilities: AgentToolsCapabilities = {
      peers: true,
      contacts: false,
      memory: false,
    };

    expectTypeOf(capabilities.peers).toEqualTypeOf<boolean>();
    expect(DEFAULT_AGENT_TOOLS_CAPABILITIES).toEqual({
      peers: false,
      contacts: false,
      memory: false,
    });
    expect(Object.values(DEFAULT_AGENT_TOOLS_CAPABILITIES)).toEqual([false, false, false]);
    expect(Object.keys(DEFAULT_AGENT_TOOLS_CAPABILITIES)).toEqual([
      "peers",
      "contacts",
      "memory",
    ]);
  });

  it("exposes preprocessor context over platform message contract", () => {
    expectTypeOf<PreprocessorContext["recordMessage"]>().parameter(0).toEqualTypeOf<PlatformMessageLike>();
    expect(typeof DEFAULT_AGENT_TOOLS_CAPABILITIES.peers).toBe("boolean");
    expect(typeof DEFAULT_AGENT_TOOLS_CAPABILITIES.contacts).toBe("boolean");
    expect(typeof DEFAULT_AGENT_TOOLS_CAPABILITIES.memory).toBe("boolean");
  });

  it("keeps contracts/protocols as the single import surface", () => {
    const output = execSync(
      "rg -n \"core/protocols\" src || true",
      { encoding: "utf8" },
    ).trim();
    expect(output).toBe("");
  });
});
