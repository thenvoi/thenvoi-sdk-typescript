import { LinearClient } from "@linear/sdk";

export function isLinearApiKey(token: string): boolean {
  return token.trim().startsWith("lin_api_");
}

export function createLinearClient(token: string): LinearClient {
  const trimmedToken = token.trim();
  if (isLinearApiKey(trimmedToken)) {
    return new LinearClient({
      apiKey: trimmedToken,
    });
  }

  return new LinearClient({
    accessToken: trimmedToken,
  });
}

export function buildLinearAuthorizationHeader(token: string): string {
  const trimmedToken = token.trim();
  if (isLinearApiKey(trimmedToken)) {
    return trimmedToken;
  }

  if (trimmedToken.startsWith("Bearer ")) {
    return trimmedToken;
  }

  return `Bearer ${trimmedToken}`;
}
