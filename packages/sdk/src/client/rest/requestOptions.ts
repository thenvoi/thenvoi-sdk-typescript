export interface RestRequestOptions {
  maxRetries?: number;
  timeoutInSeconds?: number;
  headers?: Record<string, string>;
}

export const DEFAULT_REQUEST_OPTIONS: RestRequestOptions = {
  maxRetries: 3,
};
