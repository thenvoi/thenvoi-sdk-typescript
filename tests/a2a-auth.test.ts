import { describe, expect, it } from "vitest";

import { buildA2AAuthHeaders } from "../src/adapters/a2a/types";

describe("buildA2AAuthHeaders", () => {
  it("builds API key, bearer token, and custom headers", () => {
    expect(buildA2AAuthHeaders({
      apiKey: "api-key",
      bearerToken: "bearer-token",
      headers: {
        "X-Custom": "custom-value",
      },
    })).toEqual({
      "X-Custom": "custom-value",
      "X-API-Key": "api-key",
      Authorization: "Bearer bearer-token",
    });
  });

  it("rejects CRLF characters in header values", () => {
    expect(() => buildA2AAuthHeaders({
      bearerToken: "bad\r\ntoken",
    })).toThrow("Authorization header value must not contain CR or LF characters.");

    expect(() => buildA2AAuthHeaders({
      headers: {
        "X-Custom": "bad\nvalue",
      },
    })).toThrow("X-Custom header value must not contain CR or LF characters.");
  });
});
