import { describe, expect, it } from "vitest";

import { dedupeHandles, stripHandlePrefix } from "../src/integrations/linear/handles";

describe("linear handle helpers", () => {
  it("normalizes handles by trimming, removing @ prefix, and lowercasing", () => {
    expect(stripHandlePrefix("  @@Alice.Team  ")).toBe("alice.team");
  });

  it("deduplicates handles after normalization while preserving first-seen order", () => {
    expect(
      dedupeHandles([
        "Alice",
        "@alice",
        "BOB",
        "bob",
        "carol",
      ]),
    ).toEqual(["alice", "bob", "carol"]);
  });
});
