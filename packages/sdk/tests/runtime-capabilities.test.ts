import { describe, expect, it } from "vitest";

import { UnsupportedFeatureError } from "../src/core/errors";
import { assertCapability } from "../src/runtime/capabilities";

describe("assertCapability", () => {
  it("does not throw when the capability is enabled", () => {
    expect(() =>
      assertCapability(
        { peers: true, contacts: false, memory: false },
        "peers",
      ),
    ).not.toThrow();
  });

  it("throws UnsupportedFeatureError when the capability is disabled", () => {
    expect(() =>
      assertCapability(
        { peers: false, contacts: false, memory: false },
        "peers",
      ),
    ).toThrow(UnsupportedFeatureError);
  });

  it("uses custom labels in error messages", () => {
    expect(() =>
      assertCapability(
        { peers: true, contacts: false, memory: false },
        "contacts",
        "Contact sync",
      ),
    ).toThrow("Contact sync is disabled by runtime capabilities");
  });
});
