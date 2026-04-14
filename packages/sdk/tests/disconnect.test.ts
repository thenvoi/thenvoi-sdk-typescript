import { describe, expect, it } from "vitest";

import { parseDisconnectReason, type DisconnectInfo } from "../src/platform/streaming/disconnect";

describe("parseDisconnectReason", () => {
  it("maps known server reason 'duplicate_agent'", () => {
    const info = parseDisconnectReason(1000, "duplicate_agent");
    expect(info).toEqual<DisconnectInfo>({
      code: 1000,
      reason:
        "Another instance of this agent connected — only one connection per agent_id is allowed",
      rawReason: "duplicate_agent",
    });
  });

  it("maps known server reason 'unauthorized'", () => {
    const info = parseDisconnectReason(1008, "unauthorized");
    expect(info).toEqual<DisconnectInfo>({
      code: 1008,
      reason: "Connection rejected — invalid or expired credentials",
      rawReason: "unauthorized",
    });
  });

  it("maps known server reason 'rate_limited'", () => {
    const info = parseDisconnectReason(null, "rate_limited");
    expect(info).toEqual<DisconnectInfo>({
      code: null,
      reason: "Connection closed due to rate limiting",
      rawReason: "rate_limited",
    });
  });

  it("returns unknown server reason verbatim with code prefix", () => {
    const info = parseDisconnectReason(1008, "custom_server_reason");
    expect(info).toEqual<DisconnectInfo>({
      code: 1008,
      reason: "Policy violation: custom_server_reason",
      rawReason: "custom_server_reason",
    });
  });

  it("returns unknown server reason verbatim without code prefix for unknown codes", () => {
    const info = parseDisconnectReason(4999, "some_app_reason");
    expect(info).toEqual<DisconnectInfo>({
      code: 4999,
      reason: "some_app_reason",
      rawReason: "some_app_reason",
    });
  });

  it("maps well-known WS close code when no server reason", () => {
    const info = parseDisconnectReason(1001);
    expect(info).toEqual<DisconnectInfo>({
      code: 1001,
      reason: "Server going away",
      rawReason: null,
    });
  });

  it("maps WS close code 1006 (abnormal)", () => {
    const info = parseDisconnectReason(1006, null);
    expect(info).toEqual<DisconnectInfo>({
      code: 1006,
      reason: "Abnormal closure — no close frame received",
      rawReason: null,
    });
  });

  it("falls back to numeric code for unknown codes", () => {
    const info = parseDisconnectReason(4001);
    expect(info).toEqual<DisconnectInfo>({
      code: 4001,
      reason: "Connection closed with code 4001",
      rawReason: null,
    });
  });

  it("returns generic message when no code and no reason", () => {
    const info = parseDisconnectReason();
    expect(info).toEqual<DisconnectInfo>({
      code: null,
      reason: "Connection lost unexpectedly",
      rawReason: null,
    });
  });

  it("returns generic message for null code and null reason", () => {
    const info = parseDisconnectReason(null, null);
    expect(info).toEqual<DisconnectInfo>({
      code: null,
      reason: "Connection lost unexpectedly",
      rawReason: null,
    });
  });

  it("trims whitespace from server reason", () => {
    const info = parseDisconnectReason(1000, "  duplicate_agent  ");
    expect(info.rawReason).toBe("duplicate_agent");
    expect(info.reason).toContain("Another instance");
  });

  it("treats empty string reason as absent", () => {
    const info = parseDisconnectReason(1000, "");
    expect(info).toEqual<DisconnectInfo>({
      code: 1000,
      reason: "Normal closure",
      rawReason: null,
    });
  });

  it("treats whitespace-only reason as absent", () => {
    const info = parseDisconnectReason(1000, "   ");
    expect(info).toEqual<DisconnectInfo>({
      code: 1000,
      reason: "Normal closure",
      rawReason: null,
    });
  });
});
